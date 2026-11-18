"""Azure Cloud Shell Bash: provision the campus API dependencies without exposing secrets.
Run from a signed-in Default Directory; no subscription directory is transferred.
"""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

ROOT=Path(__file__).resolve().parent.parent
os.chdir(ROOT)
parser=argparse.ArgumentParser()
parser.add_argument('--subscription',default='a23b413f-dbe1-4a62-a9f9-62a6327fae00')
parser.add_argument('--app-name')
parser.add_argument('--resource-group')
parser.add_argument('--origin')
parser.add_argument('--location',default='centralindia')
parser.add_argument('--pg-host',default='pg-arksglobal-asia.postgres.database.azure.com')
parser.add_argument('--database',default='arks_global_institutes')
parser.add_argument('--vault-name',default='arks-kv-d649a759ed')
args=parser.parse_args()
step='initialization'

def announce(message):
    global step
    step=message
    print(message,flush=True)

def az(*cmd,data=None,optional=False):
    result=subprocess.run(['az',*cmd,'--only-show-errors','-o','json'],input=data,text=True,capture_output=True)
    if result.returncode:
        if optional:return None
        raise RuntimeError('Azure refused this operation. Verify sign-in, directory, resource permissions and regional availability. Raw output withheld.')
    return json.loads(result.stdout) if result.stdout.strip() else {}

def rest(method,url,body=None):
    return az('rest','--method',method,'--url',url,*(['--body','@/dev/stdin'] if body is not None else []),data=json.dumps(body) if body is not None else None)

def secret(name,value=None):
    if value is not None:
        az('keyvault','secret','set','--vault-name',args.vault_name,'--name',name,'--file','/dev/stdin',data=value)
        return value
    found=az('keyvault','secret','show','--vault-name',args.vault_name,'--name',name,optional=True)
    return found.get('value') if found else None

