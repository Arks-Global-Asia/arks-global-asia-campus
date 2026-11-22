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
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
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
  guide: "Resource Creation Guide",
  recording: "Recording",
  image: "Image / Diagram",
  sop: "Bootcamp guide",
  test_link: "External assessment",
  private: "Instructor only",
};

const studentKindOptions = [
  ["notes", "Notes / Code / Config"],
  ["slides", "Presentation (PPT/Slides)"],
  ["lab", "Practice Lab"],
  ["guide", "Resource Creation Guide"],
  ["recording", "Class Recording"],
  ["image", "Image / Architecture Diagram"],
  ["sop", "Bootcamp Guide / SOP"],
  ["test_link", "External Google Form Test"],
];

const statusTone = (s) =>
  ["ready", "published", "succeeded"].includes(s)
    ? "green"
    : ["restricted", "failed", "partial"].includes(s)
      ? "amber"
      : "blue";

function parseCfg(raw) {
  if (!raw)
    return {
      excluded_folders: [
        "do_not_share",
        "trainer_only",
        "lab_answers",
        "student_submissions",
      ],
      excluded_extensions: [],
      auto_daily_test: true,
    };
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {
      excluded_folders: [
        "do_not_share",
        "trainer_only",
        "lab_answers",
        "student_submissions",
      ],
      excluded_extensions: [],
      auto_daily_test: true,
    };
  }
}

