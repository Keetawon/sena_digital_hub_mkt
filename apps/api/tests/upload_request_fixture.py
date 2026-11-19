"""Synthetic authority only; real ASGI body, supervisor, validator and local files."""
from contextlib import asynccontextmanager, contextmanager
import json
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
from sena_hub_api import assets, main
from sena_hub_api.auth import Authentication, ALL_DEMO_ACTORS
from test_api import settings, TOKENS

CONTEXT={"v":1,"kind":"project","ref":"synthetic","category":"exterior","purpose":"media"}

@contextmanager
def request_fixture(root, mime):
    root = root.resolve()
    state=SimpleNamespace(tx=0, saved=None, calls=[])
    resolved={"context":CONTEXT,"processing_class":"marketing_pdf" if mime=="application/pdf" else "marketing_raster",
              "input_limit":(50 if mime=="application/pdf" else 30)*1024*1024,
              "stored_limit":(20 if mime=="application/pdf" else 10)*1024*1024,"pixel_limit":100_000_000,
              "coordinates":None,"active_tags":[],"context_stamp":"synthetic"}
    class Connection:
        async def fetchval(self,sql,*args):
            state.calls.append(sql)
            if "asset_upload_context" in sql:return resolved
            if "find_uploaded_asset_source" in sql:return None
            if "record_asset_upload_source" in sql:
                state.saved=args
                return {"asset":dict(args[0],id="10000000-0000-0000-0000-000000000001"),"reused":False,"reuse_kind":"none",
                        "upload":{"original":{k:v for k,v in args[1].items() if k!="checksum"},"processing":args[2],"suggestions":args[3]}}
            if "asset_registered_for_cleanup" in sql:return False
            raise AssertionError(sql)
    @asynccontextmanager
    async def database(request,actor):
        state.tx+=1
        try:yield Connection()
        finally:state.tx-=1
    async def account(self, request, claims):
        assert claims["sub"] == str(ALL_DEMO_ACTORS["editor"])
        return {"id":claims["sub"],"email":claims["email"],"status":"ACTIVE","hub_role":"editor",
                "agency_code":None,"display_name_th":"synthetic","can_manage_users":False,
                "capabilities":{"tabs":{tab:{"view":True,"edit":True,"approve":False}
                                        for tab in ("projects","brands","promotions","knowledge")},
                                "special_actions":{}}}
    headers={"Authorization":"Bearer "+TOKENS["editor"],"Content-Type":mime,
             "X-Filename":"synthetic."+assets.FORMATS[mime][1],"X-Upload-Context":json.dumps(CONTEXT)}
    with patch.object(assets,"STORAGE_ROOT",root),patch.object(main,"database",database),patch.object(Authentication,"load_account",account):
        client=TestClient(main.create_app(settings()),client=("127.0.0.1",50000))
        try:yield client,headers,state
        finally:client.close()
