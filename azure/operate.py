"""Cloud Shell: smoke (one dispatch), enable (timer), pause, or status.

Uses signed-in Azure CLI credentials; never prints access tokens or function keys.
"""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error

DEFAULT_SCAN_SCHEDULE = '0 30 4,21 * * *'
cfg = {}
stage = 'initialization'
ORIGIN = 'https://arks-global-asia-institutes.majesticanchovy2.chatgpt.site'


def step(label):
    global stage
    stage = label
    print('Step: ' + label, flush=True)


def required_field(payload, key):
    # Azure CLI versions may return either flattened SDK models or ARM envelopes.
    if isinstance(payload, dict):
        value = payload.get(key)
        if value is None and isinstance(payload.get('properties'), dict):
            value = payload['properties'].get(key)
        if value is not None:
            return value
    raise RuntimeError('Azure response is missing required field: ' + key + '. Response values withheld.')


def az(*args):
    p = subprocess.run(['az', *args, '--only-show-errors', '-o', 'json'], text=True, capture_output=True)
    if p.returncode:
        raise RuntimeError('Azure command failed with exit code ' + str(p.returncode) + '. Sensitive output withheld.')
    return json.loads(p.stdout) if p.stdout.strip() else None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch(url, headers, body=None):
    request = urllib.request.Request(url, headers=headers,
        data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=90) as response:
            data = response.read()
            return json.loads(data) if data else None
    except urllib.error.HTTPError as error:
        raise RuntimeError('Authenticated request returned HTTP ' + str(error.code) + '. Response body withheld.') from None
    except Exception:
        raise RuntimeError('Authenticated request failed; inspect configuration. No credential details logged.') from None


def settings(*values):
    az('functionapp', 'config', 'appsettings', 'set', '-g', cfg['RG'], '-n', cfg['APP'], '--settings', *values)


def portal_headers():
    host = required_field(az('keyvault', 'secret', 'show', '--vault-name', cfg['VAULT'], '--name', 'arks-host-token'), 'value')
    importer = required_field(az('keyvault', 'secret', 'show', '--vault-name', cfg['VAULT'], '--name', 'arks-importer-token'), 'value')
    return {'OAI-Sites-Authorization': 'Bearer ' + host, 'X-Arks-Importer-Token': importer}