export default function AutomationPanel({ batches, onPublished }) {
  const [state, setState] = useState(null),
    [tab, setTab] = useState("inbox"),
    [filter, setFilter] = useState("pending"),
    [batch, setBatch] = useState("all"),
    [classDate, setClassDate] = useState("all"),
    [selectedIds, setSelectedIds] = useState([]),
    [bunchSafe, setBunchSafe] = useState(true),
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
      if (onPublished) {
        try {
          await onPublished();
        } catch {}
      }
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

  const classDates = [
    ...new Set(state.items.map((i) => i.class_date).filter(Boolean)),
  ].sort((a, b) => b.localeCompare(a));

  const items = state.items.filter(
    (i) =>
      (batch === "all" || i.batch_id === batch) &&
      (classDate === "all" || i.class_date === classDate) &&
      (filter === "all" || i.status === filter),
  );

  const bunchEligible = items.filter(
    (i) =>
      i.status === "pending" &&
      i.kind !== "private" &&
      i.kind !== "test_link",
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR TEACHING, WITH LESS BUSYWORK</div>
          <h1>Let the materials come to you.</h1>
          <p>
            Connect each batch’s Drive folder. Review what arrives, override
            categories, or approve a full day’s class materials in one click.
          </p>
        </div>
        <button
          className="button"
          onClick={() => {
            setSource({
              batch_id: batches[0]?.id || "",
              folder_input: "",
              enabled: true,
              config: parseCfg(null),
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
            Automatic imports arrive as drafts (notes, presentations, images,
            diagrams, resource creation guides, labs, and recordings). Approve
            individual items or bunch-approve an entire class day in one click.
          </p>
        </div>
        <span className="badge green">TRAINER / ADMIN APPROVAL</span>
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
              match. Configure subfolder and file-type exclusion filters per
              batch so private trainer folders are skipped automatically.
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
              {state.sources.map((s) => {
                const cfg = parseCfg(s.config);
                return (
                  <section className="panel source-card" key={s.id}>
                    <div className="row between">
                      <Badge value={s.enabled ? s.status : "paused"} />
                      <button
                        className="text-btn"
                        onClick={() =>
                          setSource({
                            ...s,
                            enabled: !!s.enabled,
                            config: cfg,
                          })
                        }
                      >
                        Edit mapping & filters
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
                        {s.folder_id
                          ? "Resolved"
                          : "Awaiting background lookup"}
                      </dd>
                      <dt>Excluded subfolders</dt>
                      <dd>
                        {(cfg.excluded_folders || []).join(", ") || "None"}
                      </dd>
                      <dt>Excluded file extensions</dt>
                      <dd>
                        {(cfg.excluded_extensions || []).join(", ") || "None"}
                      </dd>
                    </dl>
                    {s.last_error && (
                      <p className="form-error">{s.last_error}</p>
                    )}
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
                );
              })}
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
              Class date
              <select
                value={classDate}
                onChange={(e) => setClassDate(e.target.value)}
              >
                <option value="all">All class dates</option>
                {classDates.map((d) => (
                  <option key={d} value={d}>
                    {d}
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
                  ["restricted", "Instructor only / Excluded"],
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

          {bunchEligible.length > 0 && (
            <section className="panel bunch-approval-bar">
              <div className="row between wrap gap">
                <div>
                  <h3>
                    Single-Click Bunch / Day Approval ({bunchEligible.length}{" "}
                    ready)
                  </h3>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={bunchSafe}
                      onChange={(e) => setBunchSafe(e.target.checked)}
                    />{" "}
                    I confirm these pending class materials are safe to publish
                    to students.
                  </label>
                </div>
                <div className="row gap wrap">
                  {selectedIds.length > 0 && (
                    <button
                      className="button secondary"
                      disabled={busy || !bunchSafe}
                      onClick={() =>
                        action(async () => {
                          const r = await request("approve-batch", {
                            item_ids: selectedIds,
                            confirmed_student_safe: bunchSafe,
                          });
                          setSelectedIds([]);
                          return {
                            message: `Approved and published ${r.approved_count} selected materials.`,
                          };
                        })
                      }
                    >
                      <Check size={15} /> Approve Selected ({selectedIds.length}
                      )
                    </button>
                  )}
                  <button
                    className="button"
                    disabled={busy || !bunchSafe}
                    onClick={() =>
                      action(async () => {
                        const r = await request("approve-batch", {
                          item_ids: bunchEligible.map((i) => i.id),
                          confirmed_student_safe: bunchSafe,
                        });
                        setSelectedIds([]);
                        return {
                          message: `Approved and published ${r.approved_count} materials in one click.`,
                        };
                      })
                    }
                  >
                    <CheckCircle2 size={16} /> Approve All Pending (
                    {bunchEligible.length})
                  </button>
                </div>
              </div>
            </section>
          )}

          {items.length ? (
            <div className="import-grid">
              {items.map((i) => (
                <section className="panel import-card" key={i.id}>
                  <div className="row between">
                    <label className="row gap">
                      {i.status === "pending" &&
                        i.kind !== "private" &&
                        i.kind !== "test_link" && (
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(i.id)}
                            onChange={(e) =>
                              setSelectedIds(
                                e.target.checked
                                  ? [...selectedIds, i.id]
                                  : selectedIds.filter((id) => id !== i.id),
                              )
                            }
                          />
                        )}
                      <span className="badge blue">
                        {label[i.kind] || i.kind}
                      </span>
                    </label>
                    <Badge value={i.status} />
                  </div>
                  <h3>{i.title}</h3>
                  <p>
                    {i.batch_name} · {i.topic}
                    {i.class_date ? ` · Class ${i.class_date}` : ""}
                  </p>
                  <small className="source-path">{i.source_path}</small>
                  <div className="import-meta">
                    <span>
                      {i.file_id ? "Attachment copied to portal" : "Drive link"}{" "}
                      · {when(i.created)}
                    </span>
                    {i.file_id ? (
                      <a
                        href={"/api/files/" + i.file_id + "?inline=1"}
                        target="_blank"
                        rel="noreferrer"
                        className="text-btn"
                      >
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
                  {i.status === "pending" || i.status === "restricted" ? (
                    <button
                      className="button secondary"
                      onClick={() => setReview(i)}
                    >
                      {i.status === "restricted"
                        ? "Override category & release"
                        : "Review & release"}{" "}
                      <ArrowRight size={15} />
                    </button>
                  ) : (
                    <p className="help-note">
                      {i.review_note || `Reviewed ${when(i.reviewed_at)}`}
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
            releases never happen without trainer or administrator approval.
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
                  "Batch folder and exclusion filters saved. A scan has been requested.",
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
  const initialCfg = parseCfg(initial.config);
  const [v, setV] = useState({
      ...initial,
      excluded_folders_text: (initialCfg.excluded_folders || []).join(", "),
      excluded_extensions_text: (initialCfg.excluded_extensions || []).join(
        ", ",
      ),
      auto_daily_test: initialCfg.auto_daily_test !== false,
    }),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await save({
            batch_id: v.batch_id,
            folder_input: v.folder_input,
            enabled: v.enabled,
            config: {
              excluded_folders: v.excluded_folders_text
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              excluded_extensions: v.excluded_extensions_text
                .split(",")
                .map((s) => s.trim().replace(/^\.+/, ""))
                .filter(Boolean),
              auto_daily_test: v.auto_daily_test,
            },
          });
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
      <label>
        Excluded subfolders (comma-separated)
        <input
          value={v.excluded_folders_text}
          onChange={(e) =>
            setV({ ...v, excluded_folders_text: e.target.value })
          }
          placeholder="do_not_share, trainer_only, lab_answers, student_submissions"
        />
        <small>
          All other folders (notes, slides, images, resource_creation, labs,
          recordings) are scanned automatically.
        </small>
      </label>
      <label>
        Excluded file extensions (optional, comma-separated)
        <input
          value={v.excluded_extensions_text}
          onChange={(e) =>
            setV({ ...v, excluded_extensions_text: e.target.value })
          }
          placeholder="tmp, bak"
        />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={!!v.enabled}
          onChange={(e) => setV({ ...v, enabled: e.target.checked })}
        />{" "}
        Check this folder automatically
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={!!v.auto_daily_test}
          onChange={(e) => setV({ ...v, auto_daily_test: e.target.checked })}
        />{" "}
        Auto-generate 9:00 AM IST Daily (Mon–Sat) & Sunday Weekly tests from
        approved materials
      </label>
      <div className="info-strip">
        Import automatically → trainer/admin reviews (or 1-click bunch approves)
        → students receive approved materials.
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
    kind: i.kind === "private" ? "notes" : i.kind,
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
        <span className="badge blue">{label[v.kind] || v.kind}</span>
        <span className="muted">{i.batch_name}</span>
      </div>
      <div className="info-strip">{i.warning}</div>
      <div className="row gap">
        {i.file_id && (
          <a
            className="button secondary"
            href={"/api/files/" + i.file_id + "?inline=1"}
            target="_blank"
            rel="noreferrer"
          >
            <Download size={15} /> Preview / download file
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
      <div className="form-grid">
        <label>
          Student-facing title
          <input
            required
            maxLength={200}
            value={v.title}
            onChange={(e) => setV({ ...v, title: e.target.value })}
          />
        </label>
        <label>
          Resource category
          <select
            value={v.kind}
            onChange={(e) => setV({ ...v, kind: e.target.value })}
          >
            {studentKindOptions.map(([val, text]) => (
              <option key={val} value={val}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </div>
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
      {v.kind === "test_link" && (
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
