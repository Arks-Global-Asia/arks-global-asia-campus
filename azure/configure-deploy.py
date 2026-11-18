"""Run in Azure Cloud Shell after both setup scripts. Secret input is hidden."""
import getpass
import json
from pathlib import Path
import subprocess
import zipfile
import os

os.chdir(Path(__file__).resolve().parent)
config = json.loads(Path('azure-config.json').read_text())
google = json.loads(Path('google-config.json').read_text())


def az(*args, data=None):
    p = subprocess.run(['az', *args, '--only-show-errors', '-o', 'none'],
                       input=data, text=True, capture_output=True)
    if p.returncode:
        raise SystemExit('Azure operation failed. Check sign-in, permissions and Key Vault RBAC propagation. No secret output shown.')


az('account', 'set', '--subscription', config['SUBSCRIPTION_ID'])
for name, prompt in [
    ('arks-host-token', 'Sites hosting service token (hidden): '),
    ('arks-importer-token', 'Portal importer token matching IMPORTER_TOKEN_SHA256 (hidden; Enter to reuse hosting token): '),
]:
    value = getpass.getpass(prompt)
    if name == 'arks-host-token':
        if not value: raise SystemExit('Hosting token is required.')
        hosting = value
    elif not value:
        value = hosting
    # Values are passed via stdin, never as shell arguments or source files.
    az('keyvault', 'secret', 'set', '--vault-name', config['VAULT'], '--name', name,
       '--file', '/dev/stdin', data=value)
del value, hosting
az('functionapp', 'config', 'appsettings', 'set', '-g', config['RG'], '-n', config['APP'],
   '--settings', *[f'{key}={value}' for key, value in google.items()])
with zipfile.ZipFile('function.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in Path('function').iterdir():
        if path.suffix in ('.py', '.json', '.txt'):
            entry = zipfile.ZipInfo(path.name)
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, path.read_bytes())
az('functionapp', 'deployment', 'source', 'config-zip', '-g', config['RG'], '-n', config['APP'],
   '--src', 'function.zip', '--build-remote', 'true')
print('Code deployed with both functions disabled. Follow README.md verification before enabling the timer.')
