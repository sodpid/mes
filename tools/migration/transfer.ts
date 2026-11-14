import { config, parse } from "dotenv";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
import { execFileSync } from "node:child_process";
import net from "node:net";
config({ path: ".env.mysql", override: true, quiet: true });
const { Database, pool } = await import("../../apps/api/src/db.js");
const { migrate } = await import("../../scripts/migrate.js");
const tables = [
  "users",
  "sessions",
  "companies",
  "factories",
  "partners",
  "partner_roles",
  "warehouses",
  "locations",
  "units",
  "material_categories",
  "materials",
  "material_units",
  "material_factory_policies",
  "material_inspection_policies",
  "user_company_scopes",
  "user_factory_scopes",
  "audit_logs",
];
const home = "artifacts/mysql-switch";
export function localUrl(
  value: string | undefined,
  protocol: string,
  port: string,
  database: string,
) {
  if (!value) throw new Error("缺少数据库配置");
  const u = new URL(value);
  if (
    u.protocol !== protocol ||
    !["127.0.0.1", "localhost"].includes(u.hostname) ||
    u.port !== port ||
    decodeURIComponent(u.pathname) !== "/" + database
  )
    throw new Error("拒绝操作非专属本地数据库");
  return u;
}
function validateTargets() {
  localUrl(process.env.DATABASE_URL, "mysql:", "33079", "mes");
  localUrl(process.env.MYSQL_ADMIN_URL, "mysql:", "33079", "mes");
}
async function sourceUrl() {
  const old = parse(await fs.readFile(home + "/rollback/.env"));
  localUrl(old.DATABASE_URL, "postgresql:", "54329", "mes");
  return old.DATABASE_URL;
}
async function assertFrozen() {
  const listening = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: 18080 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
  if (listening) throw new Error("拒绝最终迁移：18080应用仍在运行");
  const source = new pg.Pool({ connectionString: await sourceUrl() });
  try {
    const r = await source.query(
      "SELECT count(*)::int count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()",
    );
    if (r.rows[0].count !== 0)
      throw new Error("拒绝最终迁移：源库仍有其他连接");
  } finally {
    await source.end();
  }
  const info = JSON.parse(
    execFileSync("docker", ["inspect", "mes-local-db-1"], { encoding: "utf8" }),
  )[0];
  if (
    info.Config.Labels?.["com.docker.compose.project"] !== "mes-local" ||
    info.Config.Labels?.["com.docker.compose.service"] !== "db" ||
    !info.Mounts.some((m: any) => m.Name === "mes-local_mes_pgdata") ||
    !info.NetworkSettings.Ports["5432/tcp"]?.some(
      (p: any) =>
        p.HostPort === "54329" && ["127.0.0.1", "::1"].includes(p.HostIp),
    )
  )
    throw new Error("源容器身份与已授权本地PG不符");
  const identity = execFileSync(
    "docker",
    [
      "exec",
      "mes-local-db-1",
      "psql",
      "-U",
      "mes",
      "-d",
      "mes",
      "-Atc",
      "SELECT current_database()||':'||current_user",
    ],
    { encoding: "utf8" },
  ).trim();
  if (identity !== "mes:mes") throw new Error("PG备份源身份不符");
}
pg.types.setTypeParser(1184, (value) => value);
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
function utc(value: string) {
  let s = value.replace(" ", "T").replace(/(?:\+00(?::00)?|Z)$/, "");
  const [base, fraction = ""] = s.split(".");
  return base + "." + fraction.padEnd(6, "0") + "Z";
}
function normalize(row: any, columns: any[]) {
  const out: any = {};
  for (const col of columns) {
    let value = row[col.column_name];
    if (value != null) {
      if (col.data_type === "timestamp with time zone") value = utc(value);
      else if (col.data_type === "numeric") {
        value = String(value)
          .replace(/(\.\d*?)0+$/, "$1")
          .replace(/\.$/, "");
      } else if (col.data_type === "boolean") value = Boolean(value);
    }
    out[col.column_name] = canonical(value);
  }
  return out;
}
function digest(rows: any[], columns: any[]) {
  const sorted = rows
    .map((r) => JSON.stringify(canonical(normalize(r, columns))))
    .sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex");
}
export async function snapshot(label: string) {
  const source = new pg.Pool({ connectionString: await sourceUrl() });
  const c = await source.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await c.query("SET TIME ZONE 'UTC'");
    const actual = (
      await c.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename",
      )
    ).rows.map((x) => x.tablename);
    if (JSON.stringify(actual) !== JSON.stringify([...tables].sort()))
      throw new Error("源业务表集合不是预期17表，拒绝漏迁");
    const data: any = { tables: {}, createdAt: new Date().toISOString() };
    for (const name of tables) {
      const columns = (
        await c.query(
          "SELECT column_name,data_type,udt_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
          ["public", name],
        )
      ).rows;
      const rows = (
        await c.query(
          "SELECT " +
            columns.map((x) => '"' + x.column_name + '"').join(",") +
            ' FROM "' +
            name +
            '"',
        )
      ).rows;
      data.tables[name] = { columns, rows };
    }
    data.pg_migration_history = (
      await c.query("SELECT * FROM schema_migrations ORDER BY version")
    ).rows;
    await c.query("COMMIT");
    await fs.writeFile(
      home + "/" + label + "-snapshot.json",
      JSON.stringify(data),
    );
    return data;
  } finally {
    c.release();
    await source.end();
  }
}
function topological(rows: any[]) {
  const pending = [...rows],
    out: any[] = [],
    seen = new Set();
  while (pending.length) {
    const i = pending.findIndex((r) => !r.parent_id || seen.has(r.parent_id));
    if (i < 0) throw new Error("源分类结构不完整或有环");
    const row = pending.splice(i, 1)[0];
    out.push(row);
    seen.add(row.id);
  }
  return out;
}
export async function transfer(
  data: any,
  target: InstanceType<typeof Database>,
  label: string,
) {
  for (const name of tables)
    if (
      (await target.query("SELECT count(*) count FROM " + name)).rows[0]
        .count !== 0
    )
      throw new Error("拒绝向非空业务库导入：" + name);
  const c = await target.connect();
  try {
    await c.query("START TRANSACTION");
    for (const name of tables) {
      const { columns } = data.tables[name];
      const rows =
        name === "material_categories"
          ? topological(data.tables[name].rows)
          : data.tables[name].rows;
      for (const row of rows) {
        const values = columns.map((col: any) => {
          let value = row[col.column_name];
          if (value != null && col.data_type === "timestamp with time zone")
            value = utc(value).replace("T", " ").replace("Z", "");
          if (
            value != null &&
            (col.data_type === "jsonb" || col.data_type === "json")
          )
            value = JSON.stringify(value);
          return value;
        });
        await c.query(
          "INSERT INTO " +
            name +
            "(" +
            columns.map((x: any) => "`" + x.column_name + "`").join(",") +
            ") VALUES(" +
            columns.map(() => "?").join(",") +
            ")",
          values,
        );
      }
    }
    await verify(data, c, label);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.release();
  }
  return { allEqual: true };
}
export async function verify(
  data: any,
  target: { query: (sql: string, values?: any[]) => Promise<any> },
  label: string,
) {
  const report: any = {
    label,
    verifiedAt: new Date().toISOString(),
    tables: [],
    allEqual: true,
  };
  for (const name of tables) {
    const source = data.tables[name];
    const destination = (
      await target.query(
        "SELECT " +
          source.columns.map((x: any) => "`" + x.column_name + "`").join(",") +
          " FROM " +
          name,
      )
    ).rows;
    const before = digest(source.rows, source.columns),
      after = digest(destination, source.columns);
    const equal = source.rows.length === destination.length && before === after;
    report.tables.push({
      name,
      sourceCount: source.rows.length,
      targetCount: destination.length,
      sourceDigest: before,
      targetDigest: after,
      equal,
    });
    if (!equal) report.allEqual = false;
  }
  await fs.writeFile(
    home + "/" + label + "-verification.json",
    JSON.stringify(report, null, 2),
  );
  if (!report.allEqual)
    throw new Error("迁移摘要不一致，请查看仅含计数和哈希的核对报告");
  console.log(
    JSON.stringify({
      label,
      tables: report.tables.length,
      totalRows: report.tables.reduce((n: any, t: any) => n + t.targetCount, 0),
      allEqual: true,
    }),
  );
  return report;
}
async function run() {
  const mode = process.argv[2];
  validateTargets();
  await sourceUrl();
  const admin = new Database(process.env.MYSQL_ADMIN_URL!);
  try {
    if (mode === "rehearsal") {
      const db = "mes_test_rehearsal_" + Date.now();
      await admin.query(
        "CREATE DATABASE " +
          db +
          " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin",
      );
      const u = new URL(process.env.MYSQL_ADMIN_URL!);
      u.pathname = "/" + db;
      const target = new Database(u.toString());
      try {
        await migrate(target);
        await transfer(await snapshot("rehearsal"), target, "rehearsal");
      } finally {
        await target.end();
        if (!/^mes_test_rehearsal_[0-9]+$/.test(db))
          throw new Error("拒绝删除非演练库");
        await admin.query("DROP DATABASE " + db);
      }
    } else if (mode === "final") {
      await assertFrozen();
      const dump = execFileSync(
        "docker",
        ["exec", "mes-local-db-1", "pg_dump", "-U", "mes", "-d", "mes", "-Fc"],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      await fs.writeFile(home + "/postgres-final.dump", dump);
      const listing = execFileSync(
        "docker",
        ["exec", "-i", "mes-local-db-1", "pg_restore", "--list"],
        { input: dump, maxBuffer: 8 * 1024 * 1024 },
      );
      if (!listing.toString().includes("TABLE DATA"))
        throw new Error("PG备份清单无数据表");
      await fs.writeFile(
        home + "/postgres-backup-check.json",
        JSON.stringify(
          {
            sha256: createHash("sha256").update(dump).digest("hex"),
            bytes: dump.length,
            restoreListVerified: true,
          },
          null,
          2,
        ),
      );
      await transfer(await snapshot("final"), pool, "final");
    } else throw new Error("仅支持rehearsal或final");
  } finally {
    await admin.end();
    await pool.end();
  }
}
if (process.argv[1]?.endsWith("transfer.ts"))
  run().catch((e) => {
    console.error(
      "迁移停止：" + (e.code || e.message),
      e.syscall || "",
      e.path || "",
      e.stack?.split("\n").slice(1, 4).join("\n"),
    );
    process.exitCode = 1;
  });
