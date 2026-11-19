import React from "react";
import { DraftForm, useDraftState } from "./Drafts.jsx";
export function AssessmentAutomation({ batch, course, save, pending }) {
  const cfg = JSON.parse(batch.config || "{}"),
    initial = cfg.assessment_automation || {};
  const [mapping, setMapping] = useDraftState(
    "assessment-map:" + batch.id,
    JSON.stringify(initial.lesson_topics || {}, null, 2),
  );
  const roadmap = cfg.roadmap?.length
    ? cfg.roadmap
    : JSON.parse(course?.syllabus || "[]");
  const [error, setError] = React.useState("");
  return (
    <DraftForm
      className="panel form"
      draftKey={"auto-tests:" + batch.id}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const f = new FormData(e.target),
            lesson_topics = JSON.parse(mapping);
          const result = await save("admin/batch-config", {
            ...cfg,
            batch_id: batch.id,
            assessment_automation: {
              enabled: f.has("enabled"),
              auto_publish: f.has("auto_publish"),
              required_kinds: f.getAll("required_kind"),
              question_count: Number(f.get("count")),
              week_size: Number(f.get("week_size")),
              lesson_topics,
              completed_topics: f.getAll("completed_topic"),
            },
          });
          if (result) setError("");
        } catch {
          setError(
            "Use a JSON object mapping class numbers to exact SOP topic names.",
          );
        }
      }}
    >
      <h3>Automatic assessments</h3>
      <p>
        Approval of a complete class pack automatically queues a daily test.
        Complete groups of classes queue weekly tests. Topic tests use exact SOP
        mappings and wait until a later mapped topic is published, or you mark
        the final topic complete.
      </p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={initial.enabled !== false}
        />{" "}
        Generate automatically after approval
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          name="auto_publish"
          defaultChecked={initial.auto_publish !== false}
        />{" "}
        Publish generated tests after schema and 100-mark validation
      </label>
      <fieldset>
        <legend>Required materials per class</legend>
        {["recording", "notes", "slides", "guide", "lab"].map((kind) => (
          <label className="checkbox-row" key={kind}>
            <input
              type="checkbox"
              name="required_kind"
              value={kind}
              defaultChecked={(
                initial.required_kinds || [
                  "recording",
                  "notes",
                  "slides",
                  "lab",
                ]
              ).includes(kind)}
            />
            {kind}
          </label>
        ))}
      </fieldset>
      <div className="two-col">
        <label>
          Questions per test
          <input
            name="count"
            type="number"
            min="11"
            max="100"
            defaultValue={initial.question_count || 12}
          />
        </label>
        <label>
          Classes per weekly test
          <input
            name="week_size"
            type="number"
            min="1"
            max="30"
            defaultValue={initial.week_size || 7}
          />
        </label>
      </div>
      <label>
        Class number → exact SOP topic
        <textarea
          rows={6}
          value={mapping}
          onChange={(e) => setMapping(e.target.value)}
          placeholder={'{"1":"Git","2":"Git","3":"Jenkins"}'}
        />
      </label>
      <fieldset>
        <legend>
          Completed topics · use for the final topic or an explicit curriculum
          milestone
        </legend>
        {roadmap.map((r, i) => (
          <label className="checkbox-row" key={i}>
            <input
              type="checkbox"
              name="completed_topic"
              value={r.title}
              defaultChecked={(initial.completed_topics || []).includes(
                r.title,
              )}
            />
            {r.title}
          </label>
        ))}
      </fieldset>
      <small>
        Images need extracted/OCR text, and videos need notes or transcripts.
        The model does not watch videos or read image pixels. Failed jobs remain
        visible for retry. Each generated test totals 100 marks and allows one
        attempt.
      </small>
      {error && <p className="form-error">{error}</p>}
      <div className="row gap">
        <button className="button" disabled={pending}>
          Save automation policy
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={pending}
          onClick={() => save("admin/plan-assessments", { batch_id: batch.id })}
        >
          Check approved materials now
        </button>
      </div>
    </DraftForm>
  );
}
