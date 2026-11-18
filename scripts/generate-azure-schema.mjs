import fs from "node:fs/promises";
import { database } from "./database.mjs";
const db = await database(),
  meta = { tables: {} };
const q = (x) => '"' + x.replaceAll('"', '""') + '"';
const ddl = ['CREATE SCHEMA IF NOT EXISTS "arks";'];
const tables = (
  await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
).results;
for (const { name } of tables) {
  const cols = (await db.prepare("PRAGMA table_info(" + name + ")").all())
    .results;
  const pk = cols
    .filter((c) => c.pk)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  const indexes = [];
  for (const idx of (await db.prepare("PRAGMA index_list(" + name + ")").all())
    .results) {
    if (idx.name.startsWith("sqlite_")) continue;
    const names = (
      await db.prepare("PRAGMA index_info(" + idx.name + ")").all()
    ).results.map((c) => c.name);
    const def = await db
      .prepare("SELECT sql FROM sqlite_master WHERE name=?")
      .bind(idx.name)
      .first();
    indexes.push({
      name: idx.name,
      columns: names,
      unique: !!idx.unique,
      filter: def.sql.match(/\bWHERE\s+([\s\S]+)$/i)?.[1] || null,
    });
  }
  const columns = cols.map((c) => ({
    ...c,
    type:
      c.name === "score" || (name === "attempts" && c.name === "total")
        ? "NUMERIC(10,2)"
        : c.type.toLowerCase() === "integer"
          ? ["reset_at", "fee", "amount", "size"].includes(c.name)
            ? "BIGINT"
            : "INTEGER"
          : "TEXT",
  }));
  meta.tables[name] = {
    columns,
    indexes,
    foreignKeys: (
      await db.prepare("PRAGMA foreign_key_list(" + name + ")").all()
    ).results,
  };
  const fields = columns.map(
    (c) =>
      q(c.name) +
      " " +
      c.type +
      (c.notnull || c.pk ? " NOT NULL" : "") +
      (c.dflt_value !== null ? " DEFAULT " + c.dflt_value : ""),
  );
  if (pk.length) fields.push("PRIMARY KEY (" + pk.map(q).join(",") + ")");
  ddl.push(
    'CREATE TABLE IF NOT EXISTS "arks".' +
      q(name) +
      " (\n  " +
      fields.join(",\n  ") +
      "\n);",
  );
}
for (const [name, table] of Object.entries(meta.tables)) {
  for (const i of table.indexes)
    ddl.push(
      "CREATE " +
        (i.unique ? "UNIQUE " : "") +
        "INDEX IF NOT EXISTS " +
        q(i.name) +
        ' ON "arks".' +
        q(name) +
        " (" +
        i.columns.map(q).join(",") +
        ")" +
        (i.filter ? " WHERE " + i.filter : "") +
        ";",
    );
  for (const f of table.foreignKeys) {
    const constraint = "fk_" + name + "_" + f.from;
    ddl.push(
      "DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='" +
        constraint +
        "' AND n.nspname='arks') THEN ALTER TABLE \"arks\"." +
        q(name) +
        " ADD CONSTRAINT " +
        q(constraint) +
        " FOREIGN KEY (" +
        q(f.from) +
        ') REFERENCES "arks".' +
        q(f.table) +
        " (" +
        q(f.to) +
        "); END IF; END $migration$;",
    );
  }
}
await fs.mkdir("azure/portal", { recursive: true });
await fs.writeFile(
  "azure/portal/schema.json",
  JSON.stringify(meta, null, 2) + "\n",
);
await fs.writeFile(
  "azure/portal/schema.sql",
  "-- PostgreSQL initial schema; run explicitly, never from HTTP requests.\n\n" +
    ddl.join("\n\n") +
    "\n",
);
console.log("Generated PostgreSQL schema for " + tables.length + " tables.");