try:
    node_version=subprocess.run(['node','--version'],text=True,capture_output=True)
    if node_version.returncode or int(node_version.stdout.strip().lstrip('v').split('.')[0])<22:raise RuntimeError('Use Node.js 22 or later in Cloud Shell (nvm install 22; nvm use 22), then rerun.')
    announce('Selecting the existing Azure subscription in Default Directory.')
    az('account','set','--subscription',args.subscription)
    sites=az('staticwebapp','list')
    selected=[s for s in sites if (not args.app_name or s['name']==args.app_name) and (not args.resource_group or s['resourceGroup']==args.resource_group)]
    if not args.app_name:
        expected=[s for s in selected if s.get('defaultHostname')=='black-water-04f865700.5.azurestaticapps.net']
        if expected:selected=expected
    if len(selected)!=1:raise RuntimeError('Specify --app-name and --resource-group for the intended Static Web App.')
    site=selected[0];rg=site['resourceGroup'];origin=(args.origin or 'https://'+site['defaultHostname']).rstrip('/')
    from urllib.parse import urlparse
    parsed=urlparse(origin)
    if parsed.scheme!='https' or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:raise RuntimeError('Use an HTTPS portal origin without a path.')
    print('Portal: '+origin)
    print('In Entra > Arks Campus Portal > Authentication > Web, register this exact additional URI:')
    print(origin+'/api/auth/entra/callback')
    print('Keep the studentportal.arksglobalasia.cloud callback too; switch origins only after its DNS/TLS binding is ready.')
    entra_secret=getpass.getpass('Entra APPLICATION client secret VALUE (hidden; Enter to reuse Key Vault value): ').strip() or secret('arks-portal-entra-secret')
    if not entra_secret:raise RuntimeError('Create a client secret under Arks Campus Portal > Certificates & secrets, then rerun. Never send its value in chat.')
    email=input('Institute administrator email: ').strip().lower()
    password=getpass.getpass('Campus administrator password (14+ characters, hidden): ')
    if len(password)<14 or password!=getpass.getpass('Confirm administrator password (hidden): '):raise RuntimeError('Administrator passwords must match and contain at least 14 characters.')
    servers=az('postgres','flexible-server','list')
    matches=[s for s in servers if s.get('fullyQualifiedDomainName','').lower()==args.pg_host.lower()]
    if len(matches)!=1:raise RuntimeError('The existing PostgreSQL server was not found in the selected subscription. Verify --pg-host and subscription; no new database server will be created.')
    postgres=matches[0];pg_rg=postgres['resourceGroup'];pg_name=postgres['name'];database=args.database
    import re
    if not re.fullmatch(r'[a-z_][a-z0-9_]{0,62}',database):raise RuntimeError('Use a lowercase PostgreSQL database name with letters, digits or underscores.')
    if postgres.get('authConfig',{}).get('passwordAuthEnabled')=='Disabled':raise RuntimeError('The existing PostgreSQL server has password authentication disabled. Configure a dedicated Entra database principal/backend identity before using this setup path; no authentication policy was changed.')
    pg_user=input('Existing PostgreSQL administrator login ['+(postgres.get('administratorLogin') or '')+']: ').strip() or postgres.get('administratorLogin')
    pg_password=getpass.getpass('Existing PostgreSQL administrator password (hidden; not stored): ')
    if not pg_user or not pg_password:raise RuntimeError('PostgreSQL administrator credentials are needed to create the schema and limited application role.')
    suffix=hashlib.sha256((args.subscription+'/'+rg).encode()).hexdigest()[:10]
    storage='arkscampus'+suffix;portal_user='arks_campus_api'
    portal_password=secret('arks-portal-pg-password') or 'Arks!'+secrets.token_urlsafe(32)
    announce('Saving application credentials in the existing Key Vault; no values will be displayed.')
    for name,value in [('arks-portal-entra-secret',entra_secret),('arks-portal-pg-password',portal_password)]:secret(name,value)
    announce('Creating/reusing '+database+' on your existing PostgreSQL server. No new database server is created.')
    existing_db=az('postgres','flexible-server','db','show','--database-name',database,'--server-name',pg_name,'--resource-group',pg_rg,optional=True)
    if not existing_db:az('postgres','flexible-server','db','create','--database-name',database,'--server-name',pg_name,'--resource-group',pg_rg)
    # Public managed Functions need a reachable TLS database endpoint; PostgreSQL
    # login and the dedicated schema permissions remain mandatory.
    if postgres.get('network',{}).get('publicNetworkAccess')=='Disabled':raise RuntimeError('This PostgreSQL server is private-network only. A Free managed API cannot reach it without a different backend/network topology. No public-access change was made.')
    az('postgres','flexible-server','firewall-rule','create','--resource-group',pg_rg,'--server-name',pg_name,'--name','ArksPortalAzureServices','--start-ip-address','0.0.0.0','--end-ip-address','0.0.0.0')
    announce('Creating private Standard LRS file storage.')
    az('storage','account','create','--name',storage,'--resource-group',rg,'--location',args.location,'--sku','Standard_LRS','--kind','StorageV2','--min-tls-version','TLS1_2','--allow-blob-public-access','false')
    az('storage','container','create','--account-name',storage,'--name','campus-private','--auth-mode','key')
    connection=az('storage','account','show-connection-string','--name',storage,'--resource-group',rg)['connectionString']
    announce('Installing server dependencies and initializing the central PostgreSQL schema.')
    result=subprocess.run(['npm','ci','--omit=dev','--ignore-scripts'],capture_output=True,text=True)
    if result.returncode:raise RuntimeError('npm ci failed. Use Node.js 22 and rerun from the cloned repository root.')
    payload={'host':args.pg_host,'database':database,'adminUser':pg_user,'adminPassword':pg_password,'portalUser':portal_user,'portalPassword':portal_password,'ownerEmail':email,'ownerPassword':password}
    result=subprocess.run(['node','azure/portal/provision.mjs'],input=json.dumps(payload),capture_output=True,text=True)
    if result.returncode:raise RuntimeError('PostgreSQL initialization failed. Confirm TLS, public network/firewall access and administrator privileges. Driver output withheld.')
    print('Central PostgreSQL schema and administrator initialized; no credentials displayed.')
    pg_password=None
    payload=None
    importer=secret('arks-importer-token') or secret('arks-portal-importer-token') or secrets.token_urlsafe(32)
    secret('arks-portal-importer-token',importer)
    settings={'AUTH_MODE':'entra','APP_ORIGIN':origin,'ENTRA_TENANT_ID':'0c218ee7-11fe-4714-962d-ba5efb884bc2','ENTRA_CLIENT_ID':'38f7e4ae-291c-4aa3-b8b0-72a28242e01f','ENTRA_TENANT_SUBDOMAIN':'arksglobalasiainstitutes','ENTRA_CLIENT_SECRET':entra_secret,'PORTAL_PG_HOST':args.pg_host,'PORTAL_PG_DATABASE':database,'PORTAL_PG_SCHEMA':'arks','PORTAL_PG_USER':portal_user,'PORTAL_PG_PASSWORD':portal_password,'PORTAL_BLOB_CONNECTION_STRING':connection,'PORTAL_BLOB_CONTAINER':'campus-private','IMPORTER_TOKEN_SHA256':hashlib.sha256(importer.encode()).hexdigest()}
    announce('Saving encrypted server-only Static Web App settings.')
    settings_url='https://management.azure.com'+site['id']+'/config/appsettings?api-version=2023-12-01'
    old=rest('POST',settings_url.replace('/config/appsettings?','/listAppSettings?'))
    merged=old.get('properties',{})
    merged.update(settings)
    rest('PUT',settings_url,{'properties':merged})
    config={'SUBSCRIPTION_ID':args.subscription,'RG':rg,'APP':site['name'],'PORTAL_ORIGIN':origin,'PG_HOST':args.pg_host,'PG_DATABASE':database,'PG_SCHEMA':'arks','PG_SERVER_RG':pg_rg,'STORAGE':storage,'VAULT':args.vault_name}
    Path('azure/portal-azure-config.json').write_text(json.dumps(config,indent=2)+'\n')
    print('Portal configuration saved. Resource IDs only are in azure/portal-azure-config.json.')
    print('Verify '+origin+'/api/health returns JSON with ok=true after the GitHub deployment finishes.')
    print('Open the portal, use administrator email/password, then onboard your actual batches and students.')
    print('Existing Sites data is not automatically copied. Keep the old portal until its data is exported and migrated.')
    print('Existing Drive automation was not repointed. After batch/source migration use connect-portal-worker.py.')
except Exception as error:
    print('Stopped during: '+step,file=sys.stderr)
    print(str(error) if isinstance(error,RuntimeError) else 'Setup failed; sensitive diagnostic output suppressed.',file=sys.stderr)
    sys.exit(1)
