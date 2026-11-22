import copy
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'function'))
from scanner import (
    Drive,
    Portal,
    ScanError,
    ApiError,
    scan_source,
    parse_source_filters,
    EXTENSIONS,
    ORIGIN,
    FOLDER,
    SHORTCUT,
    request,
)

ROOT = 'root_folder_123456'
SOURCE = {'id': 'source', 'generation': 1, 'folder_id': ROOT, 'folder_input': 'Batch'}


def file(id='file_123456789', **updates):
    return {'id': id, 'name': 'Day1.pdf', 'mimeType': 'application/pdf', 'size': '3',
            'parents': [ROOT], 'modifiedTime': '2026-11-17T01:00:00Z', **updates}


class Memory:
    def __init__(self): self.data = {}
    def load(self, key): return copy.deepcopy(self.data.get(key))
    def save(self, key, value): self.data[key] = copy.deepcopy(value)


class FakePortal:
    def __init__(self):
        self.calls, self.uploads, self.known = [], [], {}
        self.busy, self.upload_error = False, False
    def call(self, action, body=None):
        self.calls.append((action, body))
        if action == 'claim':
            if self.busy: raise ApiError(409)
            return {'run_id': 'run', 'source': copy.deepcopy(SOURCE)}
        if action == 'ingest':
            out = []
            for f in body['items']:
                key = (f['drive_file_id'], f['revision'])
                out.append(self.known.setdefault(key, {'id': f['drive_file_id'], 'status':
                    'restricted' if 'results' in f['name'] else 'pending'}).copy())
            return {'items': out}
        return {'ok': True}
    def upload(self, run_id, item_id, file, data):
        if self.upload_error: raise ScanError('Upload unavailable.')
        self.uploads.append(item_id)
        self.known[(file['id'], file['modifiedTime'])]['file_id'] = 'copied'


class FakeDrive:
    def __init__(self, pages): self.pages, self.tokens, self.downloads = pages, [], []
    def resolve(self, source): return {'id': ROOT, 'name': 'Batch', 'mimeType': FOLDER}
    def verify_ancestry(self, ancestors): pass
    def page(self, query, token=None):
        self.tokens.append(token)
        return self.pages[token]
    def copy(self, f):
        self.downloads.append(f['id'])
        return b'PDF'


