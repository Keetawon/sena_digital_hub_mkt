"""Port-free full-route checks; database policy has separate disposable tests."""
import io
import struct
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
from sena_hub_api import assets
from sena_hub_api.upload_admission import upload_slot
from upload_request_fixture import request_fixture
from test_upload_limits import png, pdf

class FullRequestChecks(unittest.TestCase):
    def test_child_creates_thumbnail_without_parent_decoder(self):
        stream=io.BytesIO();Image.new("RGB",(12,8),"blue").save(stream,"PNG")
        with tempfile.TemporaryDirectory() as temporary,request_fixture(Path(temporary),"image/png") as (client,headers,state):
            with patch.object(assets,"render_thumbnail",side_effect=AssertionError("parent decoded thumbnail")):
                response=client.post("/v1/admin/assets",headers=headers,content=stream.getvalue())
            self.assertEqual(response.status_code,201,response.text)
            metadata=response.json()["data"]
            self.assertTrue(assets.thumbnail_path(metadata).is_file(),"child thumbnail was not installed")
            self.assertFalse(list((Path(temporary)/".upload-work").iterdir()))
            self.assertEqual(state.tx,0)
            self.assertEqual(client.get("/health").status_code,200)

    def test_hdr_and_pixel_rejection_messages_are_actionable(self):
        for data,code,words in [
            (png(6001,4000), "png_pixel_limit", "24"),
            (png(2,2,8,16),"png_hdr_requires_export","8-bit sRGB"),
            (png(2,2,16,18),"png_hdr_requires_export","8-bit sRGB"),
        ]:
            with self.subTest(code=code),tempfile.TemporaryDirectory() as temporary,request_fixture(Path(temporary),"image/png") as (client,headers,state):
                response=client.post("/v1/admin/assets",headers=headers,content=data)
                self.assertEqual(response.status_code,422,response.text)
                self.assertEqual(response.json()["error"]["code"],code)
                self.assertIn(words,response.json()["error"]["message"])
                self.assertIsNone(state.saved)

    def test_pdf_and_webp_limits_keep_their_actionable_messages_through_child(self):
        payload = b"\0" * 4 + (6001 - 1).to_bytes(3, "little") + (4000 - 1).to_bytes(3, "little")
        webp = b"RIFF" + struct.pack("<I", 22) + b"WEBPVP8X" + struct.pack("<I", 10) + payload
        for mime,data,code,words in (
            ("application/pdf",pdf([(6001,4000,8)]),"pdf_image_pixel_limit","24"),
            ("application/pdf",pdf([(3000,4001,16)]),"pdf_image_pixel_limit","24"),
            ("application/pdf",pdf([(3000,4000,8)],mask=(3000,4001,8)),"pdf_image_pixel_limit","24"),
            ("application/pdf",pdf([(6000,4000,8)]*10+[(1,1,8)]),"pdf_pixel_limit","240"),
            ("image/webp",webp,"webp_pixel_limit","24"),
        ):
            with self.subTest(code=code),tempfile.TemporaryDirectory() as temporary,request_fixture(Path(temporary),mime) as (client,headers,state):
                response=client.post("/v1/admin/assets",headers=headers,content=data)
                self.assertEqual(response.status_code,422,response.text)
                self.assertEqual(response.json()["error"]["code"],code)
                self.assertIn(words,response.json()["error"]["message"])
                self.assertIsNone(state.saved)

    def test_existing_animated_image_error_contract_is_preserved(self):
        content=io.BytesIO()
        Image.new("RGB",(2,2),"blue").save(content,"PNG",save_all=True,append_images=[Image.new("RGB",(2,2),"red")],duration=100)
        with tempfile.TemporaryDirectory() as temporary,request_fixture(Path(temporary),"image/png") as (client,headers,state):
            response=client.post("/v1/admin/assets",headers=headers,content=content.getvalue())
            self.assertEqual(response.status_code,422,response.text)
            self.assertEqual(response.json()["error"]["code"],"invalid_upload_file")
            self.assertIsNone(state.saved)

    def test_second_request_is_retryable_before_body_read(self):
        with tempfile.TemporaryDirectory() as temporary,request_fixture(Path(temporary),"image/png") as (client,headers,state):
            with upload_slot(),patch.object(assets,"read_upload",side_effect=AssertionError("busy request read body")):
                response=client.post("/v1/admin/assets",headers=headers,content=b"unread")
            self.assertEqual(response.status_code,429)
            self.assertEqual(response.headers["retry-after"],"1")
            self.assertEqual(response.headers["cache-control"],"no-store")
            self.assertIsNone(state.saved)
if __name__=="__main__":unittest.main()
