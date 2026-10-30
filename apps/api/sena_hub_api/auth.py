from __future__ import annotations

import asyncio
import ipaddress
import os
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
# Optional local identities, not roles or permission templates. Keep historical
# demo enumerations/UUIDs stable; account_identity still supplies every authority.
LOCAL_UAT_ACTORS = {
    "uat_admin": UUID("ec4582d4-c806-5b44-bc73-d6c358e45a83"),
    "uat_suspended": UUID("d66df957-c45f-5ed7-ac2f-371645c1a91b"),
    "uat_somchai": UUID("2499dad0-228e-5633-9565-20e8935bcc82"),
}
HOSTED_TEST_REF = "eqlrtevwpyboplljgowo"


def simulation_origin(value: str) -> bool:
    url = urlparse(value)
    return (url.scheme == "http" and url.hostname == "127.0.0.1"
            and url.port is not None and 1024 <= url.port <= 65535
            and url.port not in {3000, 8000, 55432}
            and not (url.username or url.password or url.query or url.fragment)
            and url.path == "")


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
    r2_credentials_file: str = field(default="", repr=False)
    r2_private_bucket_confirmed: bool = False

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
                if (database.hostname != "127.0.0.1" or database.port is None
                        or not 1024 <= database.port <= 65535 or database.port == 55432
                        or database.path != "/hub_hosted_test_simulation"
                        or (query and query != {"sslmode": ["disable"]})
                        or not simulation_origin(self.supabase_url)
                        or not simulation_origin(self.admin_origin)):
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
                    or database.username not in {"hub_runtime", f"hub_runtime.{HOSTED_TEST_REF}"}):
                raise ValueError("การตั้งค่าบัญชีระบบ พื้นที่ไฟล์ หรือที่มาของหน้าเว็บ H1 ไม่ถูกต้อง")
            if self.r2_credentials_file:
                if self.supabase_storage_key or not self.r2_private_bucket_confirmed:
                    raise ValueError("R2 ต้องใช้ไฟล์ตั้งค่าฝั่งเซิร์ฟเวอร์และยืนยันว่าปิดการเข้าถึงสาธารณะ")
            elif not self.hosted_test_simulation or len(self.supabase_storage_key) < 20:
                raise ValueError("H1 ต้องตั้งค่า R2 ส่วนตัว ไม่ใช้ Supabase service key")
        elif self.r2_credentials_file or self.r2_private_bucket_confirmed:
            raise ValueError("R2 ชุดนี้ใช้ได้เฉพาะ hosted-test")
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
            uat = [self.demo_tokens.get(persona, "") for persona in LOCAL_UAT_ACTORS]
            existing = [value for value in tokens + extra if value]
            if any(uat) and (any(len(token) < 32 or not token.isascii() for token in uat)
                            or len(set(existing + uat)) != len(existing) + len(uat)):
                raise ValueError("บัญชี UAT ในเครื่องต้องกำหนดครบ 3 token และต่างจากทุกบัญชีเดิม")
        elif self.auth_mode == "supabase":
            if any(self.demo_tokens.get(persona) for persona in LOCAL_UAT_ACTORS):
                raise ValueError("บัญชี UAT ใช้ได้เฉพาะโหมดสาธิตในเครื่อง")
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
            demo_tokens={role: os.getenv(f"HUB_DEMO_{role.upper()}_TOKEN", "") for role in (*DEMO_ROLES, *LOCAL_UAT_ACTORS)},
            supabase_url=os.getenv("HUB_SUPABASE_URL", "").rstrip("/"),
            hosted_test_simulation=os.getenv("HUB_HOSTED_TEST_SIMULATION", "") == "1",
            admin_origin=os.getenv("HUB_ADMIN_ORIGIN", "").rstrip("/"),
            supabase_storage_key=os.getenv("HUB_SUPABASE_STORAGE_KEY", ""),
            r2_credentials_file=os.getenv("HUB_R2_CREDENTIALS_FILE", ""),
            r2_private_bucket_confirmed=os.getenv("HUB_R2_PRIVATE_BUCKET_CONFIRMED", "") == "1",
        )


@dataclass(frozen=True)
class Actor:
    id: UUID
    role: str
    agency_code: str | None = None
    can_manage_users: bool = False


class Authentication:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.issuer = settings.supabase_url.rstrip("/") + "/auth/v1"
        self.jwks = (
            jwt.PyJWKClient(self.issuer + "/.well-known/jwks.json", lifespan=300, timeout=5)
            if settings.auth_mode == "supabase" else None
        )

    def verify_jwt(self, token: str) -> dict:
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
        if claims.get("is_anonymous") or not isinstance(claims.get("email"), str) or "@" not in claims["email"]:
            raise jwt.InvalidTokenError("Verified email identity required")
        UUID(claims["sub"])
        return claims

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

        claims = None
        if self.settings.auth_mode == "demo":
            for role, identity in {**ALL_DEMO_ACTORS, **LOCAL_UAT_ACTORS}.items():
                configured = self.settings.demo_tokens.get(role, "")
                if configured and secrets.compare_digest(token, configured):
                    email = f"{role.replace('_', '-')}@example.test" if role in LOCAL_UAT_ACTORS else f"demo-{role}@example.test"
                    claims = {"sub": str(identity), "email": email}
                    break
        else:
            try:
                claims = await asyncio.to_thread(self.verify_jwt, token)
            except (jwt.PyJWTError, ValueError, TypeError, KeyError):
                pass
        if claims is None:
            raise failure(401, "invalid_token", "ข้อมูลเข้าสู่ระบบไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่")
        account = await self.load_account(request, claims)
        active = account["status"] == "ACTIVE"
        account["role"] = account["hub_role"] if active else None
        account["agency"] = account["agency_code"] if active else None
        request.state.account = account
        limited = (request.url.path == "/v1/me" and request.method == "GET" or
                   request.url.path == "/v1/me/access-request" and request.method in {"POST", "PATCH"} or
                   account["status"] == "PENDING" and request.url.path == "/v1/me/invite-accept" and request.method == "POST")
        if not active and not limited:
            raise failure(403, "account_inactive", "บัญชียังไม่ได้รับอนุมัติหรือถูกระงับ กรุณาตรวจสถานะคำขอ")
        return Actor(UUID(claims["sub"]), account["role"] or "viewer", account["agency"],
                     active and account.get("can_manage_users") is True)

    async def load_account(self, request: Request, claims: dict) -> dict:
        metadata = claims.get("app_metadata") if isinstance(claims.get("app_metadata"), dict) else {}
        display = claims.get("user_metadata") if isinstance(claims.get("user_metadata"), dict) else {}
        async with request.app.state.pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute("SET LOCAL ROLE hub_app")
                await connection.execute("SELECT set_config('app.actor_id', $1, true)", claims["sub"])
                account = await connection.fetchval("SELECT hub.account_identity($1,$2,$3)", claims["email"],
                    str(metadata.get("provider", "email")), str(display.get("full_name", "")))
        return account
