"""Azure managed identity -> Google STS -> read-only Drive service account."""
import os
try:
    from azure.identity import ManagedIdentityCredential
except ImportError:
    ManagedIdentityCredential = None
from google.auth import identity_pool
from google.auth.transport.requests import AuthorizedSession


class AzureSubjectToken(identity_pool.SubjectTokenSupplier):
    def __init__(self):
        self.identity = ManagedIdentityCredential(client_id=os.environ["AZURE_CLIENT_ID"])

    def get_subject_token(self, context, request):
        return self.identity.get_token(os.environ["AZURE_FEDERATION_AUDIENCE"] + "/.default").token


def drive_session(write=False, scopes=None):
    credentials = identity_pool.Credentials(
        audience=os.environ["GOOGLE_WIF_AUDIENCE"],
        subject_token_type="urn:ietf:params:oauth:token-type:jwt",
        token_url="https://sts.googleapis.com/v1/token",
        subject_token_supplier=AzureSubjectToken(),
        service_account_impersonation_url=(
            "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/"
            + os.environ["GOOGLE_SERVICE_ACCOUNT"] + ":generateAccessToken"
        ),
        scopes=scopes or ["https://www.googleapis.com/auth/drive" if write else "https://www.googleapis.com/auth/drive.readonly"],
    )
    return AuthorizedSession(credentials)


def directory_session(write=False):
    """Keyless Workspace domain-wide delegation through IAM signJwt."""
    import json, time, requests
    from scanner import request, ScanError
    subject = os.environ.get('GOOGLE_WORKSPACE_ADMIN')
    account = os.environ.get('GOOGLE_DIRECTORY_SERVICE_ACCOUNT')
    if not subject or not account:
        raise ScanError('Workspace group synchronization is not configured.')
    session = drive_session(scopes=['https://www.googleapis.com/auth/cloud-platform'])
    timestamp = int(time.time())
    scope = 'https://www.googleapis.com/auth/admin.directory.group.member' + ('' if write else '.readonly')
    payload = {'iss': account, 'sub': subject, 'aud': 'https://oauth2.googleapis.com/token', 'iat': timestamp, 'exp': timestamp + 3600, 'scope': scope}
    with request(session, 'POST', 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + account + ':signJwt', json={'payload': json.dumps(payload)}) as r:
        assertion = r.json()['signedJwt']
    with request(requests.Session(), 'POST', 'https://oauth2.googleapis.com/token', data={'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': assertion}) as r:
        token = r.json()['access_token']
    authorized = requests.Session()
    authorized.headers['Authorization'] = 'Bearer ' + token
    return authorized
