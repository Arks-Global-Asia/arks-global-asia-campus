import { readApiResponse } from "../shared/http.js";
import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
async function request(path, body) {
  const r = await fetch(
    "/api/admin/automation/" + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  return readApiResponse(r);
}
const when = (s) =>
  s
    ? new Date(s).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }) + " IST"
    : "Not yet";
const label = {
  notes: "Notes",
  slides: "Presentation",
  lab: "Practice lab",
  guide: "Resource guide",
  recording: "Recording",
  sop: "Bootcamp guide",
  test_link: "External assessment",
  private: "Instructor only",
};
const statusTone = (s) =>
  ["ready", "published", "succeeded"].includes(s)
    ? "green"
    : ["restricted", "failed", "partial"].includes(s)
      ? "amber"
      : "blue";
export default function AutomationPanel({ batches }) {
  const [state, setState] = useState(null),
    [tab, setTab] = useState("inbox"),
    [filter, setFilter] = useState("pending"),
    [batch, setBatch] = useState("all"),
    [source, setSource] = useState(null),
    [review, setReview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    try {
      setState(await request("state"));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function action(fn, success) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await fn();
      await load();
      setMessage(result?.message || success);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!state)
    return (
      <div className="loading">
        {error ? (
          <>
            <p>{error}</p>
            <button onClick={load}>Retry</button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" /> Opening your automation workspace…
          </>
        )}
      </div>
    );
  const items = state.items.filter(
    (i) =>
      (batch === "all" || i.batch_id === batch) &&
      (filter === "all" || i.status === filter),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR TEACHING, WITH LESS BUSYWORK</div>
          <h1>Let the materials come to you.</h1>
          <p>
            Connect each batch’s Drive folder. Review what arrives. Release when
            it’s ready.
          </p>
        </div>
        <button
          className="button"
          onClick={() => {
            setSource({
              batch_id: batches[0]?.id || "",
              folder_input: "",
              enabled: true,
            });
            setTab("sources");
          }}
        >
          <Plus size={16} /> Connect a batch folder
        </button>
      </div>
      <div className="automation-banner">
        <div className="automation-banner-icon">
          <ShieldCheck size={28} />
        </div>
        <div>
          <h3>You have the final say.</h3>
          <p>
            Automatic imports always arrive as drafts. Students see a file only
            after you approve it. Answers, grading workbooks and instructor
            materials stay private.
          </p>
        </div>
        <span className="badge green">ADMIN APPROVAL REQUIRED</span>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="info-strip" role="status">
          <CheckCircle2 size={17} />
          {message}
        </div>
      )}
      <div className="automation-stats">
        {[
          [
            "Awaiting review",
            state.items.filter((i) => i.status === "pending").length,
          ],
          ["Connected batches", state.sources.length],
          [
            "Released resources",
            state.items.filter((i) => i.status === "published").length,
          ],
          [
            "Sources needing attention",
            state.sources.filter((s) =>
              ["failed", "partial"].includes(s.status),
            ).length,
          ],
        ].map(([title, n]) => (
          <div className="stat" key={title}>
            <span>{title}</span>
            <b>{n}</b>
          </div>
        ))}
      </div>
      <div className="automation-toolbar">
        <div className="filter-bar">
          {[
            ["inbox", "Content inbox"],
            ["sources", "Batch folders"],
            ["history", "Run history"],
          ].map(([id, title]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {title}
            </button>
          ))}
        </div>
        <button className="text-btn" disabled={busy} onClick={load}>
          <RefreshCw size={14} /> Refresh status
        </button>
      </div>
      {tab === "sources" ? (
        <>
          <div className="info-strip">
            <FolderOpen size={19} />
            <span>
              Use the exact Drive folder name, or paste its link for an exact
              match. Each batch keeps its own source and approval queue. Changes
              are picked up by the background scan; the page does not need to
              stay open.
            </span>
          </div>
          {!state.importer_configured && (
            <div className="error-banner">
              Background import credentials are not configured yet. You can save
              folder mappings now.
            </div>
          )}
          {state.sources.length ? (
            <div className="two-col">
              {state.sources.map((s) => (
                <section className="panel source-card" key={s.id}>
                  <div className="row between">
                    <Badge value={s.enabled ? s.status : "paused"} />
                    <button
                      className="text-btn"
                      onClick={() => setSource({ ...s, enabled: !!s.enabled })}
                    >
                      Edit mapping
                    </button>
                  </div>
                  <h2>{s.batch_name}</h2>
                  <p className="source-folder">
                    <FolderOpen size={17} />
                    {s.folder_name || s.folder_input}
                  </p>
                  <dl>
                    <dt>Last scan</dt>
                    <dd>{when(s.last_sync)}</dd>
                    <dt>Folder match</dt>
                    <dd>
                      {s.folder_id ? "Resolved" : "Awaiting background lookup"}
                    </dd>
                    <dt>Release policy</dt>
                    <dd>Admin approval</dd>
                  </dl>
                  {s.last_error && <p className="form-error">{s.last_error}</p>}
                  <div className="row between">
                    <span className="muted">
                      {s.sync_requested
                        ? "Scan requested · next scheduled run"
                        : "Automatic checks enabled"}
                    </span>
                    <button
                      className="button secondary"
                      disabled={busy || !s.enabled}
                      onClick={() =>
                        action(
                          () => request("sync", { source_id: s.id }),
                          "Scan requested. The next scheduled check will process this folder.",
                        )
                      }
                    >
                      <RefreshCw size={14} /> Sync Up
                    </button>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="empty">
              <FolderOpen size={30} />
              <h3>One folder for each batch</h3>
              <p>
                Connect your first batch folder to start collecting materials
                for approval.
              </p>
            </div>
          )}
        </>
      ) : tab === "history" ? (
        <section className="panel table-panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Discovered</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {state.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.batch_name}</td>
                    <td>{when(r.started)}</td>
                    <td>
                      <Badge value={r.status} />
                    </td>
                    <td>{r.discovered}</td>
                    <td className="run-message">
                      {r.message || "Scan in progress"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!state.runs.length && (
              <div className="empty">
                <Clock size={29} />
                <h3>Your first scan is ahead</h3>
                <p>
                  Each background check will appear here, including incomplete
                  scans and the reason for any failure.
                </p>
              </div>
            )}
          </div>
        </section>
      ) : (
        <>
          <div className="inbox-filters">
            <label>
              Batch
              <select value={batch} onChange={(e) => setBatch(e.target.value)}>
                <option value="all">All batches</option>
                {batches.map((b) => (
                  <option value={b.id} key={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Show
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {[
                  ["pending", "Awaiting review"],
                  ["published", "Released"],
                  ["restricted", "Instructor only"],
                  ["rejected", "Rejected"],
                  ["superseded", "Older versions"],
                  ["all", "All imports"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted">{items.length} items · newest first</span>
          </div>
          {items.length ? (
            <div className="import-grid">
              {items.map((i) => (
                <section className="panel import-card" key={i.id}>
                  <div className="row between">
                    <span className="badge blue">{label[i.kind]}</span>
                    <Badge value={i.status} />
                  </div>
                  <h3>{i.title}</h3>
                  <p>
                    {i.batch_name} · {i.topic}
                  </p>
                  <small className="source-path">{i.source_path}</small>
                  <div className="import-meta">
                    <span>
                      {i.file_id ? "Attachment copied to portal" : "Drive link"}{" "}
                      · {when(i.created)}
                    </span>
                    {i.file_id ? (
                      <a href={"/api/files/" + i.file_id} className="text-btn">
                        <Download size={14} /> Preview file
                      </a>
                    ) : (
                      <a
                        href={i.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-btn"
                      >
                        Open source <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                  {i.status === "pending" ? (
                    <button
                      className="button secondary"
                      onClick={() => setReview(i)}
                    >
                      Review & release <ArrowRight size={15} />
                    </button>
                  ) : (
                    <p className="help-note">
                      {i.status === "restricted"
                        ? i.warning
                        : i.review_note || `Reviewed ${when(i.reviewed_at)}`}
                    </p>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <div className="empty">
              <CheckCircle2 size={32} />
              <h3>
                {filter === "pending"
                  ? "Your review queue is clear"
                  : "No matching imports"}
              </h3>
              <p>
                New files appear after a background scan. Changing a source file
                creates a new revision for review.
              </p>
            </div>
          )}
          <p className="help-note">
            This view shows the latest 500 imported revisions and 100 runs. New
            releases never happen automatically.
          </p>
        </>
      )}
      {source && (
        <Dialog title="Connect a batch to Drive" close={() => setSource(null)}>
          <SourceForm
            initial={source}
            batches={batches}
            save={async (values) => {
              if (
                await action(
                  () => request("source", values),
                  "Batch folder saved. A scan has been requested.",
                )
              )
                setSource(null);
            }}
          />
        </Dialog>
      )}
      {review && (
        <Dialog title="Review before release" close={() => setReview(null)}>
          <ReviewForm
            item={review}
            busy={busy}
            submit={async (values) => {
              if (
                await action(
                  () => request("review", { ...values, id: review.id }),
                  values.action === "approve"
                    ? "Resource released to this batch."
                    : "Import rejected. Students cannot see it.",
                )
              )
                setReview(null);
            }}
          />
        </Dialog>
      )}
    </>
  );
}
function Badge({ value }) {
  return (
    <span className={"badge " + statusTone(value)}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
function Dialog({ title, close, children }) {
  const ref = React.useRef();
  useEffect(() => {
    const old = document.activeElement;
    ref.current?.focus();
    document.body.style.overflow = "hidden";
    const fn = (e) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = ref.current.querySelectorAll(
            "button:not(:disabled),input,select,textarea,a[href]",
          ),
          first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", fn);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", fn);
      old?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-dialog-title"
      >
        <div className="modal-header">
          <h2 id="automation-dialog-title">{title}</h2>
          <button
            className="icon-btn"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={21} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
function SourceForm({ initial, batches, save }) {
  const [v, setV] = useState(initial),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await save(v);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Batch
        <select
          required
          disabled={!!initial.id}
          value={v.batch_id}
          onChange={(e) => setV({ ...v, batch_id: e.target.value })}
        >
          <option value="">Choose a batch</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Drive folder name or link
        <input
          required
          value={v.folder_input}
          onChange={(e) => setV({ ...v, folder_input: e.target.value })}
          placeholder="DevOps - Batch 01-11-26"
        />
        <small>
          Exact name works. A folder link avoids ambiguity if names are
          repeated.
        </small>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={!!v.enabled}
          onChange={(e) => setV({ ...v, enabled: e.target.checked })}
        />{" "}
        Check this folder automatically
      </label>
      <div className="info-strip">
        Import automatically → admin reviews → students receive approved
        materials.
      </div>
      {initial.id && (
        <p className="help-note">
          Changing the folder starts a fresh import history. Old published
          resources remain available; unpublish them separately if necessary.
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? "Saving…" : "Save folder mapping"}
        <Check size={16} />
      </button>
    </form>
  );
}
function ReviewForm({ item: i, submit, busy }) {
  const [v, setV] = useState({
    title: i.title,
    topic: i.topic,
    topic_order: i.topic_order,
    body: "",
    student_url: "",
    confirmed_student_safe: false,
    note: "",
  });
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        submit({ ...v, action: "approve" });
      }}
    >
      <div className="row between">
        <span className="badge blue">{label[i.kind]}</span>
        <span className="muted">{i.batch_name}</span>
      </div>
      <div className="info-strip">{i.warning}</div>
      <div className="row gap">
        {i.file_id && (
          <a className="button secondary" href={"/api/files/" + i.file_id}>
            <Download size={15} /> Download & review
          </a>
        )}
        <a
          className="button secondary"
          href={i.source_url}
          target="_blank"
          rel="noreferrer"
        >
          Open Drive source <ExternalLink size={14} />
        </a>
      </div>
      <label>
        Student-facing title
        <input
          required
          maxLength={200}
          value={v.title}
          onChange={(e) => setV({ ...v, title: e.target.value })}
        />
      </label>
      <div className="form-grid">
        <label>
          Topic
          <input
            required
            value={v.topic}
            onChange={(e) => setV({ ...v, topic: e.target.value })}
          />
        </label>
        <label>
          Topic number
          <input
            required
            min="1"
            max="100"
            type="number"
            value={v.topic_order}
            onChange={(e) => setV({ ...v, topic_order: e.target.value })}
          />
        </label>
      </div>
      <label>
        Instructions for students
        <textarea
          rows={3}
          value={v.body}
          onChange={(e) => setV({ ...v, body: e.target.value })}
          placeholder="What should students focus on?"
        />
      </label>
      {i.kind === "test_link" && (
        <label>
          Published student Google Form link
          <input
            required
            type="url"
            value={v.student_url}
            onChange={(e) => setV({ ...v, student_url: e.target.value })}
            placeholder="https://docs.google.com/forms/d/…/viewform"
          />
          <small>
            Use the student response link. Never publish an edit link, answer
            key or response sheet.
          </small>
        </label>
      )}
      <label>
        Review note
        <textarea
          rows={2}
          value={v.note}
          onChange={(e) => setV({ ...v, note: e.target.value })}
        />
      </label>
      <label className="checkbox-row">
        <input
          required
          type="checkbox"
          checked={v.confirmed_student_safe}
          onChange={(e) =>
            setV({ ...v, confirmed_student_safe: e.target.checked })
          }
        />{" "}
        I reviewed this revision, including presenter notes, and confirm it is
        ready for students.
      </label>
      <div className="row between">
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => submit({ ...v, action: "reject" })}
        >
          Reject import
        </button>
        <button className="button" disabled={busy}>
          {busy ? "Saving…" : "Approve & release"}
          <Check size={16} />
        </button>
      </div>
    </form>
  );
}
