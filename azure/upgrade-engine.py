"""Run from Azure Cloud Shell Bash. Never prints secret-bearing CLI output."""
import getpass
import json
import os
from pathlib import Path
import subprocess
import zipfile
os.chdir(Path(__file__).resolve().parent)

def az(*args, data=None, output=False):
    result=subprocess.run(['az',*args,'--only-show-errors','-o','json' if output else 'none'],input=data,text=True,capture_output=True)
    if result.returncode:
        raise SystemExit('Azure command failed: '+args[0]+' '+args[1]+'. Raw output suppressed. Check sign-in, permissions and resource names.')
    return json.loads(result.stdout) if output and result.stdout else None

from worker_config import load_worker_config
try: cfg=load_worker_config()
except RuntimeError as e: raise SystemExit(str(e))
az('account','set','--subscription',cfg['SUBSCRIPTION_ID'])
print('Creating the engine queue; pausing the timer during worker upgrade and portal cutover.')
az('storage','queue','create','--account-name',cfg['STORAGE'],'--name','arks-engine-jobs','--auth-mode','key')
key=getpass.getpass('DeepSeek API key (hidden; Enter to keep existing configuration): ').strip()
settings=['AzureWebJobs.dispatch_batches.Disabled=true','AzureWebJobs.engine_dispatch.Disabled=false','AzureWebJobs.process_engine_job.Disabled=false']
if key:
    az('keyvault','secret','set','--vault-name',cfg['VAULT'],'--name','arks-deepseek-key','--file','/dev/stdin',data=key)
    settings.append('DEEPSEEK_API_KEY=@Microsoft.KeyVault(SecretUri=https://'+cfg['VAULT']+'.vault.azure.net/secrets/arks-deepseek-key/)')
del key
az('functionapp','config','appsettings','set','-g',cfg['RG'],'-n',cfg['APP'],'--settings',*settings)
with zipfile.ZipFile('function.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for path in Path('function').iterdir():
        if path.suffix in ('.py','.json','.txt'):
            info=zipfile.ZipInfo(path.name);info.create_system=3;info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(info,path.read_bytes())
print('Deploying the upgraded worker. This may take several minutes.')
az('functionapp','deployment','source','config-zip','-g',cfg['RG'],'-n',cfg['APP'],'--src','function.zip','--build-remote','true')
print('Worker package deployed. Confirm engine_dispatch and process_engine_job appear in Function App > Functions.')
print('Portal endpoint: https://'+cfg['APP']+'.azurewebsites.net/api/engine/dispatch')
print('Configure AZURE_ENGINE_URL and AZURE_ENGINE_KEY in the portal server environment; never in browser code.')
print('Run python3 operate.py smoke to verify Drive scanning. It leaves the timer disabled; enable only when ready.')
