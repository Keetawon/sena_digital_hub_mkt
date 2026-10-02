from __future__ import annotations

import asyncio
import ipaddress
import os
import re
import secrets
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import jwt
from fastapi import HTTPException, Request


ROLES = ("editor", "publisher", "viewer", "service_consumer", "admin")
AUTH_ROLES = (*ROLES, "online_staff", "agency")
DEMO_ROLES = (*ROLES, "online_staff", "agency_kin", "agency_combay")
DEMO_ACTORS = {role: UUID(int=index + 1) for index, role in enumerate(ROLES)}
ALL_DEMO_ACTORS = {role: UUID(int=index + 1) for index, role in enumerate(DEMO_ROLES)}
DEMO_AGENCIES = {"agency_kin": "KIN", "agency_combay": "COMBAY"}
HOSTED_TEST_REF = "eqlrtevwpyboplljgowo"


def failure(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message})


@dataclass(frozen=True)
class Settings:
    database_url: str = field(repr=False)
    auth_mode: str
    environment: str
    demo_tokens: dict[str, str] = field(default_factory=dict, repr=False)
    supabase_url: str = ""
    hosted_test_simulation: bool = False
    admin_origin: str = ""
    supabase_storage_key: str = field(default="", repr=False)

    def __post_init__(self):
        database = urlparse(self.database_url)
        if database.scheme not in {"postgres", "postgresql"} or not database.hostname:
            raise ValueError("กรุณากำหนด HUB_DATABASE_URL สำหรับ PostgreSQL")
        if self.environment not in {"local", "production", "hosted-test"}:
            raise ValueError("กรุณากำหนด HUB_ENV เป็น local, hosted-test หรือ production")
        if self.hosted_test_simulation and self.environment != "hosted-test":
            raise ValueError("การจำลอง H1 ต้องใช้สภาพแวดล้อม hosted-test")
        if self.environment == "hosted-test":
            origin = urlparse(self.admin_origin)
            query = parse_qs(database.query, keep_blank_values=True)
            if (database.fragment or set(query) - {"sslmode", "sslrootcert"}
                    or any(len(values) != 1 or not values[0] for values in query.values())):
                raise ValueError("ตัวเลือกการเชื่อมต่อฐานข้อมูล H1 ไม่ถูกต้อง")
            if self.auth_mode != "supabase" or self.demo_tokens and any(self.demo_tokens.values()):
                raise ValueError("ระบบทดสอบ H1 ต้องเข้าสู่ระบบด้วยบัญชี Supabase เท่านั้น")
            if self.hosted_test_simulation:
                if (database.hostname != "127.0.0.1" or database.port != 55434
                        or database.path != "/hub_hosted_test_simulation"
                        or (query and query != {"sslmode": ["disable"]})
                        or self.supabase_url != "http://127.0.0.1:54329"
                        or self.admin_origin != "http://127.0.0.1:3001"):
                    raise ValueError("การจำลอง H1 ใช้ได้เฉพาะฐานข้อมูลและบริการจำลองภายในเครื่องที่กำหนด")
            else:
                direct = database.hostname == f"db.{HOSTED_TEST_REF}.supabase.co"
                pooler = (database.hostname.endswith(".pooler.supabase.com")
                          and database.username == f"hub_runtime.{HOSTED_TEST_REF}")
                if (self.supabase_url != f"https://{HOSTED_TEST_REF}.supabase.co"
                        or not (direct or pooler) or database.path != "/postgres" or database.port not in {None, 5432}
                        or query.get("sslmode") != ["verify-full"]
                        or origin.scheme != "https" or not origin.hostname):
                    raise ValueError("ระบบทดสอบ H1 ต้องใช้โครงการที่อนุญาตและตรวจสอบ TLS เท่านั้น")
            if (origin.path not in {"", "/"} or origin.query or origin.fragment or origin.username
                    or database.username not in {"hub_runtime", f"hub_runtime.{HOSTED_TEST_REF}"}
                    or len(self.supabase_storage_key) < 20):
                raise ValueError("การตั้งค่าบัญชีระบบ พื้นที่ไฟล์ หรือที่มาของหน้าเว็บ H1 ไม่ถูกต้อง")
        if self.auth_mode == "demo":
            if self.environment != "local" or database.hostname not in {
                "localhost", "127.0.0.1", "::1"
            }:
                raise ValueError("โหมดสาธิตใช้ได้เฉพาะเครื่องและฐานข้อมูลภายในเครื่อง")
            tokens = [self.demo_tokens.get(role, "") for role in ROLES]
            if any(len(token) < 32 or not token.isascii() for token in tokens) or len(set(tokens)) != len(ROLES):
                raise ValueError("ต้องกำหนด token สาธิตทั้ง 5 บทบาทให้ต่างกันและยาวอย่างน้อย 32 ตัวอักษร ASCII")
            extra = [self.demo_tokens.get(role, "") for role in DEMO_ROLES[len(ROLES):]]
            if any(extra) and (any(len(token) < 32 or not token.isascii() for token in extra)
                               or len(set(tokens + extra)) != len(DEMO_ROLES)):
                raise ValueError("token สาธิตทะเบียนต้องกำหนดครบทั้ง 3 บัญชีและต่างจากทุกบัญชีเดิม")
        elif self.auth_mode == "supabase":
            url = urlparse(self.supabase_url)
            if ((url.scheme != "https" and not self.hosted_test_simulation) or not url.hostname
                    or url.path not in {"", "/"} or url.query or url.fragment or url.username):
                raise ValueError("กรุณากำหนด HUB_SUPABASE_URL เป็น HTTPS origin ที่เชื่อถือได้")
        else:
            raise ValueError("กรุณากำหนด HUB_AUTH_MODE เป็น demo หรือ supabase")

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            database_url=os.getenv("HUB_DATABASE_URL", ""),
            auth_mode=os.getenv("HUB_AUTH_MODE", ""),
            environment=os.getenv("HUB_ENV", ""),
            demo_tokens={role: os.getenv(f"HUB_DEMO_{role.upper()}_TOKEN", "") for role in DEMO_ROLES},
            supabase_url=os.getenv("HUB_SUPABASE_URL", "").rstrip("/"),
            hosted_test_simulation=os.getenv("HUB_HOSTED_TEST_SIMULATION", "") == "1",
            admin_origin=os.getenv("HUB_ADMIN_ORIGIN", "").rstrip("/"),
            supabase_storage_key=os.getenv("HUB_SUPABASE_STORAGE_KEY", ""),
        )


