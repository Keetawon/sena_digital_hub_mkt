"""Port-free checks for a real supervised decoder and its lifetime admission."""
import asyncio
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
from sena_hub_api import assets
from sena_hub_api.upload_admission import UploadAdmissionError, upload_slot
from sena_hub_api.upload_optimization import UploadProcessingError
from sena_hub_api.upload_pipeline import prepare_authorized_upload

RESOLVED = {"processing_class": "marketing_raster", "context": {"category": "gallery"},
            "active_tags": [], "coordinates": None}


def source():
    output = io.BytesIO()
    Image.new("RGB", (8, 6), "blue").save(output, "PNG")
    return output.getvalue()


class SupervisionChecks(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(importlib.util.find_spec("sena_hub_api.upload_supervision"),
                             "killable upload supervisor is missing")
        from sena_hub_api import upload_supervision
        return upload_supervision

    def test_child_returns_validated_content_and_thumbnail_then_cleans_ipc(self):
        supervisor = self.module()
        data = source()
        expected = prepare_authorized_upload(data, "image/png", "test.png", RESOLVED)
        with tempfile.TemporaryDirectory() as temporary, patch.object(assets, "STORAGE_ROOT", Path(temporary).resolve()):
            actual = asyncio.run(supervisor.prepare_supervised_upload(data, "image/png", "test.png", RESOLVED))
            self.assertEqual(actual.content, expected.content)
            self.assertEqual(actual.metadata, expected.metadata)
            self.assertEqual(actual.original, expected.original)
            self.assertIsNone(actual.thumbnail_error)
            with Image.open(io.BytesIO(actual.thumbnail)) as thumbnail:
                self.assertEqual(thumbnail.format, "WEBP")
                self.assertLessEqual(max(thumbnail.size), 96)
            self.assertFalse(list((Path(temporary) / ".upload-work").iterdir()))

    def test_rejection_survives_child_boundary_without_decoder_text(self):
        supervisor = self.module()
        from test_upload_limits import png
        with tempfile.TemporaryDirectory() as temporary, patch.object(assets, "STORAGE_ROOT", Path(temporary).resolve()):
            with self.assertRaisesRegex(UploadProcessingError, "^png_hdr_requires_export$"):
                asyncio.run(supervisor.prepare_supervised_upload(png(2, 2, 8, 16), "image/png", "test.png", RESOLVED))
            self.assertFalse(list((Path(temporary) / ".upload-work").iterdir()))

    def test_child_environment_does_not_inherit_private_values(self):
        supervisor = self.module()
        with patch.dict(os.environ, {"HUB_DATABASE_URL": "synthetic-secret", "AWS_SECRET_ACCESS_KEY": "synthetic-secret"}):
            environment = supervisor.child_environment(Path(tempfile.gettempdir()))
        self.assertNotIn("HUB_DATABASE_URL", environment)
        self.assertNotIn("AWS_SECRET_ACCESS_KEY", environment)
        self.assertEqual(environment["MALLOC_ARENA_MAX"], "2")

    def test_timeout_reaps_child_and_removes_private_ipc(self):
        supervisor = self.module()
        with tempfile.TemporaryDirectory() as temporary, patch.object(assets, "STORAGE_ROOT", Path(temporary).resolve()):
            script = Path(temporary) / "synthetic_child.py"
            script.write_text("import time\ntime.sleep(30)\n", encoding="utf-8")
            with patch.object(supervisor, "CHILD_SCRIPT", script):
                with self.assertRaisesRegex(UploadProcessingError, "^upload_processing_timeout$"):
                    asyncio.run(supervisor.prepare_supervised_upload(source(), "image/png", "test.png", RESOLVED, timeout=0.2))
            self.assertFalse(list((Path(temporary) / ".upload-work").iterdir()))
            actual = asyncio.run(supervisor.prepare_supervised_upload(source(), "image/png", "test.png", RESOLVED))
            self.assertTrue(actual.content)

    def test_malformed_child_result_is_rejected_and_cleaned(self):
        supervisor = self.module()
        with tempfile.TemporaryDirectory() as temporary, patch.object(assets, "STORAGE_ROOT", Path(temporary).resolve()):
            script = Path(temporary) / "synthetic_child.py"
            script.write_text("import pathlib,sys\n(pathlib.Path(sys.argv[1])/'result.json').write_text('[]')\n", encoding="utf-8")
            with patch.object(supervisor, "CHILD_SCRIPT", script):
                with self.assertRaisesRegex(UploadProcessingError, "^upload_processing_failed$"):
                    asyncio.run(supervisor.prepare_supervised_upload(source(), "image/png", "test.png", RESOLVED))
            self.assertFalse(list((Path(temporary) / ".upload-work").iterdir()))

    @unittest.skipUnless(os.name == "posix", "POSIX process-group cancellation case")
    def test_cancel_retains_slot_until_uncooperative_child_is_reaped(self):
        supervisor = self.module()
        async def exercise(temporary):
            pid_file = Path(temporary) / "ready"
            script = Path(temporary) / "synthetic_child.py"
            script.write_text("import os,pathlib,signal,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\n"
                              + f"pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid()))\n"
                              + "time.sleep(30)\n", encoding="utf-8")
            async def owned():
                with upload_slot():
                    return await supervisor.prepare_supervised_upload(source(), "image/png", "test.png", RESOLVED)
            with patch.object(supervisor, "CHILD_SCRIPT", script):
                task = asyncio.create_task(owned())
                for _ in range(200):
                    if pid_file.exists():
                        break
                    await asyncio.sleep(0.01)
                self.assertTrue(pid_file.exists())
                child_pid = int(pid_file.read_text())
                task.cancel()
                await asyncio.sleep(0.05)
                task.cancel()
                with self.assertRaisesRegex(UploadAdmissionError, "^upload_busy$"):
                    with upload_slot():
                        self.fail("live child released admission")
                with self.assertRaises(asyncio.CancelledError):
                    await asyncio.wait_for(task, 4)
                with self.assertRaises(ProcessLookupError):
                    os.kill(child_pid, 0)
            with upload_slot():
                result = await supervisor.prepare_supervised_upload(source(), "image/png", "test.png", RESOLVED)
                self.assertTrue(result.content)
        with tempfile.TemporaryDirectory() as temporary, patch.object(assets, "STORAGE_ROOT", Path(temporary).resolve()):
            asyncio.run(exercise(temporary))


    def test_slot_is_shared_with_another_api_process(self):
        import subprocess, sys
        with tempfile.TemporaryDirectory() as temporary, patch.object(assets, "STORAGE_ROOT", Path(temporary).resolve()):
            script = ("from pathlib import Path; from sena_hub_api import assets; "
                      "from sena_hub_api.upload_admission import upload_slot; "
                      + f"assets.STORAGE_ROOT=Path({temporary!r}).resolve(); "
                      + "\nwith upload_slot(): print('admitted')\n")
            environment=dict(os.environ, PYTHONPATH=str(Path(assets.__file__).parents[1]))
            with upload_slot():
                denied=subprocess.run([sys.executable,"-c",script],env=environment,capture_output=True,timeout=10)
                self.assertNotEqual(denied.returncode,0)
                self.assertIn(b"upload_busy",denied.stderr)
            admitted=subprocess.run([sys.executable,"-c",script],env=environment,capture_output=True,timeout=10)
            self.assertEqual(admitted.returncode,0,admitted.stderr)
            self.assertEqual(admitted.stdout.strip(),b"admitted")

    def test_cancel_during_spawn_still_reaps_owned_child(self):
        supervisor=self.module()
        async def exercise(temporary):
            script=Path(temporary)/"synthetic_child.py"
            script.write_text("import time\ntime.sleep(30)\n",encoding="utf-8")
            original=asyncio.create_subprocess_exec
            started=asyncio.Event();children=[]
            async def delayed(*args,**kwargs):
                child=await original(*args,**kwargs)
                children.append(child);started.set()
                await asyncio.sleep(0.1)
                return child
            with patch.object(supervisor,"CHILD_SCRIPT",script),patch.object(asyncio,"create_subprocess_exec",delayed):
                task=asyncio.create_task(supervisor.prepare_supervised_upload(source(),"image/png","test.png",RESOLVED))
                await asyncio.wait_for(started.wait(),3)
                task.cancel()
                try:
                    with self.assertRaises(asyncio.CancelledError):
                        await asyncio.wait_for(task,3)
                    self.assertIsNotNone(children[0].returncode,"cancelled spawn orphaned a child")
                finally:
                    for child in children:
                        if child.returncode is None: child.kill();await child.wait()
        with tempfile.TemporaryDirectory() as temporary,patch.object(assets,"STORAGE_ROOT",Path(temporary).resolve()):
            asyncio.run(exercise(temporary))


    @unittest.skipUnless(os.name == "posix", "POSIX disconnect process group case")
    def test_client_disconnect_reaps_child_and_releases_slot(self):
        supervisor=self.module()
        async def exercise(temporary):
            pid_file=Path(temporary)/"ready"
            script=Path(temporary)/"synthetic_child.py"
            script.write_text("import os,pathlib,signal,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\n"
                              +f"pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid()))\n"
                              +"time.sleep(30)\n",encoding="utf-8")
            async def disconnected(): return pid_file.exists()
            with patch.object(supervisor,"CHILD_SCRIPT",script),upload_slot():
                with self.assertRaises(asyncio.CancelledError):
                    await supervisor.prepare_supervised_upload(source(),"image/png","test.png",RESOLVED,
                                                               disconnected=disconnected)
            with self.assertRaises(ProcessLookupError):os.kill(int(pid_file.read_text()),0)
            with upload_slot():pass
        with tempfile.TemporaryDirectory() as temporary,patch.object(assets,"STORAGE_ROOT",Path(temporary).resolve()):
            asyncio.run(exercise(temporary))


if __name__ == "__main__":
    unittest.main()
