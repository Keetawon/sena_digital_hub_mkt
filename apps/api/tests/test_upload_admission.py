"""Port-free checks for finite headers and the complete worker lifetime lease."""
import asyncio
import json
from threading import Event
import unittest

from sena_hub_api.upload_admission import UploadAdmissionError, parse_upload_context, run_upload_work, upload_slot


class UploadAdmissionChecks(unittest.TestCase):
    def test_context_is_finite_and_preserves_opaque_identity(self):
        context = {'v': 1, 'kind': 'project', 'ref': ' 0001 ', 'category': None, 'purpose': 'media'}
        self.assertEqual(parse_upload_context([json.dumps(context)]), context)
        self.assertEqual(parse_upload_context(['{"v":1,"kind":"intake"}']), {'v': 1, 'kind': 'intake'})
        candidate = {'v': 1, 'kind': 'knowledge', 'candidate_id': 'AAAA0000-0000-4000-8000-000000000001'}
        self.assertEqual(parse_upload_context([json.dumps(candidate)])['candidate_id'], candidate['candidate_id'].lower())
        invalid = [[], ['{}', '{}'], [''], ['x' * 2049], ['[]'], ['null'],
                   ['{"v":1,"v":1,"kind":"intake"}'], ['{"v":NaN,"kind":"intake"}'],
                   ['{"v":true,"kind":"intake"}'], ['{"v":1,"kind":"intake"}\n']]
        for key in context:
            invalid.append([json.dumps({name: value for name, value in context.items() if name != key})])
        for key in ('actor_id', 'coordinates', 'processing', 'checksum', 'suggestions', 'permissions'):
            invalid.append([json.dumps(context | {key: 'invented'})])
        for key, values in {'v': [True, 0, 2, '1'], 'kind': ['unknown', [], None],
                            'ref': ['', [], {}, None, 'x' * 201, '\n', '\u0e01'],
                            'purpose': ['unknown', 'banner', None], 'category': [False, [], {}]}.items():
            invalid.extend([[json.dumps(context | {key: value})] for value in values])
        invalid.append([json.dumps(candidate | {'candidate_id': 'invalid'})])
        for index, headers in enumerate(invalid):
            with self.subTest(index=index):
                with self.assertRaisesRegex(UploadAdmissionError, '^invalid_upload_context$'):
                    parse_upload_context(headers)

    def test_admission_is_not_queued_and_releases_on_failure(self):
        with self.assertRaisesRegex(RuntimeError, '^synthetic$'):
            with upload_slot():
                with self.assertRaisesRegex(UploadAdmissionError, '^upload_busy$'):
                    with upload_slot():
                        self.fail('second body must not be admitted')
                raise RuntimeError('synthetic')
        with upload_slot():
            pass

    def test_cancellation_keeps_admission_until_the_thread_finishes(self):
        async def check():
            started, release, finished = Event(), Event(), Event()
            def work():
                started.set()
                try:
                    if not release.wait(3):
                        raise RuntimeError('worker release deadline')
                    return 42
                finally:
                    finished.set()
            async def owned():
                with upload_slot():
                    return await run_upload_work(work)
            task = asyncio.create_task(owned())
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 2))
                for _ in range(2):
                    task.cancel()
                    await asyncio.sleep(0)
                    self.assertFalse(finished.is_set())
                    with self.assertRaisesRegex(UploadAdmissionError, '^upload_busy$'):
                        with upload_slot():
                            self.fail('cancelled request released a live decoder')
            finally:
                release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await asyncio.wait_for(task, 3)
            self.assertTrue(finished.is_set())
            with upload_slot():
                self.assertEqual(await run_upload_work(lambda: 7), 7)
        asyncio.run(check())


if __name__ == '__main__':
    unittest.main()
