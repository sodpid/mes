import { config } from "dotenv";
config({
  path: process.env.MES_ENV_FILE || ".env",
  override: true,
  quiet: true,
});
import mysql from "mysql2/promise";
import { readFile, rm } from "node:fs/promises";
export default async function cleanup() {
  let marker: any;
  try {
    marker = JSON.parse(await readFile("artifacts/e2e-secret.json", "utf8"));
  } catch {
    return;
  }
  if (!/^mes_test_e2e_[a-f0-9]{12}$/.test(marker.db))
    throw new Error("拒绝清理非本次测试库");
  const u = new URL(process.env.MYSQL_ADMIN_URL!);
  if (u.hostname !== "127.0.0.1" || !["33079", "13379"].includes(u.port))
    throw new Error("拒绝清理非本地专属测试库");
  u.port='13379';
  const p = mysql.createPool(u.toString());
  try {
    try {
      await fetch("http://127.0.0.1:18081/__e2e/close-db", {
        method: "POST",
        headers: { "x-e2e-key": marker.password },
      });
    } catch {}
    await p.query(`DROP DATABASE IF EXISTS ${marker.db}`);
  } finally {
    await p.end();
    await rm("artifacts/e2e-secret.json", { force: true });
  }
}
