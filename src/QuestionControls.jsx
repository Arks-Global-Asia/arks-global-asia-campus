import React from "react";
import { QUESTION_TYPES } from "../shared/assessment.js";
export function QuestionInput({ q, value, onChange }) {
  const t = q.type || "mcq";
  if (["mcq", "true_false", "multi_select"].includes(t))
    return (
      <div className="quiz-options">
        {q.options.map((o, i) => {
          const selected =
            t === "multi_select" ? (value || []).includes(i) : value === i;
          return (
            <button
              key={i}
              type="button"
              className={selected ? "selected" : ""}
              aria-pressed={selected}
              onClick={() =>
                onChange(
                  t === "multi_select"
                    ? selected
                      ? value.filter((v) => v !== i)
                      : [...(value || []), i]
                    : i,
                )
              }
            >
              <span>{String.fromCharCode(65 + i)}</span>
              {o}
              {selected && " ✓"}
            </button>
          );
        })}
      </div>
    );
  if (t === "matching" || t === "ordering")
    return (
      <div className="form">
        {q.options.map((option, i) => (
          <label key={i}>
            {t === "matching" ? option : "Position " + (i + 1)}
            <select
              value={value?.[i] ?? -1}
              onChange={(e) => {
                const next = [...(value || q.options.map(() => -1))];
                const selected = Number(e.target.value);
                for (let j = 0; j < next.length; j++)
                  if (j !== i && next[j] === selected) next[j] = -1;
                next[i] = selected;
                onChange(next);
              }}
            >
              <option value={-1}>Choose an answer</option>
              {(t === "matching" ? q.matches : q.options).map((o, n) => (
                <option key={n} value={n}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  return (
    <label className="written-answer">
      {QUESTION_TYPES[t]}
      {t === "fill_blank" || t === "numeric" ? (
        <input
          aria-label="Your answer"
          inputMode={t === "numeric" ? "decimal" : "text"}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          maxLength={20000}
        />
      ) : (
        <textarea
          aria-label="Your answer"
          className={t === "code" ? "code-answer" : ""}
          rows={t === "short_answer" ? 5 : 12}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          maxLength={20000}
          spellCheck={t !== "code"}
          placeholder={
            t === "code"
              ? "Write your commands, configuration or code. Explain how you would verify the result."
              : "Write your answer and explain your reasoning…"
          }
        />
      )}
      <small>
        {t === "code"
          ? "Code is evaluated as a written solution; it is not executed."
          : "Your answer is saved while you work."}
      </small>
    </label>
  );
}
export function MixedQuestionBuilder({ value, onChange }) {
  const qs = JSON.parse(value);
  const update = (i, p) =>
    onChange(JSON.stringify(qs.map((q, n) => (n === i ? { ...q, ...p } : q))));
  function changeType(i, type) {
    const options =
      type === "true_false" ? ["True", "False"] : ["Option A", "Option B"];
    update(i, {
      type,
      options: [
        "mcq",
        "multi_select",
        "true_false",
        "matching",
        "ordering",
      ].includes(type)
        ? options
        : undefined,
      matches: type === "matching" ? ["Match A", "Match B"] : undefined,
      answer: ["multi_select"].includes(type)
        ? [0]
        : ["matching", "ordering"].includes(type)
          ? [0, 1]
          : ["mcq", "true_false"].includes(type)
            ? 0
            : "",
      accepted_answers: type === "fill_blank" ? [""] : undefined,
      rubric: "",
      tolerance: 0,
    });
  }
  return (
    <div className="builder">
      <h3>Your question bank</h3>
      <p>
        Weights are normalized to exactly 100 marks. Written questions require a
        model answer and a grading rubric.
      </p>
      {qs.map((q, i) => (
        <section className="builder-item" key={i}>
          <div className="row between">
            <b>Question {i + 1}</b>
            <button
              className="text-btn"
              type="button"
              disabled={qs.length === 1}
              onClick={() =>
                onChange(JSON.stringify(qs.filter((_, n) => n !== i)))
              }
            >
              Remove question
            </button>
          </div>
          <label>
            Question type
            <select
              value={q.type || "mcq"}
              onChange={(e) => changeType(i, e.target.value)}
            >
              {Object.entries(QUESTION_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Relative weight
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={q.marks || 1}
              onChange={(e) => update(i, { marks: Number(e.target.value) })}
            />
          </label>
          <label>
            Question
            <textarea
              required
              value={q.prompt}
              onChange={(e) => update(i, { prompt: e.target.value })}
            />
          </label>
          {q.options && (
            <>
              <label>
                Options / left-hand items (one per line)
                <textarea
                  required
                  value={q.options.join("\n")}
                  onChange={(e) =>
                    update(i, { options: e.target.value.split("\n") })
                  }
                />
              </label>
              {q.type === "matching" && (
                <label>
                  Right-hand matches (one per line)
                  <textarea
                    required
                    value={(q.matches || []).join("\n")}
                    onChange={(e) =>
                      update(i, { matches: e.target.value.split("\n") })
                    }
                  />
                </label>
              )}
              <label>
                {Array.isArray(q.answer)
                  ? "Correct zero-based indexes, separated by commas"
                  : "Correct option index (first option = 0)"}
                <input
                  required
                  value={
                    Array.isArray(q.answer) ? q.answer.join(",") : q.answer
                  }
                  onChange={(e) =>
                    update(i, {
                      answer: ["matching", "ordering", "multi_select"].includes(
                        q.type,
                      )
                        ? e.target.value.split(",").map(Number)
                        : Number(e.target.value),
                    })
                  }
                />
              </label>
            </>
          )}
          {q.type === "fill_blank" ? (
            <label>
              Accepted answers (one per line)
              <textarea
                required
                value={(q.accepted_answers || []).join("\n")}
                onChange={(e) =>
                  update(i, { accepted_answers: e.target.value.split("\n") })
                }
              />
            </label>
          ) : (
            !q.options && (
              <>
                <label>
                  Model answer
                  <textarea
                    required
                    value={q.answer || ""}
                    onChange={(e) => update(i, { answer: e.target.value })}
                  />
                </label>
                {q.type === "numeric" ? (
                  <label>
                    Numerical tolerance
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={q.tolerance || 0}
                      onChange={(e) =>
                        update(i, { tolerance: Number(e.target.value) })
                      }
                    />
                  </label>
                ) : (
                  <label>
                    Grading rubric
                    <textarea
                      required
                      value={q.rubric || ""}
                      onChange={(e) => update(i, { rubric: e.target.value })}
                      placeholder="Credit for key concepts, correct commands, reasoning and verification…"
                    />
                  </label>
                )}
              </>
            )
          )}
          <label>
            Explanation / revision notes
            <textarea
              value={q.explanation || ""}
              onChange={(e) => update(i, { explanation: e.target.value })}
            />
          </label>
        </section>
      ))}
      <button
        className="button secondary"
        type="button"
        onClick={() =>
          onChange(
            JSON.stringify([
              ...qs,
              {
                type: "mcq",
                prompt: "",
                options: ["", ""],
                answer: 0,
                marks: 1,
              },
            ]),
          )
        }
      >
        Add question
      </button>
    </div>
  );
}
