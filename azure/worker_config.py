"""Recover nonsecret worker resource IDs from the signed-in subscription."""
import json
from pathlib import Path
import re
import subprocess
HERE=Path(__file__).resolve().parent

def load_worker_config():
    target=HERE/'azure-config.json'
    if target.is_file(): return json.loads(target.read_text())
    portal_file=HERE/'portal-azure-config.json'
    if not portal_file.is_file(): raise RuntimeError('Run setup-portal.py first, or restore azure-config.json beside this script.')
    portal=json.loads(portal_file.read_text())
    def az(*args):
        r=subprocess.run(['az',*args,'--only-show-errors','-o','json'],text=True,capture_output=True)
        if r.returncode:raise RuntimeError('Worker discovery failed. Check subscription and Function App read access. Raw output withheld.')
        return json.loads(r.stdout) if r.stdout.strip() else {}
    az('account','set','--subscription',portal['SUBSCRIPTION_ID'])
    apps=az('functionapp','list')
    matches=[a for a in apps if a['name']=='arks-drive-d649a759ed']
    if len(matches)!=1:raise RuntimeError('Expected Drive worker not found. Restore its nonsecret azure-config.json; no new Function App was created.')
    app=matches[0]
    values=az('functionapp','config','appsettings','list','-g',app['resourceGroup'],'-n',app['name'])
    storage=next((v['value'] for v in values if v['name']=='AzureWebJobsStorage'),'')
    name=re.search(r'(?:^|;)AccountName=([a-z0-9]+)(?:;|$)',storage)
    if not name:raise RuntimeError('Could not discover worker storage. Restore its nonsecret azure-config.json.')
    cfg={'SUBSCRIPTION_ID':portal['SUBSCRIPTION_ID'],'RG':app['resourceGroup'],'APP':app['name'],'VAULT':portal['VAULT'],'STORAGE':name.group(1)}
    target.write_text(json.dumps(cfg,indent=2)+'\n')
    return cfg