class ScannerTests(unittest.TestCase):
    def test_no_publish_and_restricted_files_never_downloaded(self):
        p, c = FakePortal(), Memory()
        d = FakeDrive({None: {'files': [file(), file('results_123456', name='results.xlsx')]}})
        self.assertEqual(scan_source(p, d, c, 'source'), 'succeeded')
        self.assertEqual(d.downloads, ['file_123456789'])
        self.assertTrue(all(a in {'claim', 'resolve', 'ingest', 'finish'} for a, _ in p.calls))
        self.assertEqual(p.calls[-1][1]['discovered'], 2)

    def test_duplicate_scan_does_not_recopy(self):
        p, c = FakePortal(), Memory()
        d = FakeDrive({None: {'files': [file()]}})
        scan_source(p, d, c, 'source')
        scan_source(p, d, c, 'source')
        self.assertEqual(len(p.uploads), 1)

    def test_pagination_checkpoint_resumes_without_starvation(self):
        p, c = FakePortal(), Memory()
        d = FakeDrive({None: {'files': [file()], 'nextPageToken': 'page2'},
                       'page2': {'files': [file('file_234567890')]}})
        self.assertEqual(scan_source(p, d, c, 'source', max_pages=1), 'partial')
        self.assertEqual(c.load('source')['pending'][0]['token'], 'page2')
        self.assertEqual(scan_source(p, d, c, 'source'), 'succeeded')
        self.assertEqual(d.tokens, [None, 'page2'])
        self.assertIsNone(c.load('source'))

    def test_failed_upload_does_not_advance_cursor(self):
        p, c = FakePortal(), Memory()
        p.upload_error = True
        d = FakeDrive({None: {'files': [file()], 'nextPageToken': 'next'}})
        with self.assertRaises(ScanError): scan_source(p, d, c, 'source')
        self.assertIsNone(c.load('source'))
        self.assertEqual(p.calls[-1][1]['status'], 'failed')

    def test_generation_change_discards_old_cursor(self):
        p, c = FakePortal(), Memory()
        c.save('source', {'key': '0:' + ROOT, 'pending': [{'token': 'old'}]})
        d = FakeDrive({None: {'files': []}})
        scan_source(p, d, c, 'source')
        self.assertEqual(d.tokens, [None])

    def test_active_lease_skips_without_drive_access(self):
        p = FakePortal(); p.busy = True
        self.assertEqual(scan_source(p, None, Memory(), 'source'), 'skipped')

    def test_native_and_large_files_remain_links(self):
        p, c = FakePortal(), Memory()
        d = FakeDrive({None: {'files': [file(mimeType='application/vnd.google-apps.document'),
                                       file('large_123456789', size=str(30*1024*1024))]}})
        scan_source(p, d, c, 'source')
        self.assertEqual(d.downloads, [])

    def test_skip_student_submission_folder_and_shortcuts(self):
        p, c = FakePortal(), Memory()
        d = FakeDrive({None: {'files': [file(name='lab_answers', mimeType=FOLDER), file(mimeType=SHORTCUT)]}})
        scan_source(p, d, c, 'source')
        self.assertFalse(any(a == 'ingest' for a, _ in p.calls))

    def test_outside_parent_is_not_ingested(self):
        p, c = FakePortal(), Memory()
        d = FakeDrive({None: {'files': [file(parents=['different_folder'])]}})
        with self.assertRaises(ScanError): scan_source(p, d, c, 'source')
        self.assertFalse(any(a == 'ingest' for a, _ in p.calls))

    def test_ambiguous_folder_name_is_rejected(self):
        d = Drive(None)
        d.page = Mock(return_value={'files': [{'id': 'a'}, {'id': 'b'}]})
        with self.assertRaises(ScanError): d.resolve({'folder_input': 'Batch'})

    def test_changed_download_is_not_accepted(self):
        d = Drive(None)
        d.get = Mock(return_value=file(modifiedTime='later'))
        r = Mock(); r.iter_content.return_value = [b'PDF']
        with patch('scanner.request') as call:
            call.return_value.__enter__.return_value = r
            with self.assertRaises(ScanError): d.copy(file())

    def test_redirect_is_rejected_and_headers_not_logged(self):
        session = Mock()
        session.request.return_value.status_code = 302
        with self.assertRaises(ApiError): request(session, 'GET', 'https://example.org')
        self.assertFalse(session.request.call_args.kwargs['allow_redirects'])

    def test_portal_disallows_admin_operations(self):
        with patch.dict(os.environ, {'ARKS_HOST_TOKEN': 'test', 'ARKS_IMPORTER_TOKEN': 'test'}):
            with self.assertRaises(ScanError): Portal().call('review', {})

    def test_portal_origin_optional_host_token_and_schedule_assessments(self):
        self.assertEqual(ORIGIN, 'https://student-portal.arksglobalasia.cloud')
        with patch.dict(os.environ, {'ARKS_IMPORTER_TOKEN': 'imp-token'}, clear=False):
            os.environ.pop('ARKS_HOST_TOKEN', None)
            p_no_host = Portal()
            self.assertEqual(p_no_host.session.headers.get('X-Arks-Importer-Token'), 'imp-token')
            self.assertNotIn('OAI-Sites-Authorization', p_no_host.session.headers)

        with patch.dict(os.environ, {'ARKS_IMPORTER_TOKEN': 'imp-token', 'ARKS_HOST_TOKEN': 'host-secret'}):
            p_with_host = Portal()
            self.assertEqual(p_with_host.session.headers.get('OAI-Sites-Authorization'), 'Bearer host-secret')
            with patch('scanner.request') as mock_req:
                mock_resp = Mock()
                mock_resp.json.return_value = {'mode': 'daily', 'results': []}
                mock_req.return_value.__enter__.return_value = mock_resp
                res = p_with_host.call('schedule-assessments', {'mode': 'daily'})
                self.assertEqual(res['mode'], 'daily')

    def test_extensions_and_per_source_exclusion_filters(self):
        for ext_file in [
            'diagram.png', 'arch.jpg', 'flow.webp', 'icon.svg',
            'guide.pdf', 'slides.pptx', 'notes.docx', 'readme.md',
            'pod.yaml', 'deploy.yml', 'setup.sh', 'app.py', 'config.json', 'archive.zip'
        ]:
            self.assertIsNotNone(EXTENSIONS.search(ext_file), f'Expected {ext_file} to match EXTENSIONS')

        skip_folders, skip_exts = parse_source_filters({
            'config': json.dumps({
                'excluded_folders': ['trainer_private', 'archive Drafts'],
                'excluded_extensions': ['tmp', '.bak'],
            })
        })
        self.assertEqual(skip_folders, {'trainer_private', 'archive_drafts'})
        self.assertEqual(skip_exts, {'.tmp', '.bak'})

        # Verify scan_source skips custom excluded folders & extensions while scanning images and resource_creation
        p, c = FakePortal(), Memory()
        custom_source = {
            **SOURCE,
            'config': json.dumps({
                'excluded_folders': ['secret_solutions'],
                'excluded_extensions': ['.bak'],
            }),
        }
        orig_call = p.call
        p.call = lambda action, body=None: (
            {'run_id': 'run', 'source': copy.deepcopy(custom_source)}
            if action == 'claim'
            else orig_call(action, body)
        )
        d = FakeDrive({
            None: {
                'files': [
                    file('dir_secret123', name='secret_solutions', mimeType=FOLDER),
                    file('dir_images123', name='images', mimeType=FOLDER),
                    file('file_bak_1234', name='notes.bak', mimeType='text/plain'),
                    file('file_img_1234', name='architecture.png', mimeType='image/png'),
                    file('file_yaml1234', name='deployment.yaml', mimeType='text/yaml'),
                ]
            },
        })
        orig_page = d.page
        d.page = lambda q, token=None: (
            {'files': [file('file_sub_img1', name='vpc.jpg', mimeType='image/jpeg', parents=['dir_images123'])]}
            if "'dir_images123' in parents" in q
            else orig_page(q, token)
        )
        self.assertEqual(scan_source(p, d, c, 'source'), 'succeeded')
        self.assertEqual(d.downloads, ['file_img_1234', 'file_yaml1234', 'file_sub_img1'])

    def test_function_bindings_are_indexable(self):
        import types
        if 'azure.functions' not in sys.modules:
            try:
                import azure.functions  # noqa: F401
            except ModuleNotFoundError:
                azure_mod = sys.modules.setdefault('azure', types.ModuleType('azure'))
                func_mod = types.ModuleType('azure.functions')

                class _RegisteredFunction:
                    def __init__(self, name): self._name = name
                    def get_function_name(self): return self._name

                class _FakeFunctionApp:
                    def __init__(self): self._fns = []
                    def function_name(self, name):
                        def dec(fn):
                            self._fns.append(_RegisteredFunction(name))
                            return fn
                        return dec
                    def timer_trigger(self, **kw): return lambda fn: fn
                    def queue_output(self, **kw): return lambda fn: fn
                    def queue_trigger(self, **kw): return lambda fn: fn
                    def route(self, **kw): return lambda fn: fn
                    def get_functions(self): return list(self._fns)

                func_mod.FunctionApp = _FakeFunctionApp
                func_mod.TimerRequest = object
                func_mod.Out = MagicMock = type('Out', (), {'__class_getitem__': classmethod(lambda cls, item: cls)})
                func_mod.QueueMessage = object
                func_mod.HttpRequest = object
                func_mod.HttpResponse = object
                func_mod.AuthLevel = type('AuthLevel', (), {'FUNCTION': 'function'})
                sys.modules['azure.functions'] = func_mod
                azure_mod.functions = func_mod

                core_mod = sys.modules.setdefault('azure.core', types.ModuleType('azure.core'))
                exc_mod = types.ModuleType('azure.core.exceptions')
                exc_mod.ResourceNotFoundError = Exception
                sys.modules['azure.core.exceptions'] = exc_mod
                core_mod.exceptions = exc_mod

                storage_mod = sys.modules.setdefault('azure.storage', types.ModuleType('azure.storage'))
                blob_mod = types.ModuleType('azure.storage.blob')
                blob_mod.BlobServiceClient = object
                sys.modules['azure.storage.blob'] = blob_mod
                storage_mod.blob = blob_mod

        from function_app import app
        functions = app.get_functions()
        self.assertEqual(
            {f.get_function_name() for f in functions},
            {'dispatch_batches', 'schedule_morning_assessments', 'scan_batch', 'engine_dispatch', 'process_engine_job'},
        )


if __name__ == '__main__': unittest.main()
