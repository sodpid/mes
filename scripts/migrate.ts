import { pool, Database } from "../apps/api/src/db.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export async function migrate(db: Database = pool, directory = "db/mysql-bigint") {
  const c = await db.connect();
  try {
    await c.lock("schema-migrations");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version VARCHAR(200) COLLATE utf8mb4_0900_bin PRIMARY KEY,checksum CHAR(64) NOT NULL,state ENUM('APPLYING','APPLIED','FAILED') NOT NULL,executed_steps INT NOT NULL DEFAULT 0,error_step INT,applied_at DATETIME(6)) ENGINE=InnoDB",
    );
    const migrationFiles=(await readdir(directory)).filter(x=>x.endsWith(".json")).sort();
    const applied=(await c.query("SELECT version FROM schema_migrations")).rows;
    if(applied.some(row=>!migrationFiles.includes(row.version)))throw new Error("迁移系谱不兼容，禁止混用旧UUID与BIGINT基线");
    for (const file of migrationFiles) {
      const source = await readFile(directory + "/" + file, "utf8");
      const checksum = createHash("sha256").update(source).digest("hex");
      const migration = JSON.parse(source.replace(/^\uFEFF/, ""));
      const old = (
        await c.query("SELECT * FROM schema_migrations WHERE version=?", [file])
      ).rows[0];
      if (old) {
        if (old.checksum !== checksum)
          throw new Error("迁移checksum不一致：" + file);
        if (old.state !== "APPLIED")
          throw new Error(
            `迁移${file}处于${old.state}，已执行${old.executed_steps}步；需人工检查，不自动重放`,
          );
        continue;
      }
      await c.query(
        "INSERT INTO schema_migrations(version,checksum,state) VALUES(?,?,'APPLYING')",
        [file, checksum],
      );
      for (let i = 0; i < migration.statements.length; i++) {
        try {
          await c.query(migration.statements[i]);
          await c.query(
            "UPDATE schema_migrations SET executed_steps=? WHERE version=?",
            [i + 1, file],
          );
        } catch (e) {
          await c.query(
            "UPDATE schema_migrations SET state='FAILED',error_step=? WHERE version=?",
            [i + 1, file],
          );
          throw new Error(
            `迁移${file}第${i + 1}步失败，已停止；错误码${(e as any).code || "UNKNOWN"}`,
          );
        }
      }
      await c.query(
        "UPDATE schema_migrations SET state='APPLIED',applied_at=UTC_TIMESTAMP(6) WHERE version=?",
        [file],
      );
      console.log("MySQL迁移已核验 " + file);
    }
  } finally {
    await c.release();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  migrate()
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
