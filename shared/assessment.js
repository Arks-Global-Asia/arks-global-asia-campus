export const QUESTION_TYPES = {
  mcq: "Multiple choice",
  multi_select: "Multiple select",
  true_false: "True / false",
  fill_blank: "Fill in the blank",
  numeric: "Numerical answer",
  short_answer: "Short answer",
  essay: "Long answer / essay",
  scenario: "Scenario / troubleshooting",
  code: "Code / practical commands",
  matching: "Match the following",
  ordering: "Arrange in order",
};
export const written = (q) =>
  ["short_answer", "essay", "scenario", "code"].includes(q.type);
export function validQuestion(q) {
  if (
    q?.marks !== undefined &&
    (!Number.isFinite(Number(q.marks)) ||
      Number(q.marks) <= 0 ||
      Number(q.marks) > 10000)
  )
    return false;
  if (
    !q ||
    typeof q.prompt !== "string" ||
    !q.prompt.trim() ||
    q.prompt.length > 12000 ||
    !QUESTION_TYPES[q.type || "mcq"]
  )
    return false;
  const type = q.type || "mcq";
  if (written(q))
    return (
      typeof q.answer === "string" &&
      q.answer.length > 0 &&
      typeof q.rubric === "string" &&
      q.rubric.length > 0
    );
  if (type === "numeric")
    return (
      Number.isFinite(Number(q.answer)) &&
      String(q.answer).trim() !== "" &&
      (!q.tolerance || Number(q.tolerance) >= 0)
    );
  if (type === "fill_blank")
    return (
      Array.isArray(q.accepted_answers) &&
      q.accepted_answers.length > 0 &&
      q.accepted_answers.every((a) => typeof a === "string" && a.trim())
    );
  if (
    !Array.isArray(q.options) ||
    q.options.length < 2 ||
    q.options.length > 10 ||
    q.options.some((o) => typeof o !== "string" || !o.trim())
  )
    return false;
  if (type === "true_false" && q.options.length !== 2) return false;
  if (["multi_select", "matching", "ordering"].includes(type)) {
    if (
      !Array.isArray(q.answer) ||
      !q.answer.length ||
      q.answer.some(
        (i) => !Number.isInteger(i) || i < 0 || i >= q.options.length,
      ) ||
      new Set(q.answer).size !== q.answer.length
    )
      return false;
    if (type !== "multi_select" && q.answer.length !== q.options.length)
      return false;
    return (
      type !== "matching" ||
      (Array.isArray(q.matches) &&
        q.matches.length === q.options.length &&
        q.matches.every((m) => typeof m === "string" && m))
    );
  }
  return (
    Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length
  );
}
export function normalizeQuestions(qs) {
  const weights = qs.map((q) => (Number(q.marks) > 0 ? Number(q.marks) : 1)),
    sum = weights.reduce((a, b) => a + b, 0),
    units = weights.map((w) => Math.floor((w / sum) * 10000));
  for (let n = 10000 - units.reduce((a, b) => a + b, 0), i = 0; n > 0; n--, i++)
    units[i % units.length]++;
  return qs.map((q, i) => ({
    ...q,
    type: q.type || "mcq",
    marks: units[i] / 100,
  }));
}
export function publicQuestion(q) {
  return {
    prompt: q.prompt,
    type: q.type || "mcq",
    marks: q.marks,
    options: q.options,
    matches: q.matches,
  };
}
export function validAnswer(q, a) {
  if (a === null || a === undefined || a === "") return true;
  const t = q.type || "mcq";
  if (["multi_select", "matching", "ordering"].includes(t))
    return (
      Array.isArray(a) &&
      a.length <= q.options.length &&
      a.every((i) => Number.isInteger(i) && i >= -1 && i < q.options.length) &&
      new Set(a.filter((i) => i >= 0)).size === a.filter((i) => i >= 0).length
    );
  if (["mcq", "true_false"].includes(t))
    return Number.isInteger(a) && a >= 0 && a < q.options.length;
  return typeof a === "string" && a.length <= 20000;
}
export function objectiveCorrect(q, a) {
  if (a === null || a === undefined || a === "") return false;
  const t = q.type || "mcq";
  if (written(q)) return false;
  if (t === "numeric")
    return (
      Number.isFinite(Number(a)) &&
      Math.abs(Number(a) - Number(q.answer)) <= Number(q.tolerance || 0)
    );
  if (t === "fill_blank")
    return q.accepted_answers.some(
      (x) => x.trim().toLowerCase() === String(a).trim().toLowerCase(),
    );
  if (t === "multi_select")
    return (
      Array.isArray(a) &&
      JSON.stringify([...a].sort()) === JSON.stringify([...q.answer].sort())
    );
  if (t === "ordering" || t === "matching")
    return JSON.stringify(a) === JSON.stringify(q.answer);
  return a === q.answer;
}
export function answerText(q, a, correct = false) {
  if (correct && q.type === "fill_blank") return q.accepted_answers.join(" / ");
  if (a === null || a === undefined || a === "") return "Not answered";
  if (q.type === "matching")
    return q.options
      .map((left, i) => left + " → " + (q.matches[a[i]] || "Not matched"))
      .join("; ");
  if (Array.isArray(a))
    return a
      .map((i) => q.options?.[i] || "Not answered")
      .join(q.type === "ordering" ? " → " : ", ");
  if (q.options) return q.options[a] || "Not answered";
  return String(a);
}
export function feedbackText(v) {
  return typeof v === "string" ? v : v?.feedback || "";
}
