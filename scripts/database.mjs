import initSqlJs from "sql.js";
import fs from "node:fs/promises";
export async function database(filename) {
  const SQL = await initSqlJs();
  let bytes;
  try {
    if (filename) bytes = await fs.readFile(filename);
  } catch {}
  const sqlite = new SQL.Database(bytes);
  sqlite.run("PRAGMA foreign_keys=ON");
  if (!bytes) {
    for (const file of (await fs.readdir("drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      sqlite.run(await fs.readFile("drizzle/" + file, "utf8"));
  } else {
    const alters = [
      "ALTER TABLE attempts ADD summary text DEFAULT '{}' NOT NULL",
      "ALTER TABLE tickets ADD category text DEFAULT 'academic' NOT NULL",
      "ALTER TABLE tickets ADD messages text DEFAULT '[]' NOT NULL",
      "ALTER TABLE automation_sources ADD config text DEFAULT '{}' NOT NULL",
      "ALTER TABLE import_items ADD class_date text DEFAULT '' NOT NULL",
    ];
    for (const sql of alters) {
      try {
        sqlite.run(sql);
      } catch {}
    }
  }
  let pending = Promise.resolve();
  async function persist() {
    if (filename) {
      const data = sqlite.export();
      pending = pending.then(async () => {
        await fs.mkdir(".local", { recursive: true });
        await fs.writeFile(filename, data);
      });
      await pending;
    }
  }
  class Statement {
    constructor(sql, args = []) {
      this.sql = sql;
      this.args = args;
    }
    bind(...args) {
      return new Statement(this.sql, args);
    }
    async all() {
      const s = sqlite.prepare(this.sql);
      try {
        s.bind(this.args);
        const results = [];
        while (s.step()) results.push(s.getAsObject());
        return { results };
      } finally {
        s.free();
      }
    }
    async first() {
      return (await this.all()).results[0] || null;
    }
    async run() {
      sqlite.run(this.sql, this.args);
      const changes = sqlite.getRowsModified();
      await persist();
      return { success: true, meta: { changes } };
    }
  }
  return {
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      sqlite.run("BEGIN");
      try {
        const result = [];
        for (const s of statements) {
          sqlite.run(s.sql, s.args);
          result.push({ success: true });
        }
        sqlite.run("COMMIT");
        await persist();
        return result;
      } catch (e) {
        sqlite.run("ROLLBACK");
        throw e;
      }
    },
    close: () => sqlite.close(),
  };
}
export function memoryBucket() {
  const files = new Map();
  return {
    async put(k, v) {
      files.set(k, v);
    },
    async get(k) {
      const b = files.get(k);
      return b ? { body: b } : null;
    },
    async delete(k) {
      files.delete(k);
    },
  };
}
