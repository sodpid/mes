import mysql, { type PoolConnection, type PoolOptions } from "mysql2/promise";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createHash } from "node:crypto";
config({
  path: resolve(
    import.meta.dirname,
    "../../../",
    process.env.MES_ENV_FILE || ".env",
  ),
  quiet: true,
});
export type QueryResult = { rows: any[]; rowCount: number };
const jsonColumns = new Set([
  "supplier_capabilities",
  "work_days",
  "rule_snapshot",
  "allowed_supply_modes",
  "allowed_production_strategies",
  "before_json",
  "after_json",
]);
function bind(value: any): any {
  if (value === undefined) return null;
  if (
    Array.isArray(value) ||
    (value &&
      typeof value === "object" &&
      !(value instanceof Date) &&
      !Buffer.isBuffer(value))
  )
    return JSON.stringify(value);
  return value;
}
export class Connection {
  private locks = new Set<string>();
  private transactionActive = false;
  get inTransaction() { return this.transactionActive && !this.broken && !this.released; }
  private released = false;
  private broken = false;
  constructor(
    public raw: PoolConnection,
    private database: string,
  ) {}
  async query(sql: string, values: any[] = []): Promise<QueryResult> {
    if(this.released || this.broken) throw new Error("数据库连接已释放或损坏");
    if(this.transactionActive && /^(CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|LOCK|UNLOCK|START|BEGIN)\b|^SET\s+(SESSION\s+)?AUTOCOMMIT\b/i.test(sql.trim())) throw new Error("业务事务禁止DDL或隐式提交语句");
    if(/^(COMMIT|ROLLBACK)\b/i.test(sql.trim())) this.transactionActive = false;
    const [result, fields] = await this.raw.query(sql, values.map(bind));
    if(/^START TRANSACTION\b/i.test(sql.trim())) this.transactionActive = true;
    if(/^(COMMIT|ROLLBACK)\b/i.test(sql.trim())) this.transactionActive = false;
    if (!Array.isArray(result))
      return { rows: [], rowCount: (result as any).affectedRows || 0 };
    const rows = (result as any[]).map((original) => {
      const row = { ...original };
      for (const f of fields || []) {
        const value = row[f.name];
        if (value == null) continue;
        if (["count","n","total"].includes(f.name) && typeof value === "string" && /^[0-9]+$/.test(value) && BigInt(value)<=BigInt(Number.MAX_SAFE_INTEGER)) row[f.name]=Number(value);
        else if (f.name === "active") row[f.name] = Boolean(value);
        else if (f.type === 12 || f.type === 7) {
          const [date, time] = String(value).split(" ");
          const [base, fraction = ""] = time.split(".");
          row[f.name] = `${date}T${base}.${fraction.padEnd(6, "0")}Z`;
        } else if (jsonColumns.has(f.name) && typeof value === "string")
          row[f.name] = JSON.parse(value);
      }
      return row;
    });
    return { rows, rowCount: rows.length };
  }
  async lock(key: string, timeout = 8) {
    const name =
      "mes:" +
      createHash("sha256")
        .update(this.database + ":" + key)
        .digest("hex")
        .slice(0, 56);
    if (this.locks.has(name)) return;
    const r = await this.query("SELECT GET_LOCK(?,?) acquired", [
      name,
      timeout,
    ]);
    if (String(r.rows[0].acquired) !== "1") {
      const e: any = new Error("资料正在被其他操作修改，请稍后重试");
      e.code = "MES_LOCK_TIMEOUT";
      throw e;
    }
    this.locks.add(name);
  }
  async release() {
    this.transactionActive = false;
    try {
      for (const name of this.locks) {
        const r = await this.query("SELECT RELEASE_LOCK(?) released", [name]);
        if (String(r.rows[0].released) !== "1") throw new Error("lock release failed");
      }
    } catch {
      this.broken = true;
    } finally {
      this.locks.clear();
      if (this.broken) this.raw.destroy();
      else this.raw.release();
      this.released = true;
    }
  }
  destroy() {
    this.transactionActive = false;
    this.broken = true;
  }
}
export class Database {
  private driver: mysql.Pool;
  database: string;
  constructor(url: string) {
    const u = new URL(url);
    if (u.protocol !== "mysql:")
      throw new Error("运行数据库仅支持MySQL，请使用MySQL配置");
    this.database = decodeURIComponent(u.pathname.slice(1));
    this.driver = mysql.createPool({
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: this.database,
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
      timezone: "Z",
      connectionLimit: 12,
      charset: "utf8mb4_unicode_ci",
      multipleStatements: false,
    } as PoolOptions);
    (this.driver as any).on("error", () => console.error("数据库连接中断"));
  }
  async connect() {
    const raw = await this.driver.getConnection();
    try {
      await raw.query("SET NAMES utf8mb4 COLLATE utf8mb4_0900_bin");
      await raw.query("SET time_zone='+00:00'");
      await raw.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
      return new Connection(raw, this.database);
    } catch (e) {
      raw.destroy();
      throw e;
    }
  }
  async query(sql: string, values: any[] = []) {
    const c = await this.connect();
    try {
      return await c.query(sql, values);
    } finally {
      await c.release();
    }
  }
  async end() {
    await this.driver.end();
  }
}
if (!process.env.DATABASE_URL) throw new Error("请配置DATABASE_URL");
export const pool = new Database(process.env.DATABASE_URL);
export async function transaction<T>(
  fn: (c: Connection) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("START TRANSACTION");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      c.destroy();
    }
    throw e;
  } finally {
    await c.release();
  }
}
