import copy
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'function'))
from scanner import Drive, Portal, ScanError, ApiError, scan_source, FOLDER, SHORTCUT, request

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

    def test_function_bindings_are_indexable(self):
        from function_app import app
        functions = app.get_functions()
        self.assertEqual({f.get_function_name() for f in functions}, {'dispatch_batches', 'scan_batch', 'engine_dispatch', 'process_engine_job'})


if __name__ == '__main__': unittest.main()
