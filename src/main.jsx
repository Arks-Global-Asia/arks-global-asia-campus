import { QuestionInput, MixedQuestionBuilder } from "./QuestionControls.jsx";
import {
  QUESTION_TYPES,
  written,
  objectiveCorrect,
  answerText,
  feedbackText,
} from "../shared/assessment.js";
import {
  Login,
  Tour,
  SupportLinks,
  Assessments,
  Roadmap,
  AdminTools,
} from "./Features.jsx";
import AutomationPanel from "./AutomationPanel.jsx";
import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Video,
  Play,
  Library,
  FlaskConical,
  ClipboardCheck,
  ChartNoAxesCombined,
  Wallet,
  MessageCircle,
  BookOpen,
  Settings,
  ChevronRight,
  ArrowUpRight,
  ArrowRight,
  Search,
  Bell,
  Menu,
  X,
  Check,
  Plus,
  Download,
  Clock,
  CalendarDays,
  ChevronDown,
  FileText,
  Layers,
  LogOut,
  ExternalLink,
  LoaderCircle,
  Upload,
  Lock,
  Terminal,
  GitBranch,
  Box,
  Cloud,
  CheckCircle2,
} from "lucide-react";
import "./styles.css";

const icons = {
  dashboard: LayoutDashboard,
  live: Video,
  recording: Play,
  resources: Library,
  lab: FlaskConical,
  tests: ClipboardCheck,
  progress: ChartNoAxesCombined,
  fees: Wallet,
  tickets: MessageCircle,
  sop: BookOpen,
  admin: Settings,
  overview: LayoutDashboard,
  curriculum: BookOpen,
  classroom: Video,
  assessments: ClipboardCheck,
  people: Layers,
  support: MessageCircle,
};

const nav = [
  ["dashboard", "Overview"],
  ["live", "Live sessions"],
  ["recording", "Recordings"],
  ["resources", "Learning library"],
  ["lab", "Practice labs"],
  ["tests", "Assessments"],
  ["progress", "My progress"],
  ["fees", "Course & fees"],
  ["tickets", "Queries & concerns"],
  ["sop", "Bootcamp guide"],
];

const ADMIN_WORKSPACES = [
  {
    id: "overview",
    label: "Overview",
    defaultTab: "overview",
    tabs: ["overview"],
  },
  {
    id: "curriculum",
    label: "Curriculum & Batches",
    defaultTab: "batches",
    tabs: ["batches", "settings", "courses"],
  },
  {
    id: "classroom",
    label: "Classroom & Content",
    defaultTab: "automation",
    tabs: ["automation", "content", "schedule"],
  },
  {
    id: "assessments",
    label: "Assessments & Labs",
    defaultTab: "engine",
    tabs: ["engine", "tests", "reports", "submissions"],
  },
  {
    id: "people",
    label: "Students & Team",
    defaultTab: "users",
    tabs: ["users", "invitations", "access", "payments"],
  },
  {
    id: "support",
    label: "Queries & Activity",
    defaultTab: "tickets",
    tabs: ["tickets", "audit"],
  },
];

const kindName = {
  live: "Live session",
  recording: "Recording",
  notes: "Notes",
  lab: "Practice lab",
  slides: "Presentation",
  guide: "Resource Creation Guide",
  image: "Image / Diagram",
  sop: "Bootcamp guide",
  test_link: "External assessment",
};

const isStaffRole = (role) => role === "admin" || role === "trainer";

async function api(path, body) {
  const r = await fetch(
    "/api/" + path,
    body instanceof FormData
      ? { method: "POST", body }
      : body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {},
  );
  const d = await r.json();
  if (!r.ok) {
    const e = new Error(d.error || "Something went wrong.");
    e.status = r.status;
    throw e;
  }
  return d;
}

const date = (s) =>
  s
    ? new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(s))
    : "Not scheduled";

const money = (n, c = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: c,
    maximumFractionDigits: 0,
  }).format((n || 0) / 100);

function Badge({ children, tone = "" }) {
  return <span className={"badge " + tone}>{children}</span>;
}

