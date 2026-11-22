"""Deterministic Drive reader. No model calls, publication, or student mutations."""
import hashlib
import io
import json
import os
import re
import time
from collections import deque
import requests

ORIGIN = os.environ.get("PORTAL_ORIGIN", "https://student-portal.arksglobalasia.cloud").rstrip("/")
DRIVE = "https://www.googleapis.com/drive/v3/files"
FOLDER = "application/vnd.google-apps.folder"
SHORTCUT = "application/vnd.google-apps.shortcut"
FIELDS = "id,name,mimeType,modifiedTime,version,size,parents,md5Checksum,trashed"
MAX_BYTES = 20 * 1024 * 1024
EXTENSIONS = re.compile(
    r"\.(pdf|pptx|ppt|docx|doc|txt|md|png|jpg|jpeg|webp|svg|zip|xlsx|csv|yaml|yml|sh|py|json)$",
    re.I,
)
DEFAULT_SKIP_FOLDERS = {"student_submissions", "lab_answers", "do_not_share", "trainer_only"}
GOOGLE_EXPORTS = {
    "application/vnd.google-apps.document": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".docx",
    ),
    "application/vnd.google-apps.presentation": (
        "application/pdf",
        ".pdf",
    ),
    "application/vnd.google-apps.spreadsheet": (
        "text/csv",
        ".csv",
    ),
}


class ScanError(Exception):
    """Only bounded, non-secret messages may cross the worker boundary."""


class ApiError(ScanError):
    def __init__(self, status):
        self.status = status
        super().__init__(f"Upstream HTTP {status}; inspect access/quota and retry.")


def request(session, method, url, *, retry=False, **kwargs):
    for attempt in range(4 if retry else 1):
        try:
            response = session.request(method, url, timeout=(10, 90), allow_redirects=False, **kwargs)
        except requests.RequestException:
            if retry and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            raise ScanError("Upstream network failure; safe to retry.") from None
        if response.status_code in (429, 500, 502, 503, 504) and retry and attempt < 3:
            response.close()
            time.sleep(2 ** attempt)
            continue
        if not 200 <= response.status_code < 300:
            status = response.status_code
            response.close()
            raise ApiError(status)
        return response


class Portal:
    def __init__(self):
        self.session = requests.Session()
        headers = {
            "X-Arks-Importer-Token": os.environ["ARKS_IMPORTER_TOKEN"],
        }
        host_token = os.environ.get("ARKS_HOST_TOKEN", "").strip()
        if host_token:
            headers["OAI-Sites-Authorization"] = "Bearer " + host_token
        self.session.headers.update(headers)

    def call(self, action, body=None):
        allowed = {
            "sources",
            "claim",
            "resolve",
            "ingest",
            "finish",
            "jobs",
            "jobs/claim",
            "jobs/finish",
            "groups",
            "groups/snapshot",
            "schedule-assessments",
        }
        if action not in allowed:
            raise ScanError("Operation is not permitted for this worker.")
        # Claim must not be retried blindly: a lost response can mean a live lease.
        with request(
            self.session,
            "GET" if body is None else "POST",
            ORIGIN + "/api/automation/" + action,
            json=body,
            retry=action in {"sources", "resolve", "ingest"},
        ) as r:
            return r.json()

    def upload(self, run_id, item_id, file, data):
        with request(
            self.session,
            "POST",
            ORIGIN + "/api/automation/upload",
            data={"run_id": run_id, "item_id": item_id},
            files={"file": (file["name"], data, file["mimeType"])},
        ) as r:
            return r.json()


def revision(file):
    # Match the existing importer when it used modifiedTime; version is fallback.
    return file.get("modifiedTime") or str(file["version"])


def parse_source_filters(source):
    raw_cfg = source.get("config") or "{}"
    if isinstance(raw_cfg, str):
        try:
            cfg = json.loads(raw_cfg)
        except ValueError:
            cfg = {}
    elif isinstance(raw_cfg, dict):
        cfg = raw_cfg
    else:
        cfg = {}

    raw_folders = cfg.get("excluded_folders")
    if isinstance(raw_folders, list):
        skip_folders = {str(x).strip().lower().replace(" ", "_") for x in raw_folders if str(x).strip()}
    else:
        skip_folders = set(DEFAULT_SKIP_FOLDERS)

    raw_exts = cfg.get("excluded_extensions")
    if isinstance(raw_exts, list):
        skip_exts = {
            ("." + str(x).strip().lower().lstrip("."))
            for x in raw_exts
            if str(x).strip()
        }
    else:
        skip_exts = set()

    return skip_folders, skip_exts


