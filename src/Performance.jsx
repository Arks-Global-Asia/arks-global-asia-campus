import React, { useEffect, useState } from "react";
import { request } from "./Features.jsx";
export default function Performance({ batchId, viewResult }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState("all"),
    [topic, setTopic] = useState("all"),
    [filter, setFilter] = useState("all");
  useEffect(() => {
    let active = true;
    request("performance?batch=" + encodeURIComponent(batchId))
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [batchId]);
  if (!data)
    return (
      <section className="panel">
        {error || "Loading your performance…"}
      </section>
    );
  const attempts = data.attempts.filter(
      (a) => selected === "all" || a.id === selected,
    ),
    graded = attempts.filter(
      (a) => a.grading_status === "complete" || !a.grading_status,
    );
  const questions = attempts.flatMap((a) =>
    a.questions.map((q) => ({
      ...q,
      test: a.title,
      attempt: a.id,
      pending: a.grading_status && a.grading_status !== "complete",
    })),
  );
  const groups = new Map();
  for (const q of questions.filter((q) => !q.pending && q.marks !== null)) {
    const key = q.topic + " / " + q.subtopic;
    const g = groups.get(key) || {
      topic: q.topic,
      subtopic: q.subtopic,
      earned: 0,
      total: 0,
      count: 0,
    };
    g.earned += q.marks;
    g.total += q.max_marks;
    g.count++;
    groups.set(key, g);
  }
  const total = graded.reduce((s, a) => s + a.total, 0),
    score = graded.reduce((s, a) => s + a.score, 0);
  const visible = questions.filter(
    (q) =>
      (topic === "all" || q.topic === topic) &&
      (filter === "all" ||
        (filter === "improve" && !q.pending && q.marks < q.max_marks) ||
        (filter === "correct" && !q.pending && q.marks === q.max_marks) ||
        (filter === "pending" && q.pending)),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR LEARNING SIGNALS</div>
          <h1>Results & performance</h1>
          <p>
            See your progress, revisit answers and choose what to practise next.
          </p>
        </div>
      </div>
      <div className="filter-bar">
        <label>
          Assessment
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setTopic("all");
            }}
          >
            <option value="all">Overall performance</option>
            {data.attempts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="metrics-grid">
        <section className="panel">
          <p>Weighted performance</p>
          <h2>{total ? Math.round((score / total) * 100) + "%" : "—"}</h2>
          <small>Finalized assessments only</small>
        </section>
        <section className="panel">
          <p>Completed tests</p>
          <h2>{graded.length}</h2>
        </section>
        <section className="panel">
          <p>Awaiting evaluation</p>
          <h2>{attempts.length - graded.length}</h2>
        </section>
      </div>
      <section className="panel">
        <h2>Topic grip</h2>
        <p>Based on assessed answers, rather than a prediction of mastery.</p>
        {[...groups.values()].map((g) => (
          <div key={g.topic + g.subtopic} className="skill-row">
            <div>
              <b>{g.topic}</b>
              <small>
                {g.subtopic} · {g.count} questions
              </small>
            </div>
            <progress max="100" value={(g.earned / g.total) * 100} />
            <span>
              {Math.round((g.earned / g.total) * 100)}% ·{" "}
              {g.earned / g.total >= 0.8
                ? "Strength"
                : g.earned / g.total >= 0.7
                  ? "Developing"
                  : "Practise next"}
            </span>
          </div>
        ))}
        {!groups.size && <p>Your topic breakdown appears after evaluation.</p>}
      </section>
      <section className="panel">
        <h2>Your tests</h2>
        {attempts.map((a) => (
          <div className="row between wrap" key={a.id}>
            <div>
              <h3>{a.title}</h3>
              <p>
                {a.grading_status === "complete"
                  ? a.score + " / " + a.total
                  : "Evaluation: " + a.grading_status}
              </p>
            </div>
            <div className="row gap">
              <button
                className="button secondary"
                onClick={() => viewResult(a.id)}
              >
                Review answers
              </button>
              <a className="text-btn" href={"/api/result-pdf/" + a.id}>
                Download PDF
              </a>
            </div>
          </div>
        ))}
        {!attempts.length && (
          <p>Submit your first assessment to see results here.</p>
        )}
      </section>
      <section className="panel">
        <h2>Answer insights</h2>
        <div className="filter-bar wrap">
          <select
            aria-label="Filter results by topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          >
            <option value="all">All topics</option>
            {[...new Set(questions.map((q) => q.topic))].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            aria-label="Filter question outcome"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All answers</option>
            <option value="improve">Where to improve</option>
            <option value="correct">Full marks</option>
            <option value="pending">Awaiting evaluation</option>
          </select>
        </div>
        {visible.map((q) => (
          <details key={q.attempt + ":" + q.number} className="answer-review">
            <summary>
              Q{q.number} · {q.prompt}{" "}
              <small>
                {q.pending ? "Pending" : q.marks + " / " + q.max_marks}
              </small>
            </summary>
            <p>
              {q.test} · {q.topic} · {q.subtopic}
            </p>
            <p>{q.explanation || "Evaluation feedback is pending."}</p>
            <div className="resource-links">
              {q.resources.map((r, i) => (
                <a key={i} href={r.url} target="_blank" rel="noreferrer">
                  {r.title} ↗
                </a>
              ))}
              {q.official_links.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  Official documentation · {new URL(url).hostname} ↗
                </a>
              ))}
            </div>
          </details>
        ))}
      </section>
    </>
  );
}
