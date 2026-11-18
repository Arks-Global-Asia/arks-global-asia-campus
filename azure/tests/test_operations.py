import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('arks_operate', Path(__file__).resolve().parents[1] / 'operate.py')
operate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operate)

class OperationsTests(unittest.TestCase):
    def test_enable_applies_selected_ist_schedule_after_recent_smoke(self):
        previous = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            try:
                os.chdir(tmp)
                Path('azure-config.json').write_text(json.dumps({'SUBSCRIPTION_ID':'test','RG':'test','APP':'test','VAULT':'test'}))
                Path('verification.json').write_text(json.dumps({'app':'test','timestamp':time.time()}))
                with patch.object(operate.os, 'chdir'), patch.object(operate,'az'), patch.object(operate,'settings') as settings, patch.object(sys,'argv',['operate.py','enable']):
                    operate.main()
                settings.assert_called_once_with('SCAN_SCHEDULE=0 30 4,21 * * *','AzureWebJobs.scan_batch.Disabled=false','AzureWebJobs.dispatch_batches.Disabled=false')
            finally:
                os.chdir(previous)
