// The shared API uses this small parameterized SQLite-compatible SQL subset.
// PostgreSQL supports its joins, CASE expressions, LIMIT and ON CONFLICT clauses.
export function compilePostgres(source, args = []) {
  let index = 0,
    text = "",
    i = 0;
  while (i < source.length) {
    if (source[i] === "'") {
      let end = i + 1;
      while (end < source.length) {
        if (source[end] === "'" && source[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (source[end++] === "'") break;
      }
      text += source.slice(i, end);
      i = end;
    } else if (source[i] === "?") {
      text += "$" + ++index;
      i++;
    } else text += source[i++];
  }
  if (index !== args.length) throw Error("SQL parameter count mismatch");
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(text)) {
    text =
      text
        .replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, "INSERT INTO")
        .replace(/;\s*$/, "") + " ON CONFLICT DO NOTHING";
  }
  if (/^\s*INSERT\s+INTO\s+auth_limits\b/i.test(text)) {
    const split = text.indexOf("DO UPDATE SET");
    if (split >= 0)
      text =
        text.slice(0, split) +
        text
          .slice(split)
          .replace(
            /(?<![.\w])\b(reset_at|attempts)\b(?!\s*=)/g,
            "auth_limits.$1",
          );
  }
  return { text, values: args };
}