def main():
    global cfg, ORIGIN
    os.chdir(Path(__file__).resolve().parent)
    step('read local configuration')
    if not Path('azure-config.json').is_file():
        raise RuntimeError('azure-config.json is missing beside operate.py. Restore that file from your download.')
    cfg = json.loads(Path('azure-config.json').read_text())
    ORIGIN = cfg.get('PORTAL_ORIGIN', ORIGIN).rstrip('/')
    from urllib.parse import urlparse
    parsed = urlparse(ORIGIN)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or parsed.port not in (None,443) or not parsed.hostname or not parsed.hostname.endswith(('.azurestaticapps.net', '.arksglobalasia.cloud', '.chatgpt.site')):
        raise RuntimeError('Invalid portal origin; refusing credential forwarding.')
    missing = [key for key in ('SUBSCRIPTION_ID', 'RG', 'APP', 'VAULT') if not cfg.get(key)]
    if missing:
        raise RuntimeError('azure-config.json is missing fields: ' + ', '.join(missing))
    command = sys.argv[1] if len(sys.argv) == 2 else ''
    if command not in {'smoke', 'enable', 'pause', 'status'}:
        raise RuntimeError('Usage: python3 operate.py smoke|enable|pause|status')
    step('select Azure subscription')
    az('account', 'set', '--subscription', cfg['SUBSCRIPTION_ID'])
    if command == 'pause':
        settings('AzureWebJobs.dispatch_batches.Disabled=true')
        print('Timer paused. Already queued/in-flight jobs may finish.')
        return
    if command == 'status':
        app = az('functionapp', 'show', '-g', cfg['RG'], '-n', cfg['APP'])
        print(json.dumps({'name': required_field(app, 'name'), 'state': required_field(app, 'state'), 'host': required_field(app, 'defaultHostName')}, indent=2))
        return
    if command == 'enable':
        step('check previous smoke verification')
        if not Path('verification.json').is_file():
            raise RuntimeError('No successful smoke verification is recorded. Run smoke before enable.')
        verified = json.loads(Path('verification.json').read_text())
        if verified['app'] != cfg['APP'] or time.time() - verified['timestamp'] > 86400:
            raise RuntimeError('Run a successful smoke check for this app within 24 hours first.')
        settings('SCAN_SCHEDULE=' + DEFAULT_SCAN_SCHEDULE, 'AzureWebJobs.scan_batch.Disabled=false', 'AzureWebJobs.dispatch_batches.Disabled=false')
        print('Azure timer enabled: 03:00 and 10:00 IST daily. Pause the old ChatGPT importer after observing the first scheduled run.')
        return
    step('read portal credentials from Key Vault')
    headers = portal_headers()
    step('check portal access and batch sources')
    before = fetch(ORIGIN + '/api/automation/state', headers)
    wanted = {s['id'] for s in before['sources'] if s['enabled']}
    if not wanted:
        raise RuntimeError('No enabled batch sources. Configure a source in the admin portal first.')
    old_runs = {r['id'] for r in before['runs']}
    step('enable queue worker and keep timer disabled')
    settings('AzureWebJobs.scan_batch.Disabled=false', 'AzureWebJobs.dispatch_batches.Disabled=true')
    step('read Function App hostname')
    app = az('functionapp', 'show', '-g', cfg['RG'], '-n', cfg['APP'])
    host = required_field(app, 'defaultHostName')
    if not re.fullmatch(r'[a-zA-Z0-9.-]+\.azurewebsites\.net', host):
        raise RuntimeError('Unexpected Function App hostname; refusing credential forwarding.')
    step('read function host key')
    key = required_field(az('functionapp', 'keys', 'list', '-g', cfg['RG'], '-n', cfg['APP']), 'masterKey')
    # The host master key permits manual invocation of a disabled timer.
    step('request one scan dispatch')
    fetch('https://' + host + '/admin/functions/dispatch_batches',
          {'x-functions-key': key, 'Content-Type': 'application/json'}, {'input': ''})
    del key
    print(f'One scan dispatch requested for {len(wanted)} batches. Waiting for recorded completion...', flush=True)
    step('wait for a completed Azure scan in portal Run history')
    deadline = time.monotonic() + 2700
    while time.monotonic() < deadline:
        state = fetch(ORIGIN + '/api/automation/state', headers)
        runs = [r for r in state['runs'] if r['id'] not in old_runs and r['source_id'] in wanted]
        # Azure success messages identify this implementation, not the old ChatGPT task.
        done = {r['source_id'] for r in runs if r['status'] == 'succeeded' and r.get('message', '').startswith('Azure Drive scan:')}
        if done >= wanted:
            Path('verification.json').write_text(json.dumps({'app': cfg['APP'], 'timestamp': time.time(), 'sources': sorted(done)}))
            print('Verified: Azure completed Drive scans for every enabled batch. Timer remains disabled; run enable when ready.')
            return
        if any(r['status'] == 'failed' for r in runs):
            raise RuntimeError('A scan failed. Read Admin > Automation > Run history; fix the cause and rerun smoke.')
        if any(r['status'] == 'partial' for r in runs):
            raise RuntimeError('Scan saved a continuation cursor. Rerun smoke to continue; timer remains disabled.')
        time.sleep(15)
    raise RuntimeError('Verification timed out. Inspect the queue, function logs and Run history; timer remains disabled.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, TypeError) as error:
        # Never print SDK errors, unexpected field contents, or raw response bodies.
        detail = str(error) if isinstance(error, RuntimeError) else {
            'KeyError': 'An unexpected response field is missing; no secret values shown.',
            'ValueError': 'The response or configuration is not valid JSON or has an invalid value.',
            'TypeError': 'The response has an unexpected data structure.',
        }.get(type(error).__name__, 'A required file or command could not be accessed.')
        print('Failed at step: ' + stage + '\n' + detail, file=sys.stderr)
        sys.exit(1)