class Drive:
    def __init__(self, session):
        self.session = session

    def get(self, file_id):
        if not re.fullmatch(r"[\w-]{10,200}", file_id):
            raise ScanError("Invalid Drive file ID.")
        with request(
            self.session,
            "GET",
            DRIVE + "/" + file_id,
            retry=True,
            params={"fields": FIELDS, "supportsAllDrives": "true"},
        ) as r:
            return r.json()

    def page(self, query, token=None):
        params = {
            "q": query,
            "fields": "nextPageToken,incompleteSearch,files(" + FIELDS + ")",
            "pageSize": 50,
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
        if token:
            params["pageToken"] = token
        with request(self.session, "GET", DRIVE, params=params, retry=True) as r:
            page = r.json()
        if page.get("incompleteSearch"):
            raise ScanError("Drive returned an incomplete search; use a folder URL or narrow access.")
        return page

    def resolve(self, source):
        if source.get("folder_id"):
            folder = self.get(source["folder_id"])
        else:
            name = source["folder_input"].replace("\\", "\\\\").replace("'", "\\'")
            found, token = [], None
            while True:
                page = self.page(f"trashed = false and mimeType = '{FOLDER}' and name = '{name}'", token)
                found.extend(page["files"])
                token = page.get("nextPageToken")
                if len(found) > 1 or not token:
                    break
            if len(found) != 1:
                raise ScanError("Folder name must match exactly one accessible folder. Save its Drive URL.")
            folder = found[0]
        if folder["mimeType"] != FOLDER or folder.get("trashed"):
            raise ScanError("Configured Drive source is not an active folder.")
        return folder

    def copy(self, file):
        data = io.BytesIO()
        with request(
            self.session,
            "GET",
            DRIVE + "/" + file["id"],
            retry=True,
            params={"alt": "media", "supportsAllDrives": "true"},
            stream=True,
        ) as r:
            for chunk in r.iter_content(65536):
                data.write(chunk)
                if data.tell() > MAX_BYTES:
                    raise ScanError("File exceeded the attachment limit during download.")
        latest = self.get(file["id"])
        if latest.get("trashed") or revision(latest) != revision(file) or latest.get("parents") != file.get("parents"):
            raise ScanError("File changed during download; its page will be retried.")
        payload = data.getvalue()
        if len(payload) != int(file.get("size", 0)):
            raise ScanError("Downloaded file size did not match Drive metadata.")
        if file.get("md5Checksum") and hashlib.md5(payload).hexdigest() != file["md5Checksum"]:
            raise ScanError("Downloaded file checksum did not match Drive metadata.")
        return payload

    def export_google_file(self, file):
        mime = file.get("mimeType", "")
        if mime not in GOOGLE_EXPORTS:
            raise ScanError("Unsupported Google Workspace file type for export.")
        export_mime, ext = GOOGLE_EXPORTS[mime]
        data = io.BytesIO()
        with request(
            self.session,
            "GET",
            DRIVE + "/" + file["id"] + "/export",
            retry=True,
            params={"mimeType": export_mime},
            stream=True,
        ) as r:
            for chunk in r.iter_content(65536):
                data.write(chunk)
                if data.tell() > MAX_BYTES:
                    raise ScanError("Exported Google file exceeded the attachment limit.")
        latest = self.get(file["id"])
        if latest.get("trashed") or revision(latest) != revision(file) or latest.get("parents") != file.get("parents"):
            raise ScanError("File changed during export; its page will be retried.")
        name = file["name"]
        if not name.lower().endswith(ext):
            name = name + ext
        return {**file, "name": name, "mimeType": export_mime}, data.getvalue()

    def verify_ancestry(self, ancestors):
        for child, parent in zip(ancestors, ancestors[1:]):
            folder = self.get(child)
            if folder.get("trashed") or parent not in folder.get("parents", []):
                raise ScanError("Folder moved outside its recorded ancestry; restart enumeration.")


def scan_source(portal, drive, checkpoints, source_id, *, max_pages=200, seconds=2400):
    try:
        claim = portal.call("claim", {"source_id": source_id})
    except ApiError as e:
        if e.status in (400, 409):  # Removed/disabled source or another worker owns it.
            return "skipped"
        raise
    run_id, source = claim["run_id"], claim["source"]
    skip_folders, skip_exts = parse_source_filters(source)
    count, linked, copied = 0, 0, 0
    deadline = time.monotonic() + seconds
    status = "failed"
    message = "Scan did not complete."
    try:
        root = drive.resolve(source)
        portal.call("resolve", {"run_id": run_id, "folder_id": root["id"], "folder_name": root["name"]})
        key = str(source["generation"]) + ":" + root["id"]
        saved = checkpoints.load(source_id)
        pending = deque(
            saved["pending"]
            if saved and saved.get("key") == key
            else [{"id": root["id"], "path": "batch", "ancestors": [root["id"]], "token": None}]
        )
        for _ in range(max_pages):
            if not pending or time.monotonic() >= deadline:
                break
            current = pending[0]
            try:
                drive.verify_ancestry(current["ancestors"])
            except ScanError:
                checkpoints.save(source_id, None)
                raise
            try:
                page = drive.page(f"'{current['id']}' in parents and trashed = false", current["token"])
            except ApiError as e:
                if e.status == 400 and current["token"]:
                    checkpoints.save(source_id, None)
                    raise ScanError("Drive page token expired; next scan restarts safely.") from None
                raise
            folders, files = [], []
            for file in page["files"]:
                if current["id"] not in file.get("parents", []):
                    raise ScanError("Drive returned a file outside the enumerated parent.")
                if file["mimeType"] == FOLDER:
                    norm_folder = file["name"].strip().lower().replace(" ", "_")
                    if norm_folder not in skip_folders:
                        folders.append(
                            {
                                "id": file["id"],
                                "path": current["path"] + "/" + file["name"],
                                "ancestors": [file["id"]] + current["ancestors"],
                                "token": None,
                            }
                        )
                elif file["mimeType"] != SHORTCUT:  # Never follow a shortcut outside the batch.
                    lower_name = file["name"].lower()
                    if any(lower_name.endswith(ext) for ext in skip_exts):
                        continue
                    files.append(file)
            if files:
                items = [
                    {
                        "drive_file_id": f["id"],
                        "revision": revision(f),
                        "modified_time": f.get("modifiedTime", ""),
                        "name": f["name"],
                        "source_path": current["path"],
                        "mime": f["mimeType"],
                        "size": int(f.get("size", 0)),
                        "url": "https://drive.google.com/file/d/" + f["id"] + "/view",
                        "ancestor_ids": current["ancestors"],
                    }
                    for f in files
                ]
                result = portal.call("ingest", {"run_id": run_id, "items": items})["items"]
                if len(result) != len(files):
                    raise ScanError("Incomplete import response; retry this page.")
                for file, item in zip(files, result):
                    if item["status"] != "pending" or item.get("file_id"):
                        continue
                    if file["mimeType"] in (
                        "application/vnd.google-apps.document",
                        "application/vnd.google-apps.presentation",
                    ):
                        exported_file, payload = drive.export_google_file(file)
                        if payload:
                            portal.upload(run_id, item["id"], exported_file, payload)
                            copied += 1
                        else:
                            linked += 1
                    elif (
                        EXTENSIONS.search(file["name"])
                        and 0 < int(file.get("size", 0)) <= MAX_BYTES
                        and not file["mimeType"].startswith(("application/vnd.google-apps.", "video/", "audio/"))
                    ):
                        portal.upload(run_id, item["id"], file, drive.copy(file))
                        copied += 1
                    else:
                        linked += 1
                count += len(files)
            # Advance only after every intended copy succeeds. Replay is idempotent.
            pending.popleft()
            if page.get("nextPageToken"):
                pending.appendleft({**current, "token": page["nextPageToken"]})
            pending.extend(folders)
            checkpoints.save(source_id, {"key": key, "pending": list(pending)})
        status = "partial" if pending else "succeeded"
        message = f"Azure Drive scan: {count} files examined; {copied} copied; {linked} link-only. "
        message += "Saved cursor; next scan resumes." if pending else "Enumeration complete; admin approval required."
        if not pending:
            checkpoints.save(source_id, None)
    except ScanError as e:
        message = str(e)
    except Exception:
        message = "Worker or credential failure; check cloud configuration. No credentials logged."
    portal.call("finish", {"run_id": run_id, "status": status, "discovered": count, "message": message})
    if status == "failed":
        raise ScanError(message)
    return status