function Empty({ title, body, action }) {
  return (
    <div className="empty">
      <div className="empty-mark">
        <Layers size={28} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

function Button({ children, onClick, secondary = false, ...props }) {
  return (
    <button
      className={secondary ? "button secondary" : "button"}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
}

function isAnswered(val) {
  if (val === null || val === undefined || val === "") return false;
  if (Array.isArray(val)) return val.length > 0 && val.every((x) => x !== -1);
  return true;
}

function App() {
  const [adminTab, setAdminTab] = useState("overview");
  const [boot, setBoot] = useState(null),
    [data, setData] = useState(null),
    [page, setPage] = useState("dashboard"),
    [batchId, setBatchId] = useState(""),
    [adminMode, setAdminMode] = useState(false),
    [adminData, setAdminData] = useState(null),
    [mobile, setMobile] = useState(false),
    [modal, setModal] = useState(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [onboarding, setOnboarding] = useState(false),
    [install, setInstall] = useState(null);
  const noticeTimer = useRef();
  const firstLogin = useRef(true);
  const [loginRequired, setLoginRequired] = useState(false);
  const batch = boot?.batches.find((b) => b.id === batchId),
    course = boot?.courses.find((c) => c.id === batch?.course_id),
    syllabus = course ? JSON.parse(course.syllabus) : [];

  function toast(s) {
    setNotice(s);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4500);
  }

  async function init() {
    try {
      const b = await api("bootstrap");
      setBoot(b);
      setLoginRequired(false);
      if (firstLogin.current) {
        setAdminMode(isStaffRole(b.user.role));
        firstLogin.current = false;
      }
      setBatchId((old) =>
        b.batches.some((v) => v.id === old) ? old : b.batches[0]?.id || "",
      );
      setOnboarding(!b.user.onboarded);
      setError("");
    } catch (e) {
      setError(e.message);
      if (e.status === 401) setLoginRequired(true);
    }
  }

  async function refresh() {
    if (batchId)
      setData(await api("campus?batch=" + encodeURIComponent(batchId)));
    if (adminMode) setAdminData(await api("admin/data"));
  }

  useEffect(() => {
    init();
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    const fn = (e) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener("beforeinstallprompt", fn);
    return () => window.removeEventListener("beforeinstallprompt", fn);
  }, []);

  useEffect(() => {
    let active = true;
    if (batchId) {
      setData(null);
      api("campus?batch=" + encodeURIComponent(batchId))
        .then((d) => {
          if (active) setData(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [batchId]);

  useEffect(() => {
    if (adminMode)
      api("admin/data")
        .then(setAdminData)
        .catch((e) => toast(e.message));
  }, [adminMode]);

  async function act(fn, msg) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (msg) toast(msg);
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function navigate(p) {
    setPage(p);
    setMobile(false);
    setSearch("");
  }

  function download(name, content, type = "text/plain") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function openResource(c) {
    setModal({ type: "resource", item: c });
  }

  const done = new Set(data?.completions.map((c) => c.content_id) || []),
    trackable =
      data?.content.filter((c) =>
        ["notes", "slides", "recording", "guide", "lab", "image"].includes(
          c.kind,
        ),
      ) || [],
    completed = trackable.filter((c) => done.has(c.id)).length,
    percent = trackable.length
      ? Math.round((completed / trackable.length) * 100)
      : 0;
  const sessions =
      data?.content
        .filter((c) => c.kind === "live")
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)) || [],
    upcoming = sessions.filter(
      (s) =>
        s.session_status !== "cancelled" &&
        new Date(s.starts_at).getTime() + s.duration * 60000 > Date.now(),
    ),
    tests = data?.tests || [],
    results =
      data?.attempts.filter(
        (a) =>
          a.submitted && (!a.grading_status || a.grading_status === "complete"),
      ) || [],
    average = results.length
      ? Math.round(
          results.reduce((s, a) => s + (a.score / a.total) * 100, 0) /
            results.length,
        )
      : 0;

  if (loginRequired)
    return (
      <Login
        onLogin={() => {
          firstLogin.current = true;
          init();
        }}
      />
    );

  if (!boot)
    return (
      <div className="loading-page">
        <div className="brand-text">
          ARKS<span>GLOBAL ASIA INSTITUTES</span>
        </div>
        {error ? (
          <>
            <p>{error}</p>
            <button
              className="button"
              onClick={() => setLoginRequired(true)}
            >
              Sign in to your campus
            </button>
            <button onClick={init}>Retry</button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>Opening your campus…</p>
          </>
        )}
      </div>
    );

  const activeWorkspace =
    ADMIN_WORKSPACES.find((w) => w.tabs.includes(adminTab)) ||
    ADMIN_WORKSPACES[0];

  function ResourceCard({ c }) {
    if (c.kind === "recording")
      return (
        <article className="resource-card recording">
          <div className="resource-art">
            <span className="resource-type">Recording</span>
            <div className="art-symbol">
              <Play />
            </div>
            <span className="art-label">ARKS / LEARN</span>
          </div>
          <div className="resource-body">
            <small>{c.topic}</small>
            <h3>{c.title}</h3>
            <p className="card-brief">
              {c.body || "Revisit this class at your own pace."}
            </p>
            <div className="row gap wrap">
              {c.url ? (
                <a
                  className="button"
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Play size={15} /> Play recording
                </a>
              ) : (
                <span>Recording link pending</span>
              )}
              <button className="text-btn" onClick={() => openResource(c)}>
                {done.has(c.id)
                  ? "Completed · details"
                  : "Details & completion"}
              </button>
            </div>
          </div>
        </article>
      );
    return (
      <button
        className={"resource-card " + c.kind}
        onClick={() => openResource(c)}
      >
        <div className="resource-art">
          <span className="resource-type">
            {kindName[c.kind] || c.kind}
          </span>
          <div className="art-symbol">
            {c.kind === "slides" ? (
              <Layers />
            ) : c.kind === "recording" ? (
              <Play />
            ) : c.kind === "lab" ? (
              <Terminal />
            ) : (
              <FileText />
            )}
          </div>
          <span className="art-label">ARKS / LEARN</span>
        </div>
        <div className="resource-body">
          <small>{c.topic}</small>
          <h3>{c.title}</h3>
          <div className="row between">
            <span>
              {c.kind === "lab"
                ? "Hands-on practice"
                : c.kind === "image"
                  ? "View diagram"
                  : "Open resource"}{" "}
              <ArrowUpRight size={13} />
            </span>
            {done.has(c.id) && <CheckCircle2 size={17} className="green" />}
          </div>
        </div>
      </button>
    );
  }

  function SessionCard({ s }) {
    const live =
      Date.now() >= new Date(s.starts_at).getTime() &&
      Date.now() < new Date(s.starts_at).getTime() + s.duration * 60000;
    return (
      <div className="session-row">
        <div className="date-tile">
          <span>
            {s.starts_at
              ? new Date(s.starts_at).toLocaleDateString("en", {
                  month: "short",
                })
              : "TBD"}
          </span>
          <b>{s.starts_at ? new Date(s.starts_at).getDate() : "—"}</b>
        </div>
        <div className="grow">
          <Badge tone={live ? "green" : ""}>
            {s.session_status === "cancelled"
              ? "Cancelled"
              : s.session_status === "completed"
                ? "Completed"
                : live
                  ? "Happening now"
                  : s.topic}
          </Badge>
          <h3>{s.title}</h3>
          <p>
            {s.starts_at
              ? new Date(s.starts_at).toLocaleTimeString("en", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: batch.timezone,
                }) +
                " · " +
                batch.timezone
              : "Schedule to be announced"}{" "}
            · {s.duration} min
          </p>
        </div>
        {s.session_status === "cancelled" ? (
          <Badge>Class cancelled</Badge>
        ) : s.url ? (
          <a
            className="button secondary"
            href={s.url}
            target="_blank"
            rel="noreferrer"
          >
            Join session <ArrowUpRight size={15} />
          </a>
        ) : (
          <Badge>Link pending</Badge>
        )}
        <button
          className="icon-btn"
          disabled={s.session_status === "cancelled"}
          aria-label="Download calendar event"
          onClick={() => {
            const fmt = (s) =>
              new Date(s).toISOString().replace(/[-:]/g, "").split(".")[0] +
              "Z";
            if (!s.starts_at)
              return toast("This session is not scheduled yet.");
            download(
              "arks-session.ics",
              `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ARKS//Campus//EN\r\nBEGIN:VEVENT\r\nUID:${s.id}@arks\r\nDTSTAMP:${fmt(new Date())}\r\nDTSTART:${fmt(s.starts_at)}\r\nDTEND:${fmt(new Date(new Date(s.starts_at).getTime() + s.duration * 60000))}\r\nSUMMARY:${s.title.replace(/[\r\n,;]/g, " ")}\r\nURL:${s.url}\r\nEND:VEVENT\r\nEND:VCALENDAR`,
              "text/calendar",
            );
          }}
        >
          <CalendarDays size={18} />
        </button>
      </div>
    );
  }

  function TestCards({ list = tests }) {
    return (
      <div className="test-grid">
        {list.map((t) => {
          const r = data.attempts.filter(
            (a) => a.test_id === t.id && a.submitted,
          );
          return (
            <div className="panel test-card" key={t.id}>
              <div className="row between">
                <Badge
                  tone={
                    t.kind === "daily"
                      ? "green"
                      : t.kind === "weekly"
                        ? "blue"
                        : "purple"
                  }
                >
                  {t.kind} test
                </Badge>
                {t.locked ? <Lock size={17} /> : <ClipboardCheck size={19} />}
              </div>
              <h3>{t.title}</h3>
              <p>{t.duration} minutes · 100 marks · One attempt</p>
              <div className="test-bottom">
                {r.length > 0 ? (
                  <button
                    className="text-btn"
                    onClick={() => viewResult(r[0].id)}
                  >
                    {r[0].grading_status !== "complete"
                      ? "Grading / feedback pending"
                      : Math.round((r[0].score / r[0].total) * 100) + "%"}{" "}
                    ↗
                  </button>
                ) : (
                  <span className="muted">
                    {t.locked ? "Available after class" : "Ready when you are"}
                  </span>
                )}
                <Button
                  secondary
                  disabled={t.locked || busy || r.length >= 1}
                  onClick={() =>
                    act(async () =>
                      setModal({
                        type: "quiz",
                        test: await api("tests/start", {
                          test_id: t.id,
                          batch_id: batchId,
                        }),
                      }),
                    )
                  }
                >
                  {t.locked
                    ? "Locked"
                    : r.length
                      ? "Submitted"
                      : data.attempts.some(
                            (a) => a.test_id === t.id && !a.submitted,
                          )
                        ? "Resume test"
                        : "Start test"}{" "}
                  <ArrowRight size={15} />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  async function viewResult(id) {
    await act(async () =>
      setModal({ type: "result", result: await api("results/" + id) }),
    );
  }

  function Report() {
    const body = [
      `Arks Global Asia Institutes — Completion Report`,
      `Student: ${boot.user.name}`,
      `Course: ${course?.title}`,
      `Batch: ${batch?.name}`,
      `Generated: ${new Date().toISOString()}`,
      `Resources completed: ${completed}/${trackable.length} (${percent}%)`,
      `Tests submitted: ${results.length}`,
      `Average test score: ${average}%`,
      "",
      ...trackable.map(
        (c) => `${done.has(c.id) ? "Completed" : "Pending"} | ${c.title}`,
      ),
      "",
      ...results.map(
        (a) =>
          `${tests.find((t) => t.id === a.test_id)?.title || "Assessment"} | ${a.score}/${a.total} | ${date(a.submitted)}`,
      ),
    ].join("\n");
    download("arks-completion-report.txt", body);
  }

  function Overview() {
    const next = trackable.find((c) => !done.has(c.id));
    return (
      <>
        <div className="welcome">
          <div>
            <div className="eyebrow">YOUR LEARNING SPACE</div>
            <h1>
              Welcome back, {boot.user.name.split(" ")[0]}
              <span className="welcome-dot">.</span>
            </h1>
            <p>A little progress, every day. Let’s build what’s next.</p>
          </div>
          <span className="today">
            <CalendarDays size={16} />
            {date(new Date())}
          </span>
        </div>
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-label">
              <span className="live-dot" /> YOUR NEXT CHAPTER STARTS HERE
            </div>
            <h2>
              Learn it. Build it.
              <br />
              <span>Make it happen.</span>
            </h2>
            <p>
              Your DevOps journey, all in one place.
              <br />
              Turn today’s learning into tomorrow’s possibilities.
            </p>
            <Button
              onClick={() =>
                next ? openResource(next) : navigate("resources")
              }
            >
              Continue learning <ArrowRight size={17} />
            </Button>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="orb orb-one" />
            <div className="orb orb-two" />
            <div className="orbit-ring" />
            <div className="pipeline-card card-code">
              <div className="tiny-dots">
                <i />
                <i />
                <i />
              </div>
              <span>
                <b>~/</b> your-next-chapter
              </span>
              <code>
                <em>$</em> git commit -m
                <br /> <strong>"keep growing"</strong>
                <br />
                <span className="code-success">✓ progress saved</span>
              </code>
            </div>
            <div className="float-pill">
              <span className="pill-check">
                <Check size={14} />
              </span>{" "}
              Build successful
            </div>
            <div className="pipeline-node node-git">
              <GitBranch size={23} />
            </div>
            <div className="pipeline-node node-box">
              <Box size={25} />
            </div>
            <div className="pipeline-node node-cloud">
              <Cloud size={25} />
            </div>
            <div className="hero-caption">COMMIT TO YOUR FUTURE</div>
          </div>
        </section>
        <section className="stats">
          <div className="stat">
            <span>
              Course completion{" "}
              <span className="stat-icon blue">
                <ChartNoAxesCombined size={17} />
              </span>
            </span>
            <div>
              <b>
                {percent}
                <small>%</small>
              </b>
              <span>
                {completed} of {trackable.length} resources
              </span>
            </div>
            <div className="progress-track">
              <i style={{ width: percent + "%" }} />
            </div>
          </div>
          <div className="stat">
            <span>
              Practice labs{" "}
              <span className="stat-icon purple">
                <FlaskConical size={17} />
              </span>
            </span>
            <div>
              <b>
                {
                  data.content.filter((c) => c.kind === "lab" && done.has(c.id))
                    .length
                }
                <small>
                  {" "}
                  / {data.content.filter((c) => c.kind === "lab").length}
                </small>
              </b>
              <span>Accepted submissions</span>
            </div>
            <small className="stat-note">Build confidence with practice</small>
          </div>
          <div className="stat">
            <span>
              Assessment average{" "}
              <span className="stat-icon green">
                <ClipboardCheck size={17} />
              </span>
            </span>
            <div>
              <b>
                {results.length ? average : "—"}
                <small>{results.length ? "%" : ""}</small>
              </b>
              <span>{results.length} tests completed</span>
            </div>
            <small className="stat-note">Your knowledge, put to work</small>
          </div>
          <div className="stat">
            <span>
              Topics covered{" "}
              <span className="stat-icon amber">
                <BookOpen size={17} />
              </span>
            </span>
            <div>
              <b>
                {Math.min(batch.covered, syllabus.length)}
                <small> / {syllabus.length}</small>
              </b>
              <span>In your classroom</span>
            </div>
            <small className="stat-note">One step closer to your goals</small>
          </div>
        </section>
        <div className="dashboard-grid">
          <section className="panel course-panel">
            <div className="section-heading">
              <h2>Your learning journey</h2>
              <button onClick={() => navigate("progress")} className="text-btn">
                View roadmap <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="row gap">
              <div className="course-icon">
                <Terminal size={26} />
              </div>
              <div>
                <Badge tone="blue">ENROLLED COURSE</Badge>
                <h3>{course.title}</h3>
                <p>{batch.name}</p>
              </div>
            </div>
            <div className="course-progress">
              <span>Keep moving forward</span>
              <b>{percent}% complete</b>
            </div>
            <div className="progress-track">
              <i style={{ width: percent + "%" }} />
            </div>
            <div className="journey-steps">
              {syllabus.slice(0, 4).map((s, i) => (
                <div
                  key={s.title}
                  className={i < batch.covered ? "covered" : ""}
                >
                  <span>
                    {i < batch.covered ? (
                      <Check size={13} />
                    ) : (
                      String(i + 1).padStart(2, "0")
                    )}
                  </span>
                  <small>{s.title}</small>
                </div>
              ))}
            </div>
            <div className="course-footer">
              <span>
                <span className="small-dot" /> {syllabus.length} topics ·
                Hands-on learning
              </span>
              <button
                className="text-btn"
                onClick={() => navigate("resources")}
              >
                Explore course <ArrowRight size={15} />
              </button>
            </div>
          </section>
          <section className="panel next-session">
            <div className="section-heading">
              <h2>Up next</h2>
              <Badge tone="green">LIVE CLASSROOM</Badge>
            </div>
            {upcoming.length ? (
              <>
                <div className="session-illustration">
                  <Video size={32} />
                  <span>See you in class.</span>
                </div>
                <h3>{upcoming[0].title}</h3>
                <p>
                  {date(upcoming[0].starts_at)} · {upcoming[0].duration} min
                </p>
                <Button secondary onClick={() => navigate("live")}>
                  View session <ArrowRight size={15} />
                </Button>
              </>
            ) : (
              <>
                <div className="session-illustration">
                  <Video size={32} />
                  <span>Great things are ahead.</span>
                </div>
                <h3>Your next class is on its way</h3>
                <p>
                  New sessions will appear here as soon as your instructor
                  schedules them.
                </p>
                <button className="text-btn" onClick={() => navigate("live")}>
                  View classroom <ArrowRight size={15} />
                </button>
              </>
            )}
          </section>
        </div>
        <div className="section-heading">
          <div>
            <h2>Pick up something new</h2>
            <p>Your notes, presentations, diagrams and guides, together.</p>
          </div>
          <button className="text-btn" onClick={() => navigate("resources")}>
            Browse library <ArrowRight size={15} />
          </button>
        </div>
        <div className="resource-grid">
          {data.content
            .filter((c) =>
              ["notes", "slides", "guide", "image"].includes(c.kind),
            )
            .slice(0, 3)
            .map((c) => (
              <ResourceCard key={c.id} c={c} />
            ))}
        </div>
        <div className="bottom-note">
          <span className="small-dot" /> A space to learn. The confidence to
          build.
        </div>
      </>
    );
  }

  function Resources({ kind }) {
    const [filter, setFilter] = useState("all");
    const kinds = kind ? [kind] : ["notes", "slides", "guide", "image"];
    const items = data.content.filter(
      (c) =>
        kinds.includes(c.kind) &&
        (filter === "all" || c.kind === filter) &&
        (!search ||
          (c.title + " " + c.topic + " " + c.body)
            .toLowerCase()
            .includes(search.toLowerCase())),
    );
    return (
      <>
        <PageHeading
          title={
            kind === "recording"
              ? "Your classroom, on replay"
              : kind === "lab"
                ? "Learn by doing"
                : "A library for your next breakthrough"
          }
          subtitle={
            kind === "lab"
              ? "Turn concepts into practical skills. Submit your work and get feedback."
              : kind === "recording"
                ? "Revisit a concept, catch up on a class, or learn at your own pace."
                : "Class notes, presentations, resource creation guides and architecture diagrams."
          }
        />
        <div className="filter-bar">
          {!kind &&
            ["all", ...kinds].map((k) => (
              <button
                key={k}
                className={filter === k ? "active" : ""}
                onClick={() => setFilter(k)}
              >
                {k === "all" ? "All resources" : kindName[k]}
              </button>
            ))}
          <span className="muted">
            {items.length} {items.length === 1 ? "resource" : "resources"}
          </span>
        </div>
        {items.length ? (
          <div className="resource-grid">
            {items.map((c) => (
              <ResourceCard key={c.id} c={c} />
            ))}
          </div>
        ) : (
          <Empty
            title={
              kind === "recording"
                ? "The replay library is ready for your classes"
                : "No resources here yet"
            }
            body={
              kind === "recording"
                ? "Your instructor can add a recording link after each live session."
                : "Published course materials will appear here."
            }
          />
        )}
      </>
    );
  }

  function PageHeading({ title, subtitle, action }) {
    return (
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {adminMode ? "CAMPUS MANAGEMENT" : "ARKS CAMPUS"}
          </div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {action}
      </div>
    );
  }

  function Progress() {
    return (
      <>
        <PageHeading
          title="Look how far you can go."
          subtitle="A clear picture of your learning, practice and results."
          action={
            <Button secondary onClick={Report}>
              <Download size={16} /> Download report
            </Button>
          }
        />
        <div className="progress-overview panel">
          <div
            className="progress-ring"
            style={{ "--progress": percent * 3.6 + "deg" }}
          >
            <div>
              <b>{percent}%</b>
              <span>complete</span>
            </div>
          </div>
          <div>
            <h2>{course.title}</h2>
            <p>
              {completed} of {trackable.length} resources completed ·{" "}
              {results.length} assessments submitted
            </p>
            <Badge tone="green">{batch.name}</Badge>
          </div>
        </div>
        <div className="two-col">
          <Roadmap batch={batch} course={course} data={data} />
          <section className="panel">
            <h2>Assessment results</h2>
            {results.length ? (
              results.map((a) => (
                <button
                  className="result-row"
                  key={a.id}
                  onClick={() => viewResult(a.id)}
                >
                  <div>
                    <h3>
                      {tests.find((t) => t.id === a.test_id)?.title ||
                        "Assessment"}
                    </h3>
                    <small>{date(a.submitted)}</small>
                  </div>
                  <b>
                    {Math.round((a.score / a.total) * 100)}%{" "}
                    <ChevronRight size={16} />
                  </b>
                </button>
              ))
            ) : (
              <Empty
                title="Your first milestone awaits"
                body="Complete an assessment to see your results here."
                action={
                  <Button secondary onClick={() => navigate("tests")}>
                    Explore assessments
                  </Button>
                }
              />
            )}
          </section>
        </div>
      </>
    );
  }

  function Fees() {
    const paid = data.payments.reduce((s, p) => s + p.amount, 0),
      total = data.enrollment?.fee || 0;
    return (
      <>
        <PageHeading
          title="Your course, at a glance"
          subtitle="Enrollment details and a transparent record of your fees."
        />
        <div className="two-col">
          <section className="panel">
            <Badge tone="blue">YOUR ENROLLMENT</Badge>
            <h2>{course.title}</h2>
            <p>{course.description}</p>
            <dl>
              <dt>Batch</dt>
              <dd>{batch.name}</dd>
              <dt>Duration</dt>
              <dd>
                {date(batch.start_date)} — {date(batch.end_date)}
              </dd>
              <dt>Timezone</dt>
              <dd>{batch.timezone}</dd>
              <dt>Status</dt>
              <dd>
                <Badge tone="green">{batch.status}</Badge>
              </dd>
            </dl>
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>Fee summary</h2>
              <Badge tone="green">
                {total - paid > 0 ? "In progress" : "Up to date"}
              </Badge>
            </div>
            <div className="fee-total">
              {money(paid, course.currency)}{" "}
              <small>paid of {money(total, course.currency)}</small>
            </div>
            <div className="progress-track">
              <i
                style={{ width: (total ? (paid / total) * 100 : 100) + "%" }}
              />
            </div>
            <dl>
              <dt>Total course fee</dt>
              <dd>{money(total, course.currency)}</dd>
              <dt>Amount paid</dt>
              <dd className="green">{money(paid, course.currency)}</dd>
              <dt>Remaining balance</dt>
              <dd>{money(total - paid, course.currency)}</dd>
            </dl>
            <p className="help-note">
              Payments are recorded by your administrator. Contact support to
              confirm a payment or ask about your balance.
            </p>
            <button className="text-btn" onClick={() => navigate("tickets")}>
              Ask about fees <ArrowUpRight size={14} />
            </button>
          </section>
        </div>
      </>
    );
  }

  function Tickets() {
    const [replyBody, setReplyBody] = useState({});
    return (
      <>
        <PageHeading
          title="You don’t have to figure it out alone."
          subtitle="Ask a question, share a concern, or get help with your learning."
          action={
            <Button onClick={() => setModal({ type: "ticket" })}>
              <Plus size={16} /> New query
            </Button>
          }
        />
        <SupportLinks batch={batch} />
        {data.tickets.length ? (
          data.tickets.map((t) => {
            let thread = [];
            try {
              thread = JSON.parse(t.messages || "[]");
            } catch {}
            return (
              <section className="panel ticket-card" key={t.id}>
                <div className="row between">
                  <div className="row gap">
                    <Badge tone={t.status === "resolved" ? "green" : "amber"}>
                      {t.status}
                    </Badge>
                    {t.category && <Badge tone="blue">{t.category}</Badge>}
                  </div>
                  <small>{date(t.created)}</small>
                </div>
                <h2>{t.subject}</h2>
                {thread.length > 0 ? (
                  <div className="ticket-thread">
                    {thread.map((m) => (
                      <div
                        key={m.id || m.created}
                        className={
                          isStaffRole(m.role) ? "reply" : "ticket-message"
                        }
                      >
                        <b>
                          {isStaffRole(m.role)
                            ? `${m.author_name || "Instructor"} (${m.role})`
                            : m.author_name || "You"}{" "}
                          · <small>{date(m.created)}</small>
                        </b>
                        <p className="prewrap">{m.body}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <p className="prewrap">{t.body}</p>
                    {t.reply && (
                      <div className="reply">
                        <b>From your support team</b>
                        <p className="prewrap">{t.reply}</p>
                      </div>
                    )}
                  </>
                )}
                <form
                  className="row gap"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const msg = (replyBody[t.id] || "").trim();
                    if (!msg) return;
                    act(async () => {
                      await api("tickets", {
                        ticket_id: t.id,
                        body: msg,
                      });
                      setReplyBody({ ...replyBody, [t.id]: "" });
                    }, "Follow-up message sent.");
                  }}
                >
                  <input
                    value={replyBody[t.id] || ""}
                    onChange={(e) =>
                      setReplyBody({ ...replyBody, [t.id]: e.target.value })
                    }
                    placeholder="Add a follow-up message…"
                  />
                  <Button secondary type="submit" disabled={busy}>
                    Reply
                  </Button>
                </form>
              </section>
            );
          })
        ) : (
          <Empty
            title="A little help goes a long way"
            body="Your questions and replies from the team will stay together here."
            action={
              <Button onClick={() => setModal({ type: "ticket" })}>
                Start a conversation <ArrowRight size={16} />
              </Button>
            }
          />
        )}
      </>
    );
  }

  function Content() {
    if (adminMode) return <Admin />;
    if (!batchId)
      return (
        <Empty
          title="Your campus account is ready"
          body="Your administrator needs to enroll your sign-in email in a batch. Once enrolled, refresh to start learning."
          action={<Button onClick={init}>Check enrollment</Button>}
        />
      );
    if (!data)
      return (
        <div className="loading">
          <LoaderCircle className="spin" /> Loading your learning space…
        </div>
      );
    if (search)
      return (
        <>
          <PageHeading
            title={`Search results for “${search}”`}
            subtitle="Search across your current batch’s learning materials."
          />
          <div className="resource-grid">
            {data.content
              .filter((c) =>
                (c.title + " " + c.topic + " " + c.body)
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((c) => (
                <ResourceCard key={c.id} c={c} />
              ))}
          </div>
          {!data.content.some((c) =>
            (c.title + " " + c.topic + " " + c.body)
              .toLowerCase()
              .includes(search.toLowerCase()),
          ) && (
            <Empty
              title="No matching resources"
              body="Try a topic such as Git or DevOps."
            />
          )}
        </>
      );
    switch (page) {
      case "dashboard":
        return <Overview />;
      case "resources":
        return <Resources />;
      case "recording":
        return <Resources kind="recording" />;
      case "lab":
        return <Resources kind="lab" />;
      case "live":
        return (
          <>
            <PageHeading
              title="A seat in your live classroom"
              subtitle="Learn together, ask questions and build with your instructor."
            />
            {sessions.length ? (
              <section className="panel">
                {sessions.map((s) => (
                  <SessionCard key={s.id} s={s} />
                ))}
              </section>
            ) : (
              <Empty
                title="Your classroom is getting ready"
                body="Your instructor will publish session times and meeting links here."
              />
            )}
          </>
        );
      case "tests":
        return (
          <>
            <PageHeading
              title="Small checks. Lasting knowledge."
              subtitle="Daily (9:00 AM IST Mon–Sat), Sunday Weekly and Monthly assessments based on your approved classes."
            />
            <div className="info-strip">
              <ClipboardCheck size={20} />
              <span>
                Each test is worth 100 marks. You have one attempt; resume it
                before the timer expires. Review your DeepSeek diagnostic
                strengths, areas for improvement, and official docs links
                afterwards.
              </span>
            </div>
            <Assessments
              tests={tests}
              attempts={data.attempts}
              render={(list) => <TestCards list={list} />}
            />
            {data.content.some((c) => c.kind === "test_link") && (
              <>
                <h2 className="spaced">Class assessments</h2>
                <div className="test-grid">
                  {data.content
                    .filter((c) => c.kind === "test_link")
                    .map((c) => (
                      <section className="panel" key={c.id}>
                        <Badge tone="blue">Google Forms assessment</Badge>
                        <h3 className="spaced">{c.title}</h3>
                        <p>
                          {c.body ||
                            "Complete the assessment shared by your instructor."}
                        </p>
                        {c.topic_order > batch.covered ? (
                          <Badge>Available after topic {c.topic_order}</Badge>
                        ) : (
                          <a
                            className="button"
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open assessment <ArrowUpRight size={15} />
                          </a>
                        )}
                      </section>
                    ))}
                </div>
              </>
            )}
          </>
        );
      case "progress":
        return <Progress />;
      case "fees":
        return <Fees />;
      case "tickets":
        return <Tickets />;
      case "sop":
        return (
          <>
            <PageHeading
              title="A clear path from day one"
              subtitle="Your course scope, expectations and the way we learn together."
            />
            <section className="panel prose">
              <h2>{course.title}</h2>
              <p className="prewrap">
                {JSON.parse(batch.config || "{}").overview ||
                  course.description}
              </p>
              <Roadmap batch={batch} course={course} data={data} />
            </section>
            {data.content
              .filter((c) => c.kind === "sop")
              .map((c) => (
                <section className="panel prose" key={c.id}>
                  <h2>{c.title}</h2>
                  <p className="prewrap">{c.body}</p>
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noreferrer">
                      Open full guide ↗
                    </a>
                  )}
                  {c.file_id && (
                    <a href={"/api/files/" + c.file_id}>Download document</a>
                  )}
                </section>
              ))}
          </>
        );
      default:
        return <Overview />;
    }
  }

  function Admin() {
    const [reportTestId, setReportTestId] = useState("all");
    const [userBatchFilter, setUserBatchFilter] = useState("all");
    if (!adminData)
      return (
        <div className="loading">
          <LoaderCircle className="spin" /> Opening administration…
        </div>
      );
    const a = adminData;
    const isHeadAdmin = boot.user.role === "admin";
    const allTabs = [
      ["overview", "Overview"],
      ["batches", "Batches"],
      ["settings", "Batch experience"],
      ...(isHeadAdmin ? [["courses", "Courses"]] : []),
      ["automation", "Drive Sync & Inbox"],
      ["content", "Published Library"],
      ["schedule", "Live Sessions & Recordings"],
      ["engine", "AI Studio & 9 AM Schedule"],
      ["tests", "Assessments"],
      ["reports", "Results & Grading"],
      ["submissions", "Lab Reviews"],
      ["users", "Students & People"],
      ["invitations", "Batch Enrollments"],
      ["access", "Groups & Staff Access"],
      ...(isHeadAdmin ? [["payments", "Fees & Payments"]] : []),
      ["tickets", "Student Queries"],
      ["audit", "Activity Log"],
    ];
    const workspaceTabs = activeWorkspace.tabs
      .map((id) => allTabs.find(([tid]) => tid === id))
      .filter(Boolean);

    const labels = {
      batches: "Manage your batches",
      invitations: "Welcome your next cohort",
      content: "Your teaching toolkit",
      tests: "Build meaningful assessments",
      submissions: "Help every student grow",
      tickets: "Conversations that matter",
      payments: "Keep fees transparent",
      users: "Your learning community",
      courses: "Build a reusable curriculum",
      reports: "Assessment Results, Diagnostics & Grading Center",
      audit: "Campus activity",
    };

    function name(id) {
      return a.users.find((u) => u.id === id)?.name || id;
    }
    function title(id) {
      return a.content.find((c) => c.id === id)?.title || id;
    }
    function batchName(id) {
      return a.batches.find((b) => b.id === id)?.name || id;
    }
    function edit(entity, item) {
      setModal({ type: "editor", entity, item });
    }
    function removeEntity(entity, itemId, labelText) {
      act(
        () => api("admin/delete", { entity, id: itemId }),
        `Deleted ${labelText || entity}.`,
      );
    }

    function csv() {
      const rowsData = a.enrollments.map((e) => {
        const b = a.batches.find((b) => b.id === e.batch_id),
          c = a.courses.find((c) => c.id === b?.course_id);
        const resources = a.content.filter(
          (c) =>
            c.course_id === b?.course_id &&
            (!c.batch_id || c.batch_id === b.id) &&
            c.published &&
            ["notes", "slides", "guide", "recording", "lab", "image"].includes(
              c.kind,
            ),
        );
        const ids = new Set(resources.map((c) => c.id));
        const count = a.completions.filter(
          (c) =>
            c.user_id === e.user_id &&
            c.batch_id === e.batch_id &&
            ids.has(c.content_id),
        ).length;
        const paid = a.payments
          .filter((p) => p.enrollment_id === e.id)
          .reduce((s, p) => s + p.amount, 0);
        return [
          name(e.user_id),
          a.users.find((u) => u.id === e.user_id)?.email,
          batchName(e.batch_id),
          c?.currency,
          e.fee / 100,
          paid / 100,
          (e.fee - paid) / 100,
          resources.length,
          count,
          resources.length ? Math.round((count / resources.length) * 100) : 0,
        ];
      });
      const escape = (v) =>
        '"' +
        String(v ?? "")
          .replace(/^[=+@-]/, "'")
          .replace(/"/g, '""') +
        '"';
      download(
        "arks-enrollment-report.csv",
        [
          [
            "Student",
            "Email",
            "Batch",
            "Currency",
            "Fee",
            "Paid",
            "Balance",
            "Resources",
            "Completed",
            "Completion %",
          ],
          ...rowsData,
        ]
          .map((r) => r.map(escape).join(","))
          .join("\r\n"),
        "text/csv",
      );
    }

    const AdminSubNav = () => {
      if (workspaceTabs.length <= 1) return null;
      return (
        <div className="admin-tabs">
          {workspaceTabs.map(([id, label]) => (
            <button
              key={id}
              className={adminTab === id ? "active" : ""}
              onClick={() => setAdminTab(id)}
            >
              {label}
              {id === "submissions" &&
                a.submissions.some((s) => s.status === "submitted") && (
                  <span className="small-dot" />
                )}
            </button>
          ))}
        </div>
      );
    };

    if (["settings", "schedule", "engine", "access"].includes(adminTab))
      return (
        <>
          <AdminSubNav />
          <AdminTools
            key={adminTab}
            tab={adminTab}
            data={a}
            batchId={batchId}
            user={boot.user}
            refresh={async () => {
              await init();
              await refresh();
            }}
            edit={edit}
          />
        </>
      );

    if (adminTab === "automation")
      return (
        <>
          <AdminSubNav />
          <AutomationPanel
            batches={a.batches}
            onPublished={async () => {
              await refresh();
            }}
          />
        </>
      );

    const create = [
      ...(isHeadAdmin ? ["courses"] : []),
      "batches",
      "invitations",
      "content",
      "tests",
    ].includes(adminTab);

    return (
      <>
        <AdminSubNav />
        <PageHeading
          title={
            adminTab === "overview"
              ? "Make room for what’s next."
              : labels[adminTab]
          }
          subtitle={
            adminTab === "overview"
              ? "Your students, classes, Drive Sync Up and 9:00 AM IST assessments — thoughtfully connected."
              : "Manage your campus with changes saved across devices."
          }
          action={
            create ? (
              <Button onClick={() => edit(adminTab, null)}>
                <Plus size={16} />
                {adminTab === "invitations"
                  ? "Enroll by email"
                  : adminTab === "content"
                    ? "Add resource"
                    : adminTab === "tests"
                      ? "Create assessment"
                      : adminTab === "batches"
                        ? "Create batch"
                        : "Create course"}
              </Button>
            ) : adminTab === "users" ? (
              <div className="row gap wrap">
                <Button
                  onClick={() =>
                    edit(
                      "invitations",
                      userBatchFilter !== "all"
                        ? { batch_id: userBatchFilter }
                        : null,
                    )
                  }
                >
                  <Plus size={16} /> Add Student to Batch
                </Button>
                <Button secondary onClick={() => setAdminTab("access")}>
                  Bulk Add Students (CSV)
                </Button>
              </div>
            ) : adminTab === "payments" && isHeadAdmin ? (
              <Button onClick={() => setModal({ type: "payment" })}>
                <Plus size={16} /> Record payment
              </Button>
            ) : adminTab === "reports" ? (
              <Button onClick={csv}>
                <Download size={16} /> Export CSV
              </Button>
            ) : null
          }
        />
        {adminTab === "overview" ? (
          <>
            <div className="info-strip">
              <Layers size={20} />
              <span>
                <b>
                  {isHeadAdmin
                    ? "Head / Administrator Command Center"
                    : "Trainer / Instructor Workspace"}
                  .
                </b>{" "}
                Use the 6 workspaces on the left to sync Google Drive folders,
                approve daily materials in one click, manage 9:00 AM IST daily
                & Sunday weekly assessments, and mentor your cohorts.
              </span>
            </div>
            <div className="stats admin-stats">
              {[
                [
                  "Enrolled students",
                  new Set(a.enrollments.map((e) => e.user_id)).size,
                ],
                [
                  "Active batches",
                  a.batches.filter((b) => b.status === "active").length,
                ],
                [
                  "Labs to review",
                  a.submissions.filter((s) => s.status === "submitted").length,
                ],
                [
                  "Open queries",
                  a.tickets.filter((t) => t.status === "open").length,
                ],
              ].map(([label, value]) => (
                <div className="stat" key={label}>
                  <span>{label}</span>
                  <b>{value}</b>
                </div>
              ))}
            </div>
            <div className="two-col">
              <section className="panel">
                <h2>Daily Teaching & Operations Workflow</h2>
                {[
                  [
                    "01",
                    "Drive Sync Up & 1-Click Day Approval",
                    "Sync class notes, PPTs, images, guides and recordings from Drive.",
                    "automation",
                  ],
                  [
                    "02",
                    "9:00 AM IST Daily & Sunday Weekly Tests",
                    "Manage 20+ question daily tests and 25+ question Sunday weekly tests.",
                    "engine",
                  ],
                  [
                    "03",
                    "Results, Diagnostics & Retakes",
                    "Inspect DeepSeek student reports, override grades, or grant retakes.",
                    "reports",
                  ],
                  [
                    "04",
                    "Onboard Students (Single or Bulk CSV)",
                    "Invite students by email or bulk CSV upload.",
                    "access",
                  ],
                ].map(([num, title, body, tab]) => (
                  <button
                    className="admin-step"
                    key={num}
                    onClick={() => setAdminTab(tab)}
                  >
                    <span>{num}</span>
                    <div>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </div>
                    <ArrowRight size={18} />
                  </button>
                ))}
              </section>
              <section className="panel">
                <h2>Batch directory & topic release</h2>
                {a.batches.map((b) => (
                  <div className="result-row" key={b.id}>
                    <div onClick={() => edit("batches", b)}>
                      <h3>{b.name}</h3>
                      <p>
                        {a.courses.find((c) => c.id === b.course_id)?.title} ·{" "}
                        <b>Topic {b.covered} covered</b>
                      </p>
                    </div>
                    <div className="row gap">
                      <button
                        className="text-btn"
                        title="Advance covered topic"
                        onClick={() =>
                          act(
                            () =>
                              api("admin/save", {
                                entity: "batches",
                                values: { ...b, covered: b.covered + 1 },
                              }),
                            `Advanced ${b.name} to Topic ${b.covered + 1}.`,
                          )
                        }
                      >
                        +1 Topic
                      </button>
                      <Badge tone={b.status === "active" ? "green" : ""}>
                        {b.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </>
        ) : adminTab === "reports" ? (
          (() => {
            const submittedAttempts = a.attempts.filter(
              (t) =>
                t.submitted &&
                (reportTestId === "all" || t.test_id === reportTestId),
            );
            const avgScore = submittedAttempts.length
              ? Math.round(
                  submittedAttempts.reduce(
                    (s, x) => s + (x.score / (x.total || 100)) * 100,
                    0,
                  ) / submittedAttempts.length,
                )
              : 0;
            const passCount = submittedAttempts.filter(
              (x) => (x.score / (x.total || 100)) * 100 >= 70,
            ).length;
            const selectedTest = a.tests.find((x) => x.id === reportTestId);
            const attempterIds = new Set(
              submittedAttempts.map((x) => x.user_id),
            );
            const nonAttempters = selectedTest
              ? a.enrollments
                  .filter(
                    (e) =>
                      (!selectedTest.batch_id ||
                        e.batch_id === selectedTest.batch_id) &&
                      !attempterIds.has(e.user_id),
                  )
                  .map((e) => a.users.find((u) => u.id === e.user_id))
                  .filter(Boolean)
              : [];
            return (
              <section className="panel">
                <div className="row between wrap gap">
                  <div>
                    <h2>Assessment Analytics, Diagnostics & Grading</h2>
                    <p>
                      Inspect DeepSeek diagnostic reports, override written/code
                      marks, or grant a 1-click retake.
                    </p>
                  </div>
                  <label>
                    Filter by Assessment
                    <select
                      value={reportTestId}
                      onChange={(e) => setReportTestId(e.target.value)}
                    >
                      <option value="all">All assessments</option>
                      {a.tests.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title} ({t.kind})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="stats admin-stats">
                  <div className="stat">
                    <span>Submitted attempts</span>
                    <b>{submittedAttempts.length}</b>
                  </div>
                  <div className="stat">
                    <span>Cohort average</span>
                    <b>{submittedAttempts.length ? `${avgScore}%` : "—"}</b>
                  </div>
                  <div className="stat">
                    <span>Pass rate (≥70%)</span>
                    <b>
                      {submittedAttempts.length
                        ? `${Math.round((passCount / submittedAttempts.length) * 100)}%`
                        : "—"}
                    </b>
                  </div>
                  <div className="stat">
                    <span>Yet to attempt</span>
                    <b>{selectedTest ? nonAttempters.length : "Select test"}</b>
                  </div>
                </div>
                {selectedTest && nonAttempters.length > 0 && (
                  <div className="info-strip">
                    <span>
                      <b>Not yet attempted ({nonAttempters.length}):</b>{" "}
                      {nonAttempters
                        .map((u) => `${u.name} (${u.email})`)
                        .join(", ")}
                    </span>
                  </div>
                )}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Assessment</th>
                        <th>Batch</th>
                        <th>Score & Status</th>
                        <th>Submitted</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submittedAttempts.map((t) => (
                        <tr key={t.id}>
                          <td>
                            <b>{name(t.user_id)}</b>
                          </td>
                          <td>
                            {a.tests.find((x) => x.id === t.test_id)?.title}
                          </td>
                          <td>{batchName(t.batch_id)}</td>
                          <td>
                            <button
                              className="text-btn"
                              onClick={() => viewResult(t.id)}
                            >
                              {t.score}/{t.total} ({t.grading_status || "complete"}) ↗
                            </button>
                          </td>
                          <td>{date(t.submitted)}</td>
                          <td>
                            <div className="row gap wrap">
                              <button
                                className="text-btn"
                                onClick={() => viewResult(t.id)}
                              >
                                Diagnostic report
                              </button>
                              <button
                                className="text-btn"
                                onClick={() =>
                                  setModal({
                                    type: "grade_override",
                                    item: t,
                                  })
                                }
                              >
                                Override grade
                              </button>
                              <button
                                className="text-btn"
                                onClick={() =>
                                  act(
                                    () =>
                                      api("admin/attempt-action", {
                                        attempt_id: t.id,
                                        mode: "reset",
                                      }),
                                    "Retake granted. The student can now start a fresh attempt.",
                                  )
                                }
                              >
                                Grant retake
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })()
        ) : (
          <section className="panel table-panel">
            {adminTab === "users" && (
              <div
                className="row between wrap gap"
                style={{ padding: "12px 16px 8px" }}
              >
                <label className="row gap">
                  <span>Filter by Batch</span>
                  <select
                    value={userBatchFilter}
                    onChange={(e) => setUserBatchFilter(e.target.value)}
                  >
                    <option value="all">All Batches</option>
                    {a.batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <small className="muted">
                  Tip: Click <b>+ Assign Batch</b> on any student or{" "}
                  <b>+ Add Student to Batch</b> above.
                </small>
              </div>
            )}
            {(() => {
              const tableRows =
                adminTab === "users" && userBatchFilter !== "all"
                  ? (a.users || []).filter(
                      (u) =>
                        a.enrollments.some(
                          (e) =>
                            e.user_id === u.id &&
                            e.batch_id === userBatchFilter,
                        ) ||
                        a.invitations.some(
                          (inv) =>
                            inv.email.toLowerCase() === u.email.toLowerCase() &&
                            inv.batch_id === userBatchFilter,
                        ),
                    )
                  : a[adminTab] || [];
              return tableRows.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {(adminTab === "batches"
                          ? [
                              "Batch",
                              "Course",
                              "Dates",
                              "Topics covered",
                              "Status",
                              "",
                            ]
                          : adminTab === "courses"
                            ? ["Course", "Fee", "Currency", ""]
                            : adminTab === "invitations"
                              ? ["Email", "Batch", "Role", "Agreed fee", ""]
                              : adminTab === "content"
                                ? [
                                    "Resource",
                                    "Type",
                                    "Topic",
                                    "Scope",
                                    "Status",
                                    "",
                                  ]
                                : adminTab === "tests"
                                  ? [
                                      "Assessment",
                                      "Type",
                                      "Unlocks after topic",
                                      "Duration",
                                      "Status",
                                      "",
                                    ]
                                  : adminTab === "users"
                                    ? [
                                        "Name",
                                        "Email",
                                        "Enrolled Batches",
                                        "Role",
                                        "Joined",
                                        "",
                                      ]
                                    : adminTab === "submissions"
                                      ? ["Student", "Lab", "Batch", "Status", ""]
                                      : adminTab === "tickets"
                                        ? [
                                            "Student",
                                            "Subject",
                                            "Category",
                                            "Status",
                                            "Created",
                                            "",
                                          ]
                                        : adminTab === "payments"
                                          ? [
                                              "Student",
                                              "Batch",
                                              "Amount",
                                              "Reference",
                                              "Date",
                                              "",
                                            ]
                                          : ["Actor", "Action", "Record", "Date"]
                        ).map((h, i) => (
                          <th key={i}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((v) => (
                        <tr key={v.id}>
                          {adminTab === "batches" ? (
                            <>
                              <td>
                                <b>{v.name}</b>
                              </td>
                              <td>
                                {
                                  a.courses.find((c) => c.id === v.course_id)
                                    ?.title
                                }
                              </td>
                              <td>
                                {date(v.start_date)}
                                <br />
                                <small>to {date(v.end_date)}</small>
                              </td>
                              <td>{v.covered}</td>
                              <td>
                                <Badge tone="green">{v.status}</Badge>
                              </td>
                              <td>
                                <div className="row gap wrap">
                                  <button
                                    className="text-btn"
                                    onClick={() =>
                                      edit("invitations", { batch_id: v.id })
                                    }
                                  >
                                    + Add Student
                                  </button>
                                  <button
                                    className="text-btn"
                                    onClick={() => edit("batches", v)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="text-btn"
                                    onClick={() =>
                                      removeEntity("batches", v.id, v.name)
                                    }
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </>
                        ) : adminTab === "courses" ? (
                          <>
                            <td>
                              <b>{v.title}</b>
                            </td>
                            <td>{money(v.fee, v.currency)}</td>
                            <td>{v.currency}</td>
                            <td>
                              <div className="row gap">
                                <button
                                  className="text-btn"
                                  onClick={() => edit("courses", v)}
                                >
                                  Edit
                                </button>
                                {isHeadAdmin && (
                                  <button
                                    className="text-btn"
                                    onClick={() =>
                                      removeEntity("courses", v.id, v.title)
                                    }
                                  >
                                    Delete
                                  </button>
                                )}
                              </div>
                            </td>
                          </>
                        ) : adminTab === "invitations" ? (
                          <>
                            <td>{v.email}</td>
                            <td>{batchName(v.batch_id)}</td>
                            <td>{v.role}</td>
                            <td>
                              {money(
                                v.fee,
                                a.courses.find(
                                  (c) =>
                                    c.id ===
                                    a.batches.find((b) => b.id === v.batch_id)
                                      ?.course_id,
                                )?.currency,
                              )}
                            </td>
                            <td>
                              <div className="row gap">
                                <button
                                  className="text-btn"
                                  onClick={() => edit("invitations", v)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="text-btn"
                                  onClick={() =>
                                    removeEntity("invitations", v.id, v.email)
                                  }
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </>
                        ) : adminTab === "content" ? (
                          <>
                            <td>
                              <b>{v.title}</b>
                            </td>
                            <td>{kindName[v.kind] || v.kind}</td>
                            <td>
                              {v.topic_order}. {v.topic}
                            </td>
                            <td>
                              {v.batch_id
                                ? batchName(v.batch_id)
                                : "All course batches"}
                            </td>
                            <td>
                              <Badge tone={v.published ? "green" : ""}>
                                {v.published ? "Published" : "Draft"}
                              </Badge>
                            </td>
                            <td>
                              <div className="row gap">
                                <button
                                  className="text-btn"
                                  onClick={() => edit("content", v)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="text-btn"
                                  onClick={() =>
                                    removeEntity("content", v.id, v.title)
                                  }
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </>
                        ) : adminTab === "tests" ? (
                          <>
                            <td>
                              <b>{v.title}</b>
                            </td>
                            <td>{v.kind}</td>
                            <td>{v.topic_order}</td>
                            <td>{v.duration} min</td>
                            <td>
                              <Badge tone={v.published ? "green" : ""}>
                                {v.published ? "Published" : "Draft"}
                              </Badge>
                            </td>
                            <td>
                              <div className="row gap">
                                <button
                                  className="text-btn"
                                  onClick={() => edit("tests", v)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="text-btn"
                                  onClick={() =>
                                    removeEntity("tests", v.id, v.title)
                                  }
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </>
                        ) : adminTab === "users" ? (
                          (() => {
                            const userBatches = a.enrollments
                              .filter((e) => e.user_id === v.id)
                              .map((e) => batchName(e.batch_id));
                            return (
                              <>
                                <td>
                                  <button
                                    className="text-btn"
                                    onClick={() =>
                                      setModal({ type: "student360", item: v })
                                    }
                                  >
                                    <b>{v.name}</b> ↗
                                  </button>
                                </td>
                                <td>{v.email}</td>
                                <td>
                                  <div className="row gap wrap">
                                    {userBatches.length ? (
                                      userBatches.map((bn, idx) => (
                                        <Badge key={idx} tone="green">
                                          {bn}
                                        </Badge>
                                      ))
                                    ) : (
                                      <small className="muted">
                                        Not enrolled
                                      </small>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <Badge
                                    tone={
                                      v.role === "admin"
                                        ? "blue"
                                        : v.role === "trainer"
                                          ? "purple"
                                          : ""
                                    }
                                  >
                                    {v.role}
                                  </Badge>
                                </td>
                                <td>{date(v.created)}</td>
                                <td>
                                  <div className="row gap wrap">
                                    <button
                                      className="text-btn"
                                      onClick={() =>
                                        edit("invitations", { email: v.email })
                                      }
                                    >
                                      + Assign Batch
                                    </button>
                                    <button
                                      className="text-btn"
                                      onClick={() =>
                                        setModal({ type: "student360", item: v })
                                      }
                                    >
                                      360° profile
                                    </button>
                                    {isHeadAdmin && v.id !== boot.user.id && (
                                      <button
                                        className="text-btn"
                                        onClick={() =>
                                          setModal({ type: "role", item: v })
                                        }
                                      >
                                        Change role
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </>
                            );
                          })()
                        ) : adminTab === "submissions" ? (
                          <>
                            <td>{name(v.user_id)}</td>
                            <td>
                              <b>{title(v.content_id)}</b>
                            </td>
                            <td>{batchName(v.batch_id)}</td>
                            <td>
                              <Badge
                                tone={
                                  v.status === "accepted" ? "green" : "amber"
                                }
                              >
                                {v.status.replace("_", " ")}
                              </Badge>
                            </td>
                            <td>
                              <button
                                className="text-btn"
                                onClick={() =>
                                  setModal({ type: "review", item: v })
                                }
                              >
                                Review
                              </button>
                            </td>
                          </>
                        ) : adminTab === "tickets" ? (
                          <>
                            <td>{name(v.user_id)}</td>
                            <td>
                              <b>{v.subject}</b>
                            </td>
                            <td>
                              <Badge tone="blue">
                                {v.category || "academic"}
                              </Badge>
                            </td>
                            <td>
                              <Badge
                                tone={
                                  v.status === "resolved" ? "green" : "amber"
                                }
                              >
                                {v.status}
                              </Badge>
                            </td>
                            <td>{date(v.created)}</td>
                            <td>
                              <button
                                className="text-btn"
                                onClick={() =>
                                  setModal({ type: "reply", item: v })
                                }
                              >
                                Reply
                              </button>
                            </td>
                          </>
                        ) : adminTab === "payments" ? (
                          (() => {
                            const e = a.enrollments.find(
                              (e) => e.id === v.enrollment_id,
                            );
                            return (
                              <>
                                <td>{name(e?.user_id)}</td>
                                <td>{batchName(e?.batch_id)}</td>
                                <td>
                                  {money(
                                    v.amount,
                                    a.courses.find(
                                      (c) =>
                                        c.id ===
                                        a.batches.find(
                                          (b) => b.id === e?.batch_id,
                                        )?.course_id,
                                    )?.currency,
                                  )}
                                </td>
                                <td>{v.reference}</td>
                                <td>{date(v.paid_at)}</td>
                                <td>
                                  {isHeadAdmin && (
                                    <button
                                      className="text-btn"
                                      onClick={() =>
                                        removeEntity(
                                          "payments",
                                          v.id,
                                          v.reference,
                                        )
                                      }
                                    >
                                      Void
                                    </button>
                                  )}
                                </td>
                              </>
                            );
                          })()
                        ) : (
                          <>
                            <td>{name(v.actor)}</td>
                            <td>{v.action}</td>
                            <td>
                              <code>{v.entity.slice(0, 16)}</code>
                            </td>
                            <td>{date(v.created)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title={
                  adminTab === "submissions"
                    ? "All caught up"
                    : adminTab === "tickets"
                      ? "No open conversations"
                      : "A fresh start"
                }
                body={
                  adminTab === "submissions"
                    ? "Student lab submissions will appear here for review."
                    : adminTab === "invitations"
                      ? "Enroll students using the email they will use to sign in. This records their enrollment; it does not send email."
                      : "New records will appear here as your campus grows."
                }
              />
            );
            })()}
          </section>
        )}
      </>
    );
  }

  return (
    <div className="app-shell">
      {!onboarding && (
        <Tour
          key={boot.user.id + adminMode}
          user={boot.user}
          blocked={!!modal}
          adminMode={adminMode}
          onNavigate={(p) => {
            if (adminMode) {
              setAdminTab(p === "dashboard" ? "overview" : p);
              navigate("admin");
            } else navigate(p);
          }}
        />
      )}
      <div
        className={"mobile-shade " + (mobile ? "visible" : "")}
        onClick={() => setMobile(false)}
      />
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setAdminMode(false);
            navigate("dashboard");
          }}
        >
          <div className="logo-window">
            <img src="/brand.png" alt="ARKS global asia" />
          </div>
          <span>
            INSTITUTES <i /> LEARNING CAMPUS
          </span>
        </a>
        <div className="workspace-label">
          {adminMode
            ? boot.user.role === "trainer"
              ? "TRAINER WORKSPACE"
              : "ADMIN WORKSPACE"
            : "STUDENT WORKSPACE"}
        </div>
        <nav>
          {adminMode
            ? ADMIN_WORKSPACES.map((w) => {
                const Icon = icons[w.id] || Settings;
                const active = activeWorkspace.id === w.id;
                return (
                  <button
                    key={w.id}
                    className={active ? "active" : ""}
                    onClick={() => {
                      setAdminTab(w.defaultTab);
                      setMobile(false);
                    }}
                  >
                    <Icon size={19} />
                    <span>{w.label}</span>
                  </button>
                );
              })
            : nav.map(([id, label]) => {
                const Icon = icons[id];
                return (
                  <button
                    key={id}
                    className={page === id ? "active" : ""}
                    onClick={() => navigate(id)}
                  >
                    <Icon size={19} />
                    <span>{label}</span>
                    {id === "tests" &&
                      tests.filter((t) => !t.locked).length > 0 && (
                        <span className="nav-count">
                          {tests.filter((t) => !t.locked).length}
                        </span>
                      )}
                  </button>
                );
              })}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-dot" />
            <h3>Big goals. Small steps.</h3>
            <p>
              We’re here for every part
              <br />
              of your learning journey.
            </p>
            <button
              className="text-btn"
              onClick={() => {
                setAdminMode(false);
                navigate("tickets");
              }}
            >
              Let’s talk <ArrowUpRight size={14} />
            </button>
          </div>
          {isStaffRole(boot.user.role) && (
            <button
              className="mode-switch"
              onClick={() => {
                setAdminMode(!adminMode);
                setPage("dashboard");
              }}
            >
              <Settings size={18} />
              {adminMode ? "Switch to student view" : "Admin portal"}
              <ArrowUpRight size={15} />
            </button>
          )}
          <button
            className="user-card"
            onClick={() => setModal({ type: "profile" })}
          >
            <div className="avatar">
              {boot.user.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
            <div>
              <strong>{boot.user.name}</strong>
              <span>
                {adminMode
                  ? boot.user.role === "trainer"
                    ? "Trainer / Instructor"
                    : "Head / Administrator"
                  : "My learning profile"}
              </span>
            </div>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="row gap">
            <button
              className="icon-btn mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              <button
                className="text-btn"
                onClick={() => {
                  navigate("dashboard");
                  if (adminMode) setAdminTab("overview");
                }}
              >
                Campus
              </button>{" "}
              <ChevronRight size={13} />{" "}
              <b>
                {adminMode
                  ? activeWorkspace.label
                  : nav.find((n) => n[0] === page)?.[1] || "Overview"}
              </b>
            </span>
          </div>
          <div className="header-right">
            {!adminMode && (
              <label className="search">
                <Search size={17} />
                <input
                  aria-label="Search your resources"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search your campus…"
                />
                <kbd>⌕</kbd>
              </label>
            )}
            <button
              className="icon-btn notification"
              aria-label="View campus updates"
              onClick={() => setModal({ type: "updates" })}
            >
              <Bell size={19} />
              {upcoming.length > 0 && <i />}
            </button>
            <span className="header-divider" />
            <button
              className="avatar small"
              aria-label="Open profile"
              onClick={() => setModal({ type: "profile" })}
            >
              {boot.user.name[0].toUpperCase()}
            </button>
          </div>
        </header>
        <main>
          <div className="context-bar">
            <div className="row gap">
              <span className="small-dot" />
              <span>
                {adminMode
                  ? "A little care. A better learning experience."
                  : "Let’s make today a step forward."}
              </span>
            </div>
            {boot.batches.length > 0 && (
              <label className="batch-select">
                <Layers size={15} />
                <select
                  aria-label="Select batch"
                  value={batchId}
                  onChange={(e) => {
                    setBatchId(e.target.value);
                    setSearch("");
                  }}
                >
                  {boot.batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </label>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}{" "}
              <button
                onClick={() => {
                  setError("");
                  refresh();
                }}
              >
                Retry
              </button>
            </div>
          )}
          <Content />
          <footer>
            <span>
              © {new Date().getFullYear()} Arks Global Asia Institutes
            </span>
            <div>
              <button
                onClick={async () => {
                  await api("auth/logout", {});
                  setBoot(null);
                  setLoginRequired(true);
                }}
              >
                Sign out
              </button>
              <span>Trust starts here.</span>
            </div>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {(modal || onboarding) && (
        <Modal
          title={
            onboarding
              ? "Your next chapter starts here"
              : modal?.type === "resource"
                ? modal.item.title
                : modal?.type === "editor"
                  ? (modal.item?.id ? "Edit " : "Create ") +
                    {
                      invitations: "enrollment",
                      content: "resource",
                      tests: "assessment",
                      batches: "batch",
                      courses: "course",
                    }[modal.entity]
                  : modal?.type === "quiz"
                    ? modal.test.title
                    : modal?.type === "student360"
                      ? `Student 360° Profile — ${modal.item.name}`
                      : modal?.type === "grade_override"
                        ? "Manual Grade & Feedback Override"
                        : {
                            ticket: "How can we help?",
                            profile: "Your campus profile",
                            result: "A little feedback goes a long way",
                            payment: "Record a payment",
                            review: "Review lab submission",
                            reply: "Reply to a query",
                            role: "Change account role",
                            updates: "Your campus updates",
                          }[modal?.type] || "Campus"
          }
          close={() => {
            if (onboarding) setOnboarding(false);
            else setModal(null);
          }}
        >
          {onboarding || modal?.type === "profile" ? (
            <ProfileForm
              user={boot.user}
              onboarding={onboarding}
              onLogout={async () => {
                await api("auth/logout", {});
                setModal(null);
                setBoot(null);
                setLoginRequired(true);
              }}
              save={async (values) => {
                if (
                  await act(
                    () => api("profile", values),
                    "Profile saved. You’re ready to learn.",
                  )
                ) {
                  setOnboarding(false);
                  setModal(null);
                  await init();
                }
              }}
            />
          ) : modal.type === "resource" ? (
            <ResourceDetail
              item={modal.item}
              complete={done.has(modal.item.id)}
              submissions={data.submissions.filter(
                (s) => s.content_id === modal.item.id,
              )}
              busy={busy}
              mark={() =>
                act(
                  () =>
                    api("complete", {
                      content_id: modal.item.id,
                      batch_id: batchId,
                      complete: !done.has(modal.item.id),
                    }),
                  "Progress updated",
                )
              }
              submit={async (values) => {
                if (
                  await act(
                    () =>
                      api("submissions", {
                        ...values,
                        content_id: modal.item.id,
                        batch_id: batchId,
                      }),
                    "Lab submitted for review.",
                  )
                )
                  setModal(null);
              }}
            />
          ) : modal.type === "ticket" ? (
            <SimpleForm
              initial={{ category: "academic" }}
              fields={[
                [
                  "category",
                  "Category",
                  "select",
                  ["academic", "lab", "assessment", "fees", "technical"],
                ],
                ["subject", "Subject", "text"],
                ["body", "Tell us a little more", "textarea"],
              ]}
              save={async (values) => {
                if (
                  await act(
                    () => api("tickets", { ...values, batch_id: batchId }),
                    "Your query has been sent to the team.",
                  )
                )
                  setModal(null);
              }}
              label="Send query"
            />
          ) : modal.type === "quiz" ? (
            <Quiz
              test={modal.test}
              finish={async (answers) => {
                setBusy(true);
                try {
                  const r = await api("tests/submit", {
                    attempt_id: modal.test.id,
                    answers,
                  });
                  setModal({ type: "result", result: r });
                  await refresh();
                } catch (e) {
                  toast(e.message);
                } finally {
                  setBusy(false);
                }
              }}
              busy={busy}
            />
          ) : modal.type === "result" ? (
            <Result
              result={modal.result}
              onRefresh={() => viewResult(modal.result.id)}
            />
          ) : modal.type === "editor" ? (
            <Editor
              entity={modal.entity}
              item={modal.item}
              data={adminData}
              user={boot.user}
              save={async (values) => {
                if (
                  await act(
                    () => api("admin/save", { entity: modal.entity, values }),
                    "Changes saved.",
                  )
                ) {
                  setModal(null);
                  await init();
                }
              }}
            />
          ) : modal.type === "payment" ? (
            <PaymentForm
              data={adminData}
              save={async (values) => {
                if (
                  await act(
                    () => api("admin/payment", values),
                    "Payment recorded.",
                  )
                )
                  setModal(null);
              }}
            />
          ) : modal.type === "review" ? (
            <>
              <p className="prewrap">{modal.item.body}</p>
              {modal.item.file_id && (
                <div className="row gap wrap">
                  <a
                    className="button secondary"
                    href={"/api/files/" + modal.item.file_id + "?inline=1"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Preview submission ↗
                  </a>
                  <a
                    className="button secondary"
                    href={"/api/files/" + modal.item.file_id}
                  >
                    <Download size={15} /> Download submission
                  </a>
                </div>
              )}
              <SimpleForm
                initial={modal.item}
                fields={[
                  [
                    "status",
                    "Review status",
                    "select",
                    ["submitted", "accepted", "revision_requested"],
                  ],
                  ["feedback", "Feedback for the student", "textarea"],
                ]}
                save={async (values) => {
                  if (
                    await act(
                      () =>
                        api("admin/review", { ...values, id: modal.item.id }),
                      "Review saved.",
                    )
                  )
                    setModal(null);
                }}
                label="Save review"
              />
            </>
          ) : modal.type === "reply" ? (
            <>
              <div className="row gap">
                <Badge tone="blue">{modal.item.category || "academic"}</Badge>
                <Badge tone={modal.item.status === "resolved" ? "green" : "amber"}>
                  {modal.item.status}
                </Badge>
              </div>
              <h3>{modal.item.subject}</h3>
              {(() => {
                let thread = [];
                try {
                  thread = JSON.parse(modal.item.messages || "[]");
                } catch {}
                return thread.length ? (
                  <div className="ticket-thread">
                    {thread.map((m) => (
                      <div
                        key={m.id || m.created}
                        className={
                          isStaffRole(m.role) ? "reply" : "ticket-message"
                        }
                      >
                        <b>
                          {m.author_name || m.role} ({m.role}) ·{" "}
                          <small>{date(m.created)}</small>
                        </b>
                        <p className="prewrap">{m.body}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="prewrap">{modal.item.body}</p>
                );
              })()}
              <SimpleForm
                initial={{ reply: "", status: modal.item.status }}
                fields={[
                  ["reply", "Your reply", "textarea"],
                  ["status", "Status", "select", ["open", "resolved"]],
                ]}
                save={async (values) => {
                  if (
                    await act(
                      () =>
                        api("admin/reply", { ...values, id: modal.item.id }),
                      "Reply saved.",
                    )
                  )
                    setModal(null);
                }}
                label="Send reply"
              />
            </>
          ) : modal.type === "role" ? (
            <>
              <p>
                Update permissions for <b>{modal.item.name}</b>.{" "}
                <b>Head / Admin</b> manages everything including courses, team
                roles, and fees; <b>Trainer / Instructor</b> manages batches,
                Drive Sync Up, content approvals, live sessions, assessments,
                labs, and queries.
              </p>
              <SimpleForm
                initial={modal.item}
                fields={[
                  [
                    "role",
                    "Account role",
                    "select",
                    ["student", "trainer", "admin"],
                  ],
                ]}
                save={async (values) => {
                  if (
                    await act(
                      () =>
                        api("admin/role", {
                          id: modal.item.id,
                          role: values.role,
                        }),
                      "Role updated.",
                    )
                  )
                    setModal(null);
                }}
                label="Update role"
              />
            </>
          ) : modal.type === "grade_override" ? (
            <SimpleForm
              initial={{ score: modal.item.score ?? 0 }}
              fields={[["score", "Override score (0 to 100)", "number"]]}
              save={async (values) => {
                if (
                  await act(
                    () =>
                      api("admin/attempt-action", {
                        attempt_id: modal.item.id,
                        mode: "grade",
                        score: Number(values.score),
                      }),
                    "Assessment score updated.",
                  )
                )
                  setModal(null);
              }}
              label="Save overridden score"
            />
          ) : modal.type === "student360" ? (
            <Student360
              student={modal.item}
              data={adminData}
              isHeadAdmin={boot.user.role === "admin"}
              onInspectResult={(attemptId) => viewResult(attemptId)}
              onGrantRetake={(attemptId) =>
                act(
                  () =>
                    api("admin/attempt-action", {
                      attempt_id: attemptId,
                      mode: "reset",
                    }),
                  "Retake granted.",
                )
              }
            />
          ) : modal.type === "updates" ? (
            <>
              <p>Your next classes and latest feedback, in one place.</p>
              {upcoming.length ? (
                upcoming.slice(0, 5).map((s) => (
                  <div className="result-row" key={s.id}>
                    <div>
                      <h3>{s.title}</h3>
                      <p>{date(s.starts_at)}</p>
                    </div>
                    <Video size={18} />
                  </div>
                ))
              ) : (
                <p>No upcoming sessions have been scheduled.</p>
              )}
              {data?.submissions
                .filter((s) => s.feedback)
                .map((s) => (
                  <div className="reply" key={s.id}>
                    <b>Lab feedback</b>
                    <p>{s.feedback}</p>
                  </div>
                ))}
              <Button
                secondary
                onClick={async () => {
                  if (install) {
                    await install.prompt();
                    setInstall(null);
                  } else
                    toast(
                      "On Android, open this site in Chrome and choose ⋮ → Add to Home screen → Install.",
                    );
                }}
              >
                Install campus on your phone <Download size={15} />
              </Button>
            </>
          ) : null}
        </Modal>
      )}
    </div>
  );
}

function Student360({
  student,
  data,
  isHeadAdmin,
  onInspectResult,
  onGrantRetake,
}) {
  const enrollments = data.enrollments.filter((e) => e.user_id === student.id);
  const attempts = data.attempts.filter(
    (a) => a.user_id === student.id && a.submitted,
  );
  const submissions = data.submissions.filter((s) => s.user_id === student.id);
  const tickets = data.tickets.filter((t) => t.user_id === student.id);
  return (
    <div className="student-360">
      <div className="row between wrap">
        <div>
          <h3>{student.name}</h3>
          <p>
            {student.email} · {student.phone || "No phone"} · Joined{" "}
            {date(student.created)}
          </p>
        </div>
        <Badge tone="blue">{student.role}</Badge>
      </div>
      {student.goal && (
        <div className="info-strip">
          <span>
            <b>Learning goal:</b> {student.goal}
          </span>
        </div>
      )}
      <h4>Enrolled Batches ({enrollments.length})</h4>
      {enrollments.map((e) => {
        const b = data.batches.find((x) => x.id === e.batch_id);
        const paid = data.payments
          .filter((p) => p.enrollment_id === e.id)
          .reduce((s, p) => s + p.amount, 0);
        const doneCount = data.completions.filter(
          (c) => c.user_id === student.id && c.batch_id === e.batch_id,
        ).length;
        return (
          <div className="result-row" key={e.id}>
            <div>
              <b>{b?.name || e.batch_id}</b>
              <p>
                {doneCount} resources completed
                {isHeadAdmin
                  ? ` · Fee: ${money(paid)} paid of ${money(e.fee)}`
                  : ""}
              </p>
            </div>
            <Badge tone="green">{b?.status || "enrolled"}</Badge>
          </div>
        );
      })}
      <h4>Assessment Attempts ({attempts.length})</h4>
      {attempts.length ? (
        attempts.map((a) => (
          <div className="result-row" key={a.id}>
            <div>
              <b>
                {data.tests.find((t) => t.id === a.test_id)?.title || a.test_id}
              </b>
              <p>
                Score: {a.score}/{a.total} · {date(a.submitted)}
              </p>
            </div>
            <div className="row gap">
              <button
                className="text-btn"
                onClick={() => onInspectResult(a.id)}
              >
                Diagnostic report ↗
              </button>
              <button className="text-btn" onClick={() => onGrantRetake(a.id)}>
                Grant retake
              </button>
            </div>
          </div>
        ))
      ) : (
        <p className="muted">No submitted assessments yet.</p>
      )}
      <h4>Lab Submissions ({submissions.length})</h4>
      {submissions.length ? (
        submissions.map((s) => (
          <div className="result-row" key={s.id}>
            <div>
              <b>
                {data.content.find((c) => c.id === s.content_id)?.title ||
                  "Lab"}
              </b>
              <p>{date(s.created)}</p>
            </div>
            <Badge tone={s.status === "accepted" ? "green" : "amber"}>
              {s.status}
            </Badge>
          </div>
        ))
      ) : (
        <p className="muted">No lab submissions yet.</p>
      )}
      <h4>Support Queries ({tickets.length})</h4>
      {tickets.length ? (
        tickets.map((t) => (
          <div className="result-row" key={t.id}>
            <div>
              <b>{t.subject}</b>
              <p>{t.category || "academic"}</p>
            </div>
            <Badge tone={t.status === "resolved" ? "green" : "amber"}>
              {t.status}
            </Badge>
          </div>
        ))
      ) : (
        <p className="muted">No queries submitted.</p>
      )}
    </div>
  );
}

function Modal({ title, close, children }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    document.body.style.overflow = "hidden";
    function key(e) {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll(
          'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="modal"
        ref={ref}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">ARKS GLOBAL ASIA INSTITUTES</div>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button
            className="icon-btn"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={22} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function SimpleForm({
  fields,
  initial = {},
  save,
  label = "Save changes",
  children,
}) {
  const [values, setValues] = useState(initial),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await save(values);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="form" onSubmit={submit}>
      {children}
      {fields.map(([key, label, type, opts, help]) => (
        <label key={key}>
          {label}
          {type === "textarea" ? (
            <textarea
              required={!["feedback", "goal"].includes(key)}
              rows={5}
              value={values[key] ?? ""}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          ) : type === "select" ? (
            <select
              required
              value={values[key] ?? ""}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            >
              <option value="" disabled>
                Select {label.toLowerCase()}
              </option>
              {opts.map((o) => (
                <option
                  key={typeof o === "string" ? o : o.value}
                  value={typeof o === "string" ? o : o.value}
                >
                  {typeof o === "string" ? o.replaceAll("_", " ") : o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              required={key !== "phone"}
              step={key === "amount" ? "0.01" : undefined}
              min={key === "amount" ? "0.01" : undefined}
              type={type || "text"}
              value={values[key] ?? ""}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          )}{" "}
          {help && <small>{help}</small>}
        </label>
      ))}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <Button type="submit" disabled={saving}>
        {saving ? <LoaderCircle size={16} className="spin" /> : null}
        {saving ? "Saving…" : label}
      </Button>
    </form>
  );
}

function ProfileForm({ user, save, onboarding, onLogout }) {
  return (
    <>
      <p>
        {onboarding
          ? "Welcome to your campus. Tell us a little about yourself, then make it your own."
          : "Your profile follows you across all your batches."}
      </p>
      <SimpleForm
        initial={user}
        fields={[
          ["name", "Your full name", "text"],
          ["phone", "Phone number", "tel"],
          ["goal", "What would you like to achieve?", "textarea"],
        ]}
        save={save}
        label={onboarding ? "Let’s get started" : "Save profile"}
      />
      <button type="button" className="signout text-btn" onClick={onLogout}>
        <LogOut size={15} /> Sign out
      </button>
    </>
  );
}

function FileUpload({ accept, onUploaded }) {
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div>
      <label className="upload-zone">
        <Upload size={22} />
        <strong>{busy ? "Uploading…" : name || "Add a file"}</strong>
        <span>PDF, images, YAML/scripts, text, ZIP, Office · Up to 20 MB</span>
        <input
          aria-label="Upload file"
          disabled={busy}
          type="file"
          accept={
            accept ||
            ".pdf,.png,.jpg,.jpeg,.webp,.svg,.txt,.md,.yaml,.yml,.sh,.py,.json,.zip,.docx,.pptx,.xlsx,.csv"
          }
          onChange={async (e) => {
            const f = e.target.files[0];
            if (!f) return;
            setBusy(true);
            setError("");
            try {
              if (f.size > 20 * 1024 * 1024)
                throw new Error("File must be 20 MB or smaller.");
              const form = new FormData();
              form.set("file", f);
              const r = await api("upload", form);
              setName(r.name);
              onUploaded(r.id);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function ResourceDetail({
  item: c,
  complete,
  mark,
  submissions,
  submit,
  busy,
}) {
  const [body, setBody] = useState(""),
    [file, setFile] = useState(null),
    [saving, setSaving] = useState(false);

  const isRecording = c.kind === "recording";
  const fileName = String(c.file_name || "").toLowerCase();
  const fileMime = String(c.file_mime || "").toLowerCase();
  const isImageFile =
    !isRecording &&
    !!c.file_id &&
    (c.kind === "image" ||
      fileMime.startsWith("image/") ||
      /\.(png|jpe?g|webp|svg|gif)$/i.test(fileName));
  const isPdfFile =
    !isRecording &&
    !!c.file_id &&
    (fileMime === "application/pdf" || /\.pdf$/i.test(fileName));
  const isTextFile =
    !isRecording &&
    !!c.file_id &&
    (fileMime.startsWith("text/") ||
      /\.(txt|md|ya?ml|sh|py|json|csv)$/i.test(fileName));
  const isPptFile =
    !isRecording &&
    !!c.file_id &&
    (/\.(pptx|ppt)$/i.test(fileName) ||
      fileMime.includes("presentation") ||
      fileMime.includes("powerpoint"));
  const isSlidesPdf = isPdfFile && c.kind === "slides";
  const inlineHref = c.file_id ? "/api/files/" + c.file_id + "?inline=1" : "";
  const downloadHref = c.file_id ? "/api/files/" + c.file_id : "";

  return (
    <>
      <div className="row gap">
        <Badge tone="blue">{kindName[c.kind] || c.kind}</Badge>
        <span className="muted">
          Topic {c.topic_order} · {c.topic}
        </span>
      </div>
      {isImageFile && (
        <div className="inline-preview-box">
          <img
            className="inline-preview-img"
            src={inlineHref}
            alt={c.title}
          />
        </div>
      )}
      {isPdfFile && (
        <div className="inline-preview-box">
          <iframe
            className="inline-preview-frame"
            title={c.title}
            src={inlineHref}
          />
        </div>
      )}
      <p className="prewrap resource-text">
        {c.body || "Your instructor has shared this resource with your class."}
      </p>
      <div className="row gap wrap">
        {c.url && (
          <a className="button" href={c.url} target="_blank" rel="noreferrer">
            {c.kind === "live"
              ? "Join live session"
              : isRecording
                ? "Watch recording"
                : isPptFile || c.kind === "slides"
                  ? "Open & Read Presentation Online"
                  : "Open resource"}{" "}
            <ExternalLink size={16} />
          </a>
        )}
        {!isRecording && isImageFile && (
          <>
            <a
              className="button secondary"
              href={inlineHref}
              target="_blank"
              rel="noreferrer"
            >
              Open Full Image ↗
            </a>
            <a className="button secondary" href={downloadHref}>
              <Download size={16} /> Download Image
            </a>
          </>
        )}
        {!isRecording && isPdfFile && (
          <>
            <a
              className="button secondary"
              href={inlineHref}
              target="_blank"
              rel="noreferrer"
            >
              {isSlidesPdf
                ? "Open Slides in New Tab ↗"
                : "Open PDF in New Tab ↗"}
            </a>
            <a className="button secondary" href={downloadHref}>
              <Download size={16} />{" "}
              {isSlidesPdf ? "Download Slides (PDF)" : "Download PDF"}
            </a>
          </>
        )}
        {!isRecording && !isImageFile && !isPdfFile && isTextFile && (
          <>
            <a
              className="button secondary"
              href={inlineHref}
              target="_blank"
              rel="noreferrer"
            >
              Read Inline / Open ↗
            </a>
            <a className="button secondary" href={downloadHref}>
              <Download size={16} /> Download File
            </a>
          </>
        )}
        {!isRecording && !isImageFile && !isPdfFile && !isTextFile && isPptFile && (
          <a className="button secondary" href={downloadHref}>
            <Download size={16} /> Download Presentation (
            {/\.ppt$/i.test(fileName) ? ".ppt" : ".pptx"})
          </a>
        )}
        {!isRecording &&
          c.file_id &&
          !isImageFile &&
          !isPdfFile &&
          !isTextFile &&
          !isPptFile && (
            <a className="button secondary" href={downloadHref}>
              <Download size={16} /> Download attachment
            </a>
          )}
        {["notes", "slides", "recording", "guide", "image"].includes(
          c.kind,
        ) && (
          <Button secondary disabled={busy} onClick={mark}>
            {complete ? <CheckCircle2 size={17} /> : <Check size={17} />}{" "}
            {complete ? "Completed · undo" : "Mark as complete"}
          </Button>
        )}
      </div>
      {c.kind === "lab" && (
        <>
          <hr />
          <h3>Your solution</h3>
          <p>
            Share your approach, commands and repository link. Your instructor
            will review your submission.
          </p>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              try {
                await submit({ body, file_id: file });
              } finally {
                setSaving(false);
              }
            }}
          >
            <label>
              Answer & explanation
              <textarea
                required={!file}
                rows={7}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Walk us through what you built…"
              />
            </label>
            <FileUpload onUploaded={setFile} accept=".pdf,.docx" />
            <Button disabled={saving} type="submit">
              {saving ? "Submitting…" : "Submit lab"} <ArrowRight size={16} />
            </Button>
          </form>
          {submissions.length > 0 && (
            <>
              <h3 className="spaced">Your submissions</h3>
              {submissions.map((s) => (
                <div className="submission" key={s.id}>
                  <div className="row between">
                    <Badge tone={s.status === "accepted" ? "green" : "amber"}>
                      {s.status.replaceAll("_", " ")}
                    </Badge>
                    <small>{date(s.created)}</small>
                  </div>
                  <p className="prewrap">{s.body}</p>
                  {s.file_id && (
                    <a href={"/api/files/" + s.file_id}>
                      Download your attachment
                    </a>
                  )}
                  {s.drive_url ? (
                    <p>
                      <a href={s.drive_url} target="_blank" rel="noreferrer">
                        Open your submission in Drive ↗
                      </a>
                    </p>
                  ) : s.drive_status !== "not_requested" && s.drive_status ? (
                    <p>Drive transfer: {s.drive_status}</p>
                  ) : null}
                  {s.feedback && (
                    <div className="reply">
                      <b>Instructor feedback</b>
                      <p>{s.feedback}</p>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}

function Quiz({ test, finish, busy }) {
  const key = "arks-attempt-" + test.id;
  const [answers, setAnswers] = useState(() => {
      try {
        return JSON.parse(sessionStorage.getItem(key)) || test.answers || [];
      } catch {
        return test.answers || [];
      }
    }),
    [index, setIndex] = useState(0),
    [remaining, setRemaining] = useState(
      Math.max(0, Math.ceil((new Date(test.expires_at) - Date.now()) / 1000)),
    );
  const expired = useRef(false),
    answersRef = useRef(answers);
  answersRef.current = answers;
  useEffect(() => {
    const t = setInterval(() => {
      const left = Math.max(
        0,
        Math.ceil((new Date(test.expires_at) - Date.now()) / 1000),
      );
      setRemaining(left);
      if (left === 0 && !expired.current) {
        expired.current = true;
        finish(answersRef.current);
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);
  const [saveStatus, setSaveStatus] = useState("");
  useEffect(() => {
    if (!answers.length || busy) return;
    const timer = setTimeout(() => {
      api("tests/save", { attempt_id: test.id, answers })
        .then(() => setSaveStatus("Saved"))
        .catch(() =>
          setSaveStatus(
            "Saved on this device. Check your connection before submitting.",
          ),
        );
    }, 900);
    return () => clearTimeout(timer);
  }, [answers, busy]);
  const q = test.questions[index];
  const answeredCount = test.questions.filter((_, i) =>
    isAnswered(answers[i]),
  ).length;
  return (
    <div className="quiz">
      <div className="row between">
        <Badge tone="blue">
          Question {index + 1} of {test.questions.length} ({answeredCount}{" "}
          answered)
        </Badge>
        <span className={"timer " + (remaining < 60 ? "danger" : "")}>
          <Clock size={16} />
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
        </span>
      </div>
      <div className="quiz-progress">
        <i
          style={{ width: ((index + 1) / test.questions.length) * 100 + "%" }}
        />
      </div>
      {test.questions.length > 1 && (
        <div
          className="question-palette"
          aria-label="Question navigator palette"
        >
          {test.questions.map((_, i) => (
            <button
              key={i}
              type="button"
              className={
                "palette-pill " +
                (i === index
                  ? "current"
                  : isAnswered(answers[i])
                    ? "answered"
                    : "")
              }
              onClick={() => setIndex(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
      <small role="status">{saveStatus}</small>
      <h3>{q.prompt}</h3>
      <p>
        {QUESTION_TYPES[q.type || "mcq"]} · {q.marks} marks
      </p>
      <QuestionInput
        q={q}
        value={answers[index]}
        onChange={(value) => {
          const a = [...answers];
          while (a.length < test.questions.length) a.push(null);
          a[index] = value;
          setAnswers(a);
          sessionStorage.setItem(key, JSON.stringify(a));
        }}
      />
      <div className="row between">
        <Button
          secondary
          disabled={index === 0 || busy}
          onClick={() => setIndex(index - 1)}
        >
          Previous
        </Button>
        {index < test.questions.length - 1 ? (
          <Button onClick={() => setIndex(index + 1)}>
            Next question <ArrowRight size={16} />
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => finish(answers)}>
            {busy ? "Submitting…" : "Submit assessment"}
          </Button>
        )}
      </div>
      <p className="help-note">
        Your timer continues if you close this window. Reopen the test to
        resume. Unanswered questions score zero.
      </p>
    </div>
  );
}

function Result({ result: r, onRefresh }) {
  const summary = r.summary || {};
  return (
    <div className="result">
      <div className="result-summary">
        <div className="result-score">
          {r.grading_status &&
          r.grading_status !== "complete" &&
          r.questions.some(written)
            ? "…"
            : Math.round((r.score / r.total) * 100)}
          <small>%</small>
        </div>
        <h3>
          {r.score / r.total >= 0.7
            ? "You’re building a strong foundation."
            : "Every attempt is a step forward."}
        </h3>
        <p>
          {r.score} / {r.total} marks{" "}
          {r.grading_status !== "complete" && r.questions.some(written)
            ? "(provisional; written answers awaiting grading)"
            : ""}{" "}
          · Review your diagnostic coaching report and answers below.
        </p>
        {r.id && (
          <a className="button secondary" href={"/api/result-pdf/" + r.id}>
            Download branded result PDF
          </a>
        )}
        {r.grading_status !== "complete" && r.grading_status && (
          <p>
            AI feedback: {r.grading_status.replaceAll("_", " ")}{" "}
            <button className="text-btn" onClick={onRefresh}>
              Refresh result
            </button>
          </p>
        )}
        {r.expired && (
          <p className="form-error">
            The submission arrived after the time limit. This attempt scored
            zero.
          </p>
        )}
      </div>

      {(summary.strengths?.length > 0 ||
        summary.improvements?.length > 0 ||
        summary.recommendations?.length > 0) && (
        <div className="diagnostic-coach">
          <div className="two-col">
            {summary.strengths?.length > 0 && (
              <section className="panel">
                <Badge tone="green">KEY STRENGTHS</Badge>
                <ul className="diagnostic-list">
                  {summary.strengths.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
              </section>
            )}
            {summary.improvements?.length > 0 && (
              <section className="panel">
                <Badge tone="amber">AREAS FOR IMPROVEMENT</Badge>
                <ul className="diagnostic-list">
                  {summary.improvements.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          {summary.recommendations?.length > 0 && (
            <section className="panel">
              <Badge tone="blue">
                RECOMMENDED OFFICIAL DOCS, NOTES & VIDEO REFERENCES
              </Badge>
              <div className="recommendations-grid">
                {summary.recommendations.map((rec, idx) => (
                  <div className="recommendation-card" key={idx}>
                    <div className="row between">
                      <b>{rec.title}</b>
                      <Badge>
                        {rec.category === "official_doc"
                          ? "Official Docs"
                          : rec.category === "video"
                            ? "Video / Replay"
                            : "Class Notes"}
                      </Badge>
                    </div>
                    {rec.description && <p>{rec.description}</p>}
                    {rec.url && (
                      <a
                        href={rec.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-btn"
                      >
                        Open reference <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {r.questions.map((q, i) => (
        <div className="answer-review" key={i}>
          <div className="row gap">
            <Badge tone={objectiveCorrect(q, r.answers[i]) ? "green" : "amber"}>
              {written(q)
                ? r.grading_status === "complete"
                  ? "Graded"
                  : "Awaiting grading"
                : objectiveCorrect(q, r.answers[i])
                  ? "Correct"
                  : "Review"}
            </Badge>
            <b>
              Question {i + 1} ·{" "}
              {r.feedback?.[i]?.marks ??
                (written(q)
                  ? "Pending"
                  : objectiveCorrect(q, r.answers[i])
                    ? q.marks
                    : 0)}{" "}
              / {q.marks} marks
            </b>
          </div>
          <h3>{q.prompt}</h3>
          <p className="prewrap">Your answer: {answerText(q, r.answers[i])}</p>
          <p className="green prewrap">
            Model / correct answer: {answerText(q, q.answer, true)}
          </p>
          <p>
            {feedbackText(r.feedback?.[i]) ||
              q.explanation ||
              "Review the class materials for more context."}
          </p>
        </div>
      ))}
    </div>
  );
}

function Editor({ entity, item, data, user, save }) {
  const isHeadAdmin = !user || user.role === "admin";
  const defaults = {
    courses: {
      title: "",
      description: "",
      fee: 0,
      currency: "INR",
      syllabus: JSON.stringify(
        [{ title: "Getting started", detail: "Course introduction" }],
        null,
        2,
      ),
    },
    batches: {
      course_id: data.courses[0]?.id,
      name: "",
      start_date: "",
      end_date: "",
      timezone: "Asia/Kolkata",
      covered: 0,
      status: "upcoming",
    },
    invitations: {
      email: "",
      batch_id: data.batches[0]?.id,
      role: "student",
      fee: 0,
    },
    content: {
      course_id: data.courses[0]?.id,
      batch_id: "",
      kind: "notes",
      title: "",
      topic: "",
      topic_order: 1,
      body: "",
      url: "",
      starts_at: "",
      duration: 60,
      file_id: null,
      published: 1,
    },
    tests: {
      course_id: data.courses[0]?.id,
      title: "",
      kind: "daily",
      topic_order: 1,
      duration: 30,
      published: 1,
      questions: JSON.stringify(
        [
          {
            prompt: "Your question here",
            options: ["First option", "Second option", "Third option"],
            answer: 0,
            explanation: "Explain why this answer is correct.",
          },
        ],
        null,
        2,
      ),
    },
  };
  const [v, setV] = useState(() => {
      const val = { ...defaults[entity], ...item };
      if (entity === "batches")
        val.drive_folder =
          data.automation_sources?.find((s) => s.batch_id === item?.id)
            ?.folder_input || "";
      if (val.fee !== undefined) val.fee = val.fee / 100;
      if (val.starts_at) val.starts_at = val.starts_at.slice(0, 16);
      if (val.questions)
        val.questions = JSON.stringify(JSON.parse(val.questions), null, 2);
      if (val.syllabus)
        val.syllabus = JSON.stringify(JSON.parse(val.syllabus), null, 2);
      return val;
    }),
    [saving, setSaving] = useState(false);
  const courseOpts = data.courses.map((c) => [c.id, c.title]),
    batchOpts = data.batches
      .filter((b) => !v.course_id || b.course_id === v.course_id)
      .map((b) => [b.id, b.name]);
  const field = (
    key,
    label,
    type = "text",
    options = null,
    help = null,
    optional = false,
  ) => (
    <label key={key}>
      {label}
      {options ? (
        <select
          required={!optional}
          value={v[key] ?? ""}
          onChange={(e) =>
            setV({
              ...v,
              [key]: e.target.value,
              ...(key === "course_id" ? { batch_id: "" } : {}),
            })
          }
        >
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea
          required={!optional}
          rows={key === "questions" || key === "syllabus" ? 12 : 5}
          className={
            key === "questions" || key === "syllabus" ? "code-editor" : ""
          }
          value={v[key] ?? ""}
          onChange={(e) => setV({ ...v, [key]: e.target.value })}
        />
      ) : (
        <input
          required={!optional}
          type={type}
          min={type === "number" ? 0 : undefined}
          step={key === "fee" ? "0.01" : undefined}
          value={v[key] ?? ""}
          onChange={(e) => setV({ ...v, [key]: e.target.value })}
        />
      )}{" "}
      {help && <small>{help}</small>}
    </label>
  );
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await save({
            ...v,
            ...(v.starts_at ? { starts_at: v.starts_at + "Z" } : {}),
            ...(v.fee !== undefined
              ? { fee: Math.round(Number(v.fee) * 100) }
              : {}),
          });
        } finally {
          setSaving(false);
        }
      }}
    >
      {entity === "courses" ? (
        <>
          {field("title", "Course title")}
          {field("description", "Description", "textarea")}
          {field("fee", "Default fee (major currency units)", "number")}
          {field(
            "currency",
            "Currency code",
            "text",
            null,
            "Use a three-letter code, such as INR or USD.",
          )}
          <SyllabusBuilder
            value={v.syllabus}
            onChange={(syllabus) => setV({ ...v, syllabus })}
          />
        </>
      ) : entity === "batches" ? (
        <>
          {field("name", "Batch name")}
          {field(
            "drive_folder",
            "Drive folder name or link",
            "text",
            null,
            "Optional: connect this batch’s generated materials. Imports always require trainer/admin approval.",
            true,
          )}
          {field("course_id", "Course", "select", courseOpts)}
          <div className="form-grid">
            {field("start_date", "Start date", "date")}
            {field("end_date", "End date", "date")}
          </div>
          {field(
            "timezone",
            "Timezone",
            "text",
            null,
            "IANA timezone, for example Asia/Kolkata.",
          )}
          {field(
            "covered",
            "Topics covered in class",
            "number",
            null,
            "Assessments up to this topic number become available.",
          )}
          {field("status", "Status", "select", [
            ["upcoming", "Upcoming"],
            ["active", "Active"],
            ["archived", "Archived"],
          ])}
        </>
      ) : entity === "invitations" ? (
        <>
          <div className="info-strip">
            Enrollment is matched to the student’s sign-in email. No email is
            sent automatically.
          </div>
          {field("email", "Sign-in email", "email")}
          {field("batch_id", "Batch", "select", batchOpts)}
          {field(
            "role",
            "Role",
            "select",
            isHeadAdmin
              ? [
                  ["student", "Student"],
                  ["trainer", "Trainer / Instructor"],
                  ["admin", "Head / Administrator"],
                ]
              : [["student", "Student"]],
          )}
          {field(
            "fee",
            "Agreed course fee (major currency units)",
            "number",
            null,
            "Set the actual fee before the student signs in. Existing enrollment fees remain unchanged.",
          )}
        </>
      ) : entity === "content" ? (
        <>
          {field("title", "Resource title")}
          <div className="form-grid">
            {field("kind", "Resource type", "select", Object.entries(kindName))}
            {field("published", "Visibility", "select", [
              [1, "Published"],
              [0, "Draft"],
            ])}
          </div>
          {field("course_id", "Course", "select", courseOpts)}
          {field(
            "batch_id",
            "Batch scope",
            "select",
            [["", "All batches in this course"], ...batchOpts],
            null,
            true,
          )}
          <div className="form-grid">
            {field("topic", "Topic name")}
            {field("topic_order", "Topic number", "number")}
          </div>
          {field(
            "body",
            "Instructions / content",
            "textarea",
            null,
            null,
            true,
          )}
          {field(
            "url",
            "Resource or meeting URL",
            "url",
            null,
            "Use an HTTPS link for video recordings or meetings.",
            true,
          )}
          {v.kind === "live" && (
            <div className="form-grid">
              {field(
                "starts_at",
                "Starts at (UTC)",
                "datetime-local",
                null,
                null,
                true,
              )}
              {field("duration", "Duration (minutes)", "number")}
            </div>
          )}
          <FileUpload onUploaded={(id) => setV({ ...v, file_id: id })} />
          {v.file_id && (
            <p className="green">
              Attachment ready ·{" "}
              <a href={"/api/files/" + v.file_id}>Download</a>{" "}
              <button
                type="button"
                className="text-btn"
                onClick={() => setV({ ...v, file_id: null })}
              >
                Remove attachment
              </button>
            </p>
          )}
        </>
      ) : (
        <>
          {field("title", "Assessment title")}
          {field("course_id", "Course", "select", courseOpts)}
          {field("kind", "Assessment type", "select", [
            ["daily", "Daily"],
            ["weekly", "Weekly"],
            ["monthly", "Monthly"],
          ])}
          <div className="form-grid">
            {field("topic_order", "Unlock after topic", "number")}
            {field("duration", "Duration (minutes)", "number")}
          </div>
          {field("published", "Visibility", "select", [
            [1, "Published"],
            [0, "Draft"],
          ])}
          <MixedQuestionBuilder
            value={v.questions}
            onChange={(questions) => setV({ ...v, questions })}
          />
        </>
      )}
      <Button type="submit" disabled={saving}>
        {saving
          ? "Saving…"
          : "Save " +
            {
              invitations: "enrollment",
              content: "resource",
              tests: "assessment",
              batches: "batch",
              courses: "course",
            }[entity]}
        <Check size={16} />
      </Button>
    </form>
  );
}

function PaymentForm({ data, save }) {
  const options = data.enrollments.map((e) => ({
    value: e.id,
    label: `${data.users.find((u) => u.id === e.user_id)?.name} · ${data.batches.find((b) => b.id === e.batch_id)?.name} · fee ${e.fee / 100}`,
  }));
  return (
    <>
      <p>
        Record a payment received outside the app. Use the bank or payment
        provider reference to prevent duplicates.
      </p>
      <SimpleForm
        fields={[
          ["enrollment_id", "Student enrollment", "select", options],
          ["amount", "Amount (major currency units)", "number"],
          ["reference", "Unique payment reference", "text"],
          ["paid_at", "Payment date", "date"],
        ]}
        save={(v) => save({ ...v, amount: Math.round(Number(v.amount) * 100) })}
        label="Record payment"
      />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);

function SyllabusBuilder({ value, onChange }) {
  const items = JSON.parse(value),
    update = (i, key, val) =>
      onChange(
        JSON.stringify(
          items.map((s, n) => (n === i ? { ...s, [key]: val } : s)),
        ),
      );
  return (
    <div className="builder">
      <h3>Course roadmap</h3>
      <p>Add the topics in the order your students will learn them.</p>
      {items.map((s, i) => (
        <div className="builder-item" key={i}>
          <div className="row between">
            <Badge tone="blue">Topic {i + 1}</Badge>
            <button
              type="button"
              className="text-btn"
              disabled={items.length === 1}
              onClick={() =>
                onChange(JSON.stringify(items.filter((_, n) => n !== i)))
              }
            >
              Remove
            </button>
          </div>
          <label>
            Topic name
            <input
              required
              value={s.title}
              onChange={(e) => update(i, "title", e.target.value)}
            />
          </label>
          <label>
            What students will learn
            <textarea
              required
              rows={2}
              value={s.detail}
              onChange={(e) => update(i, "detail", e.target.value)}
            />
          </label>
        </div>
      ))}
      <Button
        secondary
        type="button"
        onClick={() =>
          onChange(JSON.stringify([...items, { title: "", detail: "" }]))
        }
      >
        <Plus size={15} /> Add topic
      </Button>
    </div>
  );
}
