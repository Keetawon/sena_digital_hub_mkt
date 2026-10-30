"""Loopback test entry point: inject the fictional R2 config without a file."""
import os
from urllib.parse import urlparse
from unittest.mock import Mock, patch

import uvicorn

from sena_hub_api import main, r2_assets
from sena_hub_api.auth import Settings


settings = Settings.from_env()  # Validates the disposable loopback DB/Auth/admin addresses.
if not settings.hosted_test_simulation or settings.r2_credentials_file != "memory:h1-r2":
    raise SystemExit("The H1 test entry point requires the loopback simulation")
config = os.environ.pop("HUB_H1_R2_CONFIG")


def configuration_path(value):
    if value != "memory:h1-r2":
        raise ValueError("Unexpected H1 configuration path")
    return Mock(read_text=Mock(return_value=config))


# Replace only the config read, during app construction. The actual R2 client,
# destination checks, signatures, Auth and DB permission checks remain in use.
with patch.object(r2_assets, "Path", side_effect=configuration_path):
    app = main.create_app(settings)
del config
api = urlparse(os.environ['HUB_API_URL'])
if api.scheme != 'http' or api.hostname != '127.0.0.1' or not api.port or api.port in {3000, 8000, 55432}:
    raise SystemExit('H1 API requires a separate loopback port')
uvicorn.run(app, host="127.0.0.1", port=api.port, proxy_headers=False, access_log=False)
