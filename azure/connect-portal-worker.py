"""Explicit automation cutover after migrating batches/source mappings.
No source data or credentials are printed. Does not enable a timer.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request
from urllib.parse import urlparse

HERE=Path(__file__).resolve().parent

def az(*args,data=None):
    r=subprocess.run(['az',*args,'--only-show-errors','-o','json'],input=data,text=True,capture_output=True)
    if r.returncode:raise RuntimeError('Azure operation failed. Confirm CLI sign-in, resource names and the upgraded engine function. Sensitive output suppressed.')
    return json.loads(r.stdout) if r.stdout.strip() else {}

def secret(vault,name):return az('keyvault','secret','show','--vault-name',vault,'--name',name)['value']
def rest(method,url,body):return az('rest','--method',method,'--url',url,'--body','@/dev/stdin',data=json.dumps(body))
try:
    portal=json.loads((HERE/'portal-azure-config.json').read_text())
    from worker_config import load_worker_config
    worker=load_worker_config()
    origin=portal['PORTAL_ORIGIN'].rstrip('/');u=urlparse(origin)
    if u.scheme!='https' or u.path or u.username or not u.hostname.endswith(('.azurestaticapps.net','.arksglobalasia.cloud')):raise RuntimeError('Unexpected portal origin.')
    az('account','set','--subscription',portal['SUBSCRIPTION_ID'])
    token=secret(portal['VAULT'],'arks-portal-importer-token')
    # This intentionally refuses to redirect a live worker to an empty new campus.
    request=urllib.request.Request(origin+'/api/automation/sources',headers={'X-Arks-Importer-Token':token})
    with urllib.request.urlopen(request,timeout=25) as r: sources=json.load(r)['sources']
    if not any(s['enabled'] for s in sources):raise RuntimeError('No enabled batch source exists in the Azure portal. Migrate/configure your batches and Drive sources before switching automation.')
    app_info=az('functionapp','show','--resource-group',worker['RG'],'--name',worker['APP'])
    hostname=app_info.get('defaultHostName') or worker['APP']+'.azurewebsites.net'
    if not hostname.endswith('.azurewebsites.net'):raise RuntimeError('Unexpected Function App hostname.')
    function=az('functionapp','function','keys','list','--resource-group',worker['RG'],'--name',worker['APP'],'--function-name','engine_dispatch')
    function=function.get('properties',function)
    if not (function.get('default') or function.get('campus-portal')):
        function=az('functionapp','function','keys','set','--resource-group',worker['RG'],'--name',worker['APP'],'--function-name','engine_dispatch','--key-name','campus-portal')
    function_key=function.get('default') or function.get('campus-portal') or function.get('value')
    if not function_key:raise RuntimeError('No engine-specific function key is available. Deploy the worker upgrade first.')
    base='https://management.azure.com/subscriptions/'+worker['SUBSCRIPTION_ID']+'/resourceGroups/'+worker['RG']+'/providers/Microsoft.Web/sites/'+worker['APP']+'/config/appsettings'
    current=rest('POST',base+'/list?api-version=2023-12-01',{})
    settings=current.get('properties',{})
    settings.update({'ARKS_PORTAL_ORIGIN':origin,'ARKS_IMPORTER_TOKEN':'@Microsoft.KeyVault(SecretUri=https://'+portal['VAULT']+'.vault.azure.net/secrets/arks-portal-importer-token/)','AzureWebJobs.dispatch_batches.Disabled':'true','AzureWebJobs.scan_batch.Disabled':'false','AzureWebJobs.engine_dispatch.Disabled':'false','AzureWebJobs.process_engine_job.Disabled':'false'})
    rest('PUT',base+'?api-version=2023-12-01',{'properties':settings})
    pbase='https://management.azure.com/subscriptions/'+portal['SUBSCRIPTION_ID']+'/resourceGroups/'+portal['RG']+'/providers/Microsoft.Web/staticSites/'+portal['APP']
    current=rest('POST',pbase+'/listAppSettings?api-version=2023-12-01',{})
    settings=current.get('properties',{})
    settings.update({'AZURE_ENGINE_URL':'https://'+hostname+'/api/engine/dispatch','AZURE_ENGINE_KEY':function_key,'IMPORTER_TOKEN_SHA256':hashlib.sha256(token.encode()).hexdigest()})
    rest('PUT',pbase+'/config/appsettings?api-version=2023-12-01',{'properties':settings})
    worker['PORTAL_ORIGIN']=origin
    worker['IMPORTER_SECRET_NAME']='arks-portal-importer-token'
    (HERE/'azure-config.json').write_text(json.dumps(worker,indent=2)+'\n')
    print('Worker and portal connected to the Azure campus. Timer remains disabled.')
    print('Run python3 operate.py smoke, then python3 operate.py enable only after verification succeeds.')
except Exception as e:
    print(str(e) if isinstance(e,RuntimeError) else 'Cutover failed; verify configuration files, source migration and cloud access. Sensitive output suppressed.',file=sys.stderr)
    sys.exit(1)
