import { QUESTION_TYPES } from "../shared/assessment.js";
import React, { useEffect, useState } from "react";

export async function request(path, body) {
  const r = await fetch(
    "/api/" + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d;
}

function Field({ label, children, ...props }) {
  return (
    <label>
      {label}
      {children || <input {...props} />}
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Login({ onLogin }) {
  const [config, setConfig] = useState({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request("auth/config")
      .then(setConfig)
      .catch(() => {});
  }, []);
  return (
    <main className="login-page">
      <section className="panel login-panel">
        <img
          src="/brand.png"
          className="login-logo"
          alt="Arks Global Asia Institutes"
        />
        <h1>Your learning starts here.</h1>
        <p>
          Students & instructors: sign in with the Google account enrolled by
          your institute.
        </p>
        {config.google_ready ? (
          <a className="button" href="/api/auth/google/start">
            Continue with Google
          </a>
        ) : (
          <p className="info-strip">
            Google sign-in is awaiting configuration by your administrator.
          </p>
        )}
        <hr />
        <h2>Administrator & Trainer sign-in</h2>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await request(
                "auth/admin",
                Object.fromEntries(new FormData(e.target)),
              );
              await onLogin();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label="Staff email (Admin or Trainer)"
            name="email"
            type="email"
            autoComplete="username"
            required
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <button className="button" disabled={busy}>
            {busy ? "Signing in…" : "Open staff portal"}
          </button>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}

export function Tour({ user, adminMode, onNavigate, blocked }) {
  const key = "arks-tour-" + user.id + "-" + (adminMode ? "admin" : "student"),
    [step, setStep] = useState(0),
    [open, setOpen] = useState(() => {
      try {
        return localStorage.getItem(key) !== "hidden";
      } catch {
        return true;
      }
    });
  const steps = adminMode
    ? [
        [
          "Your command centre",
          "Enroll students, organize batches, manage curriculum and publish class resources across 6 focused workspaces.",
          "dashboard",
        ],
        [
          "Drive Sync Up & 1-Click Day Approval",
          "Sync Up imports notes, PPTs, diagrams, guides and recordings. Override categories or approve an entire day in one click.",
          "dashboard",
        ],
        [
          "Automated 9:00 AM IST Assessments",
          "Daily tests (20+ Qs Mon–Sat) and Sunday Weekly tests (25+ Qs) run automatically with DeepSeek diagnostic coaching.",
          "dashboard",
        ],
      ]
    : [
        [
          "Welcome to your campus",
          "Your batch selector keeps your classes, resources and progress together.",
          "dashboard",
        ],
        [
          "Your classroom and library",
          "Join live sessions, replay recordings and read or download approved learning materials.",
          "resources",
        ],
        [
          "Practice and assessments",
          "Upload lab solutions and take each assessment with the question palette and diagnostic coaching report.",
          "tests",
        ],
        [
          "See your progress",
          "Follow your batch roadmap, check your course fees and contact your support team.",
          "progress",
        ],
      ];
  if (!open || blocked) return null;
  return (
    <div className="tour-backdrop">
      <section
        className="panel tour-card"
        role="dialog"
        aria-modal="true"
        aria-label="Campus guided tour"
      >
        <small>
          YOUR CAMPUS GUIDE · {step + 1}/{steps.length}
        </small>
        <h2>{steps[step][0]}</h2>
        <p>{steps[step][1]}</p>
        <div className="row gap wrap">
          <button
            className="button"
            onClick={() => {
              onNavigate(steps[step][2]);
              if (step === steps.length - 1) setOpen(false);
              else setStep(step + 1);
            }}
          >
            {step === steps.length - 1 ? "Get started" : "Next"}
          </button>
          <button className="button secondary" onClick={() => setOpen(false)}>
            Skip
          </button>
          <button
            className="text-btn"
            onClick={() => {
              try {
                localStorage.setItem(key, "hidden");
              } catch {}
              setOpen(false);
            }}
          >
            Don’t show again
          </button>
        </div>
      </section>
    </div>
  );
}

export function SupportLinks({ batch }) {
  const c = JSON.parse(batch?.config || "{}");
  return (
    <section className="panel">
      <h2>Reach your support team</h2>
      <div className="row gap wrap">
        {c.support_email && (
          <a className="button" href={"mailto:" + c.support_email}>
            Email support
          </a>
        )}
        {c.whatsapp_url && (
          <a
            className="button secondary"
            href={c.whatsapp_url}
            target="_blank"
            rel="noreferrer"
          >
            Open WhatsApp group
          </a>
        )}
        {!c.support_email && !c.whatsapp_url && (
          <p>
            Your administrator hasn’t added contact links yet. You can submit a
            query below.
          </p>
        )}
      </div>
    </section>
  );
}

export function Assessments({ tests, attempts, render }) {
  const [kind, setKind] = useState("all"),
    [status, setStatus] = useState("all");
  const filtered = tests.filter((t) => {
    const a = attempts.find((a) => a.test_id === t.id);
    const s = !a
      ? "new"
      : !a.submitted
        ? "progress"
        : a.grading_status && a.grading_status !== "complete"
          ? "attempted"
          : a.score / a.total >= 0.7
            ? "passed"
            : "failed";
    return (
      (kind === "all" || t.kind === kind) &&
      (status === "all" ||
        status === s ||
        (status === "attempted" && a?.submitted))
    );
  });
  return (
    <>
      <div className="filter-bar wrap">
        {[
          ["all", "All tests"],
          ["daily", "Daily"],
          ["weekly", "Weekly"],
          ["monthly", "Monthly"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={kind === id ? "active" : ""}
            onClick={() => setKind(id)}
          >
            {label}
          </button>
        ))}
        <select
          aria-label="Assessment status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {[
            ["all", "All statuses"],
            ["new", "New"],
            ["progress", "In progress"],
            ["attempted", "Attempted"],
            ["passed", "Passed"],
            ["failed", "Failed"],
          ].map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {filtered.length ? (
        render(filtered)
      ) : (
        <section className="panel">
          <h3>No assessments match these filters.</h3>
        </section>
      )}
    </>
  );
}

export function Roadmap({ batch, course, data }) {
  const cfg = JSON.parse(batch.config || "{}"),
    roadmap = cfg.roadmap?.length ? cfg.roadmap : JSON.parse(course.syllabus),
    done = new Set(data.completions.map((c) => c.content_id));
  return (
    <section className="panel">
      <h2>
        {cfg.roadmap?.length ? "Your batch SOP roadmap" : "Your course roadmap"}
      </h2>
      <p>
        {cfg.roadmap?.length
          ? "Published from the batch SOP and reviewed by your instructor."
          : "Your instructor can extract and approve a roadmap from this batch’s SOP."}
      </p>
      <div className="roadmap">
        {roadmap.map((s, i) => {
          const resources = data.content.filter(
            (c) =>
              c.topic_order === i + 1 &&
              ["notes", "slides", "guide", "recording", "lab", "image"].includes(
                c.kind,
              ),
          );
          const complete = resources.filter((c) => done.has(c.id)).length;
          return (
            <div className="roadmap-item" key={i}>
              <div
                className={
                  "road-number " + (i < batch.covered ? "covered" : "")
                }
              >
                {i + 1}
              </div>
              <div>
                <h3>{s.title}</h3>
                <p>{s.detail}</p>
                <small>
                  {i < batch.covered ? "Covered in class" : "Upcoming"} ·{" "}
                  {complete}/{resources.length} tasks completed
                </small>
                <progress
                  max={Math.max(1, resources.length)}
                  value={complete}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function zoned(date, time, zone) {
  const [yy, mm, dd] = date.split("-").map(Number),
    [hh, mi] = time.split(":").map(Number);
  const target = Date.UTC(yy, mm - 1, dd, hh, mi);
  let timestamp = target;
  for (let n = 0; n < 3; n++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(timestamp))
        .map((p) => [p.type, p.value]),
    );
    timestamp +=
      target -
      Date.UTC(
        +parts.year,
        +parts.month - 1,
        +parts.day,
        +parts.hour,
        +parts.minute,
      );
  }
  return new Date(timestamp).toISOString();
}

export function AdminTools({ tab, data, batchId, user, refresh, edit }) {
  const [features, setFeatures] = useState(null),
    [localBatch, setLocalBatch] = useState(
      batchId || data.batches[0]?.id || "",
    ),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(false);
  const batch = data.batches.find((b) => b.id === localBatch);
  async function load() {
    setFeatures(await request("admin/features"));
  }
  useEffect(() => {
    load().catch((e) => setNotice(e.message));
  }, []);
  async function save(path, body) {
    setPending(true);
    try {
      const result = await request(path, body);
      setNotice(result.message || "Saved successfully.");
      await load();
      await refresh();
      return result;
    } catch (e) {
      setNotice(e.message);
      return null;
    } finally {
      setPending(false);
    }
  }
  if (!features) return <p>{notice || "Loading campus controls…"}</p>;
  return (
    <div className="feature-tools">
      <div className="row between wrap">
        <h2>
          {
            {
              settings: "Batch experience & roadmap",
              schedule: "Live session planner & recordings",
              engine: "AI Assessment Studio & 9:00 AM IST Scheduler",
              access: "Student Onboarding, Groups & Staff Access",
            }[tab]
          }
        </h2>
        <Select
          label="Batch"
          value={localBatch}
          onChange={setLocalBatch}
          options={data.batches.map((b) => [b.id, b.name])}
        />
      </div>
      {notice && (
        <p role="status" className="info-strip">
          {notice}
        </p>
      )}
      {!batch ? (
        <p>Create a batch first.</p>
      ) : (
        <>
          {tab === "settings" && (
            <BatchSettings
              key={batch.id + "-" + batch.config}
              batch={batch}
              data={data}
              save={save}
              pending={pending}
              features={features}
            />
          )}
          {tab === "schedule" && (
            <Schedule
              key={batch.id}
              batch={batch}
              data={data}
              save={save}
              pending={pending}
              edit={edit}
            />
          )}
          {tab === "engine" && (
            <Studio
              key={batch.id}
              batch={batch}
              data={data}
              save={save}
              features={features}
              pending={pending}
              edit={edit}
            />
          )}
          {tab === "access" && (
            <Access
              key={batch.id}
              batch={batch}
              data={data}
              user={user}
              save={save}
              pending={pending}
              features={features}
            />
          )}
        </>
      )}
    </div>
  );
}

function BatchSettings({ batch, data, save, pending, features }) {
  const cfg = JSON.parse(batch.config || "{}"),
    [roadmap, setRoadmap] = useState(
      JSON.stringify(cfg.roadmap || [], null, 2),
    ),
    [parseError, setParseError] = useState("");
  return (
    <>
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const d = Object.fromEntries(new FormData(e.target));
            d.roadmap = JSON.parse(roadmap);
            d.require_google_group =
              new FormData(e.target).get("require_google_group") === "on";
            save("admin/batch-config", { ...d, batch_id: batch.id });
            setParseError("");
          } catch {
            setParseError("Roadmap must be valid JSON.");
          }
        }}
      >
        <h3>Course guide and support</h3>
        <label className="row gap">
          <input
            type="checkbox"
            name="require_google_group"
            defaultChecked={cfg.require_google_group}
          />
          Require access-group membership for this batch
        </label>
        <Field
          label="Support email"
          name="support_email"
          type="email"
          defaultValue={cfg.support_email || ""}
        />
        <Field
          label="WhatsApp group link"
          name="whatsapp_url"
          type="url"
          defaultValue={cfg.whatsapp_url || ""}
        />
        <Field label="Full course overview">
          <textarea
            name="overview"
            rows={7}
            defaultValue={cfg.overview || ""}
          />
        </Field>
        <Field
          label="Lab submissions destination: Shared Drive folder ID"
          name="submission_folder"
          defaultValue={cfg.submission_folder || ""}
        />
        <p className="help-note">
          Students upload PDF/DOCX in the portal. The Azure engine transfers
          submissions to this private folder.
        </p>
        <Field label="Roadmap (title and detail for each topic)">
          <textarea
            rows={8}
            value={roadmap}
            onChange={(e) => setRoadmap(e.target.value)}
          />
        </Field>
        <input
          type="hidden"
          name="sop_content_id"
          value={cfg.sop_content_id || ""}
        />
        {parseError && <p className="form-error">{parseError}</p>}
        <button className="button" disabled={pending}>
          Save batch experience
        </button>
      </form>
      <section className="panel">
        <h3>Extract a roadmap from the approved SOP</h3>
        {data.content
          .filter(
            (c) =>
              c.kind === "sop" &&
              c.published &&
              c.course_id === batch.course_id &&
              (!c.batch_id || c.batch_id === batch.id),
          )
          .map((c) => (
            <div className="row between" key={c.id}>
              <span>{c.title}</span>
              <button
                className="button secondary"
                disabled={pending}
                onClick={() =>
                  save("admin/extract-sop", {
                    batch_id: batch.id,
                    content_id: c.id,
                  })
                }
              >
                Extract roadmap
              </button>
            </div>
          ))}
        {features.jobs
          .filter((j) => j.batch_id === batch.id && j.kind === "extract_sop")
          .map((j) => (
            <SopJob key={j.id} job={j} save={save} />
          ))}
      </section>
    </>
  );
}

function SopJob({ job, save }) {
  const [result, setResult] = useState(null);
  return (
    <div className="panel">
      <span>SOP extraction · {job.status}</span>
      {job.error && <p>{job.error}</p>}
      {job.status === "complete" && (
        <>
          <button
            className="text-btn"
            onClick={async () => {
              const r = await request("admin/job-result?id=" + job.id);
              setResult(JSON.parse(r.result));
            }}
          >
            Review extracted roadmap
          </button>
          {result && (
            <>
              <ol>
                {result.roadmap.map((r, i) => (
                  <li key={i}>
                    <b>{r.title}</b>
                    <p>{r.detail}</p>
                  </li>
                ))}
              </ol>
              <button
                className="button"
                onClick={() => save("admin/apply-roadmap", { job_id: job.id })}
              >
                Approve roadmap for students
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Schedule({ batch, data, save, pending, edit }) {
  const [error, setError] = useState(""),
    [completingId, setCompletingId] = useState(null),
    [recUrl, setRecUrl] = useState("");
  return (
    <>
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const d = Object.fromEntries(new FormData(e.target)),
              days = new FormData(e.target).getAll("weekday").map(Number),
              dates = [];
            for (let i = 0; i < Number(d.days); i++) {
              const date = new Date(d.start + "T12:00:00Z");
              date.setUTCDate(date.getUTCDate() + i);
              const key = date.toISOString().slice(0, 10);
              if (
                days.includes(date.getUTCDay()) &&
                !d.exclude.split(/[\s,]+/).includes(key)
              )
                dates.push(zoned(key, d.time, batch.timezone));
            }
            save("admin/sessions", { ...d, batch_id: batch.id, dates });
            setError("");
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        <h3>Create a flexible class series (9:30 PM – 10:30 PM IST default)</h3>
        <div className="two-col">
          <Field
            label="Class title ({n} adds the session number)"
            name="title"
            defaultValue="DevOps · Class {n}"
            required
          />
          <Field label="Start date" name="start" type="date" required />
          <Field
            label={"Class time · " + batch.timezone}
            name="time"
            type="time"
            defaultValue="21:30"
            required
          />
          <Field
            label="Calendar days"
            name="days"
            type="number"
            min="1"
            max="180"
            defaultValue="30"
          />
          <Field
            label="Duration in minutes"
            name="duration"
            type="number"
            min="1"
            max="1440"
            defaultValue="60"
          />
          <Field label="Meeting link" name="url" type="url" />
        </div>
        <div className="row gap wrap">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
            <label className="row gap" key={day}>
              <input name="weekday" type="checkbox" value={i} defaultChecked={i !== 0} />
              {day}
            </label>
          ))}
        </div>
        <Field
          label="Skip dates (YYYY-MM-DD, separated by commas)"
          name="exclude"
        />
        <Field label="Class brief">
          <textarea name="body" rows={3} />
        </Field>
        {error && <p className="form-error">{error}</p>}
        <button className="button" disabled={pending}>
          Create sessions
        </button>
      </form>
      <section className="panel">
        <h3>Scheduled classes</h3>
        {data.content
          .filter((c) => c.kind === "live" && c.batch_id === batch.id)
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
          .map((c) => (
            <div key={c.id}>
              <div className="session-row">
                <div className="grow">
                  <h3>{c.title}</h3>
                  <p>
                    {c.starts_at
                      ? new Date(c.starts_at).toLocaleString("en-IN", {
                          timeZone: batch.timezone,
                        })
                      : "Unscheduled"}{" "}
                    · {c.session_status}
                  </p>
                </div>
                {c.session_status !== "completed" && (
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setCompletingId(completingId === c.id ? null : c.id);
                      setRecUrl("");
                    }}
                  >
                    Complete & attach recording
                  </button>
                )}
                <button
                  className="button secondary"
                  onClick={() => edit("content", c)}
                >
                  Modify
                </button>
                <button
                  className="text-btn"
                  disabled={pending}
                  onClick={() =>
                    save("admin/sessions", {
                      batch_id: batch.id,
                      id: c.id,
                      action:
                        c.session_status === "cancelled" ? "restore" : "cancel",
                    })
                  }
                >
                  {c.session_status === "cancelled" ? "Restore" : "Cancel"}
                </button>
                {c.series_id && (
                  <button
                    className="text-btn"
                    onClick={() => {
                      if (window.confirm("Cancel every class in this series?"))
                        save("admin/sessions", {
                          batch_id: batch.id,
                          id: c.id,
                          series_id: c.series_id,
                          whole_series: true,
                          action: "cancel",
                        });
                    }}
                  >
                    Cancel series
                  </button>
                )}
              </div>
              {completingId === c.id && (
                <form
                  className="panel form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const res = await save("admin/complete-session", {
                      session_id: c.id,
                      recording_url: recUrl,
                      advance_covered: true,
                    });
                    if (res) setCompletingId(null);
                  }}
                >
                  <h4>Complete session & publish recording</h4>
                  <Field
                    label="Recording HTTPS URL (Drive / YouTube / Meet recording link, optional)"
                    type="url"
                    value={recUrl}
                    onChange={(e) => setRecUrl(e.target.value)}
                    placeholder="https://drive.google.com/file/d/..."
                  />
                  <div className="row gap">
                    <button className="button" disabled={pending}>
                      Mark completed & publish recording
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setCompletingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          ))}
      </section>
    </>
  );
}

function Studio({ batch, data, save, features, pending, edit }) {
  const [chosen, setChosen] = useState([]),
    [kind, setKind] = useState("daily"),
    [count, setCount] = useState(20);
  const materials = data.content.filter(
    (c) =>
      c.published &&
      c.course_id === batch.course_id &&
      (!c.batch_id || c.batch_id === batch.id) &&
      ["notes", "slides", "guide", "lab", "recording", "image"].includes(
        c.kind,
      ),
  );
  return (
    <>
      <section className="panel">
        <div className="row between wrap gap">
          <div>
            <h3>Automated 9:00 AM IST Daily & Sunday Weekly Schedule</h3>
            <p>
              <b>Mon–Sat 9:00 AM IST:</b> Generates a 20–40+ question Daily Test
              (including YAML/CLI/code tasks) if class materials were taught the
              previous night (9:30 PM – 10:30 PM IST). Skips automatically if no
              class was held.
              <br />
              <b>Sunday 9:00 AM IST:</b> Generates a 25–50+ question Weekly Test
              covering all Monday–Saturday topics (no Daily Test on Sunday).
            </p>
          </div>
          <div className="row gap wrap">
            <button
              className="button secondary"
              type="button"
              disabled={pending}
              onClick={() =>
                save("admin/trigger-scheduled-tests", {
                  batch_id: batch.id,
                  mode: "daily",
                })
              }
            >
              Run 9 AM Daily Test Check
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={pending}
              onClick={() =>
                save("admin/trigger-scheduled-tests", {
                  batch_id: batch.id,
                  mode: "weekly",
                })
              }
            >
              Run Sunday Weekly Test Check
            </button>
          </div>
        </div>
      </section>
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          save("admin/generate-test", {
            ...Object.fromEntries(new FormData(e.target)),
            batch_id: batch.id,
            source_ids: chosen,
            question_types: new FormData(e.target).getAll("question_type"),
          });
        }}
      >
        <h3>Generate custom assessment from approved classes</h3>
        <p>
          DeepSeek creates a comprehensive assessment from readable approved
          materials (notes, slides, resource creation guides, labs, diagrams,
          and transcripts), including practical YAML, CLI, and scripting tasks.
        </p>
        {!features.engine_ready && (
          <p className="info-strip">
            Azure engine connection is not configured. Save its endpoint and
            function key as server secrets before using AI actions.
          </p>
        )}
        <div className="two-col">
          <Field label="Assessment title" name="title" required />
          <Field label="Assessment type">
            <select
              name="kind"
              value={kind}
              onChange={(e) => {
                const nextKind = e.target.value;
                setKind(nextKind);
                if (nextKind === "weekly" && count < 25) setCount(25);
                else if (nextKind === "daily" && count < 20) setCount(20);
              }}
            >
              <option value="daily">Daily (20+ recommended)</option>
              <option value="weekly">Weekly (25+ recommended)</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
          <Field
            label="Question count (min 20 for daily, 25 for weekly)"
            name="count"
            type="number"
            min="1"
            max="100"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
          <Field
            label="Time limit (minutes)"
            name="duration"
            type="number"
            min="1"
            max="180"
            defaultValue="45"
          />
        </div>
        <p>
          <b>
            100 marks · one attempt · 70 marks to pass · DeepSeek Diagnostic
            Coach enabled
          </b>
        </p>
        <fieldset>
          <legend>Question types (all types + YAML/CLI code enabled)</legend>
          <div className="question-type-picker">
            {Object.entries(QUESTION_TYPES).map(([type, label]) => (
              <label className="row gap" key={type}>
                <input
                  type="checkbox"
                  name="question_type"
                  value={type}
                  defaultChecked={[
                    "mcq",
                    "multi_select",
                    "true_false",
                    "fill_blank",
                    "short_answer",
                    "scenario",
                    "code",
                    "matching",
                    "ordering",
                  ].includes(type)}
                />
                {label}
              </label>
            ))}
          </div>
          <small>
            Choose at least one type. Question count must cover every selected
            type.
          </small>
        </fieldset>
        <div className="row between wrap">
          <b>Select approved class materials ({chosen.length} selected)</b>
          <div className="row gap">
            <button
              type="button"
              className="text-btn"
              onClick={() => setChosen(materials.slice(0, 30).map((c) => c.id))}
            >
              Select all ({Math.min(30, materials.length)})
            </button>
            <button
              type="button"
              className="text-btn"
              onClick={() => setChosen([])}
            >
              Clear
            </button>
          </div>
        </div>
        <div className="material-picker">
          {materials.map((c) => (
            <label className="row gap" key={c.id}>
              <input
                type="checkbox"
                checked={chosen.includes(c.id)}
                onChange={(e) =>
                  setChosen(
                    e.target.checked
                      ? [...chosen, c.id]
                      : chosen.filter((id) => id !== c.id),
                  )
                }
              />
              <span>
                Topic {c.topic_order}: {c.title} <small>({c.kind})</small>
              </span>
            </label>
          ))}
        </div>
        <button
          className="button"
          disabled={pending || !chosen.length || !features.engine_ready}
        >
          Generate draft assessment
        </button>
      </form>
      <section className="panel">
        <h3>Generation and evaluation jobs</h3>
        {features.jobs
          .filter((j) => j.batch_id === batch.id)
          .map((j) => (
            <div className="session-row" key={j.id}>
              <div className="grow">
                <b>{j.kind.replaceAll("_", " ")}</b>
                <p>
                  {j.status}
                  {j.error ? " · " + j.error : ""}
                </p>
              </div>
              {j.status === "failed" && (
                <button
                  className="button secondary"
                  onClick={() => save("admin/retry-job", { id: j.id })}
                >
                  Retry
                </button>
              )}
              {j.kind === "generate_test" &&
                j.status === "complete" &&
                data.tests.find((t) => t.id === j.entity_id) && (
                  <button
                    className="button"
                    onClick={() =>
                      edit(
                        "tests",
                        data.tests.find((t) => t.id === j.entity_id),
                      )
                    }
                  >
                    Review & publish
                  </button>
                )}
            </div>
          ))}
      </section>
    </>
  );
}

function Access({ batch, data, user, features, save, pending }) {
  const [group, setGroup] = useState(""),
    [csvText, setCsvText] = useState(""),
    [defaultFee, setDefaultFee] = useState(0);
  const g = features.groups.find((g) => g.id === group);
  const isHeadAdmin = !user || user.role === "admin";
  return (
    <>
      <section className="panel">
        <h3>Authentication & Domain Readiness</h3>
        <p>
          Google sign-in:{" "}
          {features.google_ready ? "configured" : "awaiting OAuth credentials"}{" "}
          · Mode: {features.auth_mode}
        </p>
        <p>
          Custom Domain (<code>student-portal.arksglobalasia.cloud</code>) &
          Azure Static Web Apps (
          <code>yellow-tree-0ceb4a400.3.azurestaticapps.net</code>) are
          authorized for both Google OAuth and Staff Password Sign-in.
        </p>
      </section>
      <form
        className="panel form"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await save("admin/bulk-invite", {
            batch_id: batch.id,
            fee: Math.round(Number(defaultFee || 0) * 100),
            csv: csvText,
          });
          if (res) setCsvText("");
        }}
      >
        <h3>Bulk CSV / Multi-Line Student Onboarding ({batch.name})</h3>
        <p>
          Paste one student per line as <code>email,name,fee_in_paise</code> or
          simply one email address per line. Already-registered students are
          enrolled immediately.
        </p>
        <Field
          label="Default agreed fee (major currency units, e.g. INR)"
          type="number"
          min="0"
          value={defaultFee}
          onChange={(e) => setDefaultFee(e.target.value)}
        />
        <Field label="Student emails or CSV rows">
          <textarea
            rows={5}
            required
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"student1@example.com,Aarav Sharma\nstudent2@example.com,Diya Patel"}
          />
        </Field>
        <button className="button" disabled={pending}>
          Bulk invite & enroll students
        </button>
      </form>
      <form
        key={group}
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          save("admin/group", {
            ...Object.fromEntries(new FormData(e.target)),
            id: group || undefined,
            batch_id: batch.id,
          });
        }}
      >
        <h3>Batch access groups</h3>
        <Select
          label="Group"
          value={group}
          onChange={setGroup}
          options={[
            ["", "Create group"],
            ...features.groups
              .filter((g) => g.batch_id === batch.id)
              .map((g) => [g.id, g.name]),
          ]}
        />
        <Field
          label="Group name"
          name="name"
          defaultValue={g?.name || ""}
          required
        />
        <Field
          label="Google Group email (optional)"
          name="google_group"
          defaultValue={g?.google_group || ""}
        />
        <Field label="Member emails">
          <textarea
            name="members"
            rows={5}
            defaultValue={features.members
              .filter((m) => m.group_id === group)
              .map((m) => m.email)
              .join("\n")}
          />
        </Field>
        <Field
          label="Enrollment fee in smallest currency unit (paise for INR)"
          name="fee"
          type="number"
          min="0"
          defaultValue="0"
        />
        <button className="button" disabled={pending}>
          Save group & enroll members
        </button>
      </form>
      {isHeadAdmin && (
        <>
          <form
            className="panel form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const r = await save(
                "admin/password",
                Object.fromEntries(new FormData(form)),
              );
              if (r) form.reset();
            }}
          >
            <h3>Create or reset staff login (Head / Admin or Trainer)</h3>
            <p>
              Passwords are salted and hashed with PBKDF2-SHA256. Both Head
              Administrators and Trainers can sign in with email & password or
              Google OAuth.
            </p>
            <div className="two-col">
              <Field label="Staff name" name="name" required />
              <Field label="Staff email" name="email" type="email" required />
              <Field label="Role">
                <select name="role" defaultValue="admin">
                  <option value="admin">Head / Administrator (Full Access)</option>
                  <option value="trainer">
                    Trainer / Instructor (Teaching & Content Access)
                  </option>
                </select>
              </Field>
              <Field
                label="New password (at least 14 characters)"
                name="password"
                type="password"
                minLength="14"
                autoComplete="new-password"
                required
              />
            </div>
            <button className="button" disabled={pending}>
              Save staff credentials
            </button>
          </form>
          <section className="panel">
            <h3>Account access</h3>
            {data.users.map((u) => (
              <div className="session-row" key={u.id}>
                <div className="grow">
                  <b>{u.name}</b>
                  <p>
                    {u.email} · {u.role}
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={pending}
                  onClick={() =>
                    save("admin/access", { user_id: u.id, active: !u.active })
                  }
                >
                  {u.active ? "Disable access" : "Enable access"}
                </button>
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}
