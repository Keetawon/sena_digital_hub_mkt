import os

import uvicorn

from .auth import Settings


settings = Settings.from_env()
host = os.getenv("HUB_HOST", "127.0.0.1")
if settings.auth_mode == "demo" and host not in {"127.0.0.1", "::1"}:
    raise SystemExit("โหมดสาธิตต้องฟังเฉพาะ loopback")

uvicorn.run(
    "sena_hub_api.main:create_app", factory=True,
    host=host, port=int(os.getenv("HUB_PORT", "8000")),
    proxy_headers=False,
)
