import json
import logging
import os
from typing import List
import azure.functions as func
from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import BlobServiceClient
from auth import drive_session
from scanner import ApiError, Drive, Portal, ScanError, scan_source

app = func.FunctionApp()


class Checkpoints:
    def __init__(self):
        self.container = BlobServiceClient.from_connection_string(os.environ["AzureWebJobsStorage"]).get_container_client("arks-scan-cursors")

    def load(self, source_id):
        try:
            return json.loads(self.container.download_blob(source_id + ".json").readall())
        except ResourceNotFoundError:
            return None

    def save(self, source_id, value):
        self.container.upload_blob(source_id + ".json", json.dumps(value), overwrite=True)


@app.function_name(name="dispatch_batches")
@app.timer_trigger(schedule="%SCAN_SCHEDULE%", arg_name="timer", run_on_startup=False, use_monitor=True)
@app.queue_output(arg_name="jobs", queue_name="arks-drive-scans", connection="AzureWebJobsStorage")
def dispatch_batches(timer: func.TimerRequest, jobs: func.Out[List[str]]):
    try:
        sources = Portal().call("sources")["sources"]
        sources.sort(key=lambda s: (not bool(s.get("sync_requested")), s.get("last_sync") or ""))
        jobs.set([json.dumps({"source_id": s["id"]}) for s in sources if s["enabled"]])
        queue_engine_jobs()
        logging.info("Batch scan queue refreshed.")
    except Exception:
        raise RuntimeError("Batch dispatch failed; check portal credential and connectivity.") from None


@app.function_name(name="schedule_morning_assessments")
@app.timer_trigger(schedule="0 30 3 * * *", arg_name="timer", run_on_startup=False, use_monitor=True)
def schedule_morning_assessments(timer: func.TimerRequest):
    """Fires daily at 03:30 UTC (09:00 AM IST).
    Monday-Saturday: schedules Daily Test (20+ Qs) if class materials were taught the previous day.
    Sunday: schedules Weekly Test (25+ Qs) aggregating Mon-Sat materials (no Daily Test on Sunday).
    """
    try:
        Portal().call("schedule-assessments", {})
        queue_engine_jobs()
        logging.info("9:00 AM IST morning assessment schedule check completed.")
    except Exception:
        raise RuntimeError("Morning assessment schedule failed; check portal connectivity.") from None


@app.function_name(name="scan_batch")
@app.queue_trigger(arg_name="job", queue_name="arks-drive-scans", connection="AzureWebJobsStorage")
def scan_batch(job: func.QueueMessage):
    try:
        source_id = json.loads(job.get_body())["source_id"]
        import uuid
        uuid.UUID(source_id)
        outcome = scan_source(Portal(), Drive(drive_session()), Checkpoints(), source_id)
        logging.info("Batch scan %s: %s", source_id, outcome)
    except Exception:
        # SDK exception strings may contain request headers. Never log their chain.
        raise RuntimeError("Batch scan failed; check portal Run history and cloud access. Queue retries apply.") from None


def queue_engine_jobs():
    from azure.storage.queue import QueueClient, TextBase64EncodePolicy
    portal = Portal()
    queue = QueueClient.from_connection_string(os.environ['AzureWebJobsStorage'], 'arks-engine-jobs', message_encode_policy=TextBase64EncodePolicy())
    for job in portal.call('jobs')['jobs']:
        queue.send_message(json.dumps({'id': job['id']}))
    if os.environ.get('GOOGLE_WORKSPACE_ADMIN'):
        queue.send_message(json.dumps({'kind': 'sync_groups'}))


@app.function_name(name='engine_dispatch')
@app.route(route='engine/dispatch', methods=['POST'], auth_level=func.AuthLevel.FUNCTION)
def engine_dispatch(req: func.HttpRequest):
    from azure.storage.queue import QueueClient, TextBase64EncodePolicy
    try:
        payload = req.get_json()
        if payload.get('source_id'):
            source = next((s for s in Portal().call('sources')['sources'] if s['id'] == payload['source_id'] and s['enabled']), None)
            if not source: return func.HttpResponse('Source unavailable.', status_code=404)
            queue = QueueClient.from_connection_string(os.environ['AzureWebJobsStorage'], 'arks-drive-scans', message_encode_policy=TextBase64EncodePolicy())
            queue.send_message(json.dumps({'source_id': source['id']}))
        queue_engine_jobs()
        return func.HttpResponse('Accepted.', status_code=202)
    except ApiError as e:
        if e.status == 401:
            msg = 'Portal authentication failed (401): verify ARKS_IMPORTER_TOKEN matches IMPORTER_TOKEN_SHA256.'
        elif e.status == 404:
            msg = 'Portal endpoint not found (404): verify PORTAL_ORIGIN.'
        else:
            msg = f'Portal returned HTTP {e.status} during dispatch; verify portal configuration.'
        logging.warning('engine_dispatch ApiError: %s', msg)
        return func.HttpResponse(msg, status_code=503)
    except ScanError as e:
        msg = str(e)
        logging.warning('engine_dispatch ScanError: %s', msg)
        return func.HttpResponse(msg, status_code=503)
    except Exception:
        logging.warning('engine_dispatch failed with unexpected error.')
        return func.HttpResponse('Dispatch failed; check engine configuration.', status_code=503)


@app.function_name(name='process_engine_job')
@app.queue_trigger(arg_name='job', queue_name='arks-engine-jobs', connection='AzureWebJobsStorage')
def process_engine_job(job: func.QueueMessage):
    from engine import execute_job, sync_groups
    from scanner import ApiError
    try:
        payload = json.loads(job.get_body())
        if payload.get('kind') == 'sync_groups': sync_groups()
        else: execute_job(payload['id'])
    except ApiError as e:
        if e.status == 409: return  # Another queue delivery owns/completed this lease.
        raise RuntimeError('Engine job API failed; inspect configuration.') from None
    except Exception:
        raise RuntimeError('Engine worker failed; inspect job status and configuration.') from None