@dataclass(frozen=True)
class Actor:
    id: UUID
    role: str
    agency_code: str | None = None


class Authentication:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.issuer = settings.supabase_url.rstrip("/") + "/auth/v1"
        self.jwks = (
            jwt.PyJWKClient(self.issuer + "/.well-known/jwks.json", lifespan=300, timeout=5)
            if settings.auth_mode == "supabase" else None
        )

    def verify_jwt(self, token: str) -> Actor:
        if not self.jwks:
            raise jwt.InvalidTokenError("JWT mode is not configured")
        if jwt.get_unverified_header(token).get("alg") not in {"ES256", "RS256"}:
            raise jwt.InvalidAlgorithmError("Unsupported signing algorithm")
        key = self.jwks.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=self.issuer,
            options={"require": ["exp", "iat", "sub", "iss", "aud"], "strict_aud": True},
        )
        metadata = claims.get("app_metadata")
        role = metadata.get("hub_role") if isinstance(metadata, dict) else None
        if role not in AUTH_ROLES:
            raise jwt.InvalidTokenError("Hub role missing")
        agency = metadata.get("hub_agency") if role == "agency" else None
        if role == "agency" and (not isinstance(agency, str) or not re.fullmatch(r"[A-Z0-9]{2,20}", agency)):
            raise jwt.InvalidTokenError("Canonical Hub agency missing")
        return Actor(UUID(claims["sub"]), role, agency)

    async def __call__(self, request: Request) -> Actor:
        # Do not accept client role headers, user_metadata, or the top-level JWT role.
        if self.settings.auth_mode == "demo" or self.settings.hosted_test_simulation:
            try:
                local = bool(request.client) and ipaddress.ip_address(request.client.host).is_loopback
            except ValueError:
                local = False
            if not local:
                raise failure(403, "local_only", "โหมดสาธิตอนุญาตเฉพาะการเชื่อมต่อภายในเครื่อง")

        authorization = request.headers.get("authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token or len(token) > 16384 or not token.isascii():
            raise failure(401, "unauthenticated", "กรุณาเข้าสู่ระบบเพื่อใช้งาน")

        if self.settings.auth_mode == "demo":
            for role in DEMO_ROLES:
                configured = self.settings.demo_tokens.get(role, "")
                if configured and secrets.compare_digest(token, configured):
                    return Actor(ALL_DEMO_ACTORS[role], "agency" if role in DEMO_AGENCIES else role,
                                 DEMO_AGENCIES.get(role))
        else:
            try:
                return await asyncio.to_thread(self.verify_jwt, token)
            except (jwt.PyJWTError, ValueError, TypeError, KeyError):
                pass
        raise failure(401, "invalid_token", "ข้อมูลเข้าสู่ระบบไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่")
