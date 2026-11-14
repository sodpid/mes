import { config } from "dotenv";
config({
  path: process.env.MES_ENV_FILE || ".env",
  override: true,
  quiet: true,
});
import mysql from "mysql2/promise";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
const u = new URL(process.env.MYSQL_ADMIN_URL!);
if(u.hostname!=='127.0.0.1'||!['33079','13379'].includes(u.port))throw Error('仅允许本地专属测试配置');
u.port='13379';
const admin = mysql.createPool(u.toString());
const db = "mes_test_e2e_" + randomBytes(6).toString("hex");
if (u.hostname !== "127.0.0.1" || !["33079", "13379"].includes(u.port))
  throw new Error("测试仅允许本地专属MySQL");
await admin.query(
  `CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`,
);
u.pathname = "/" + db;
process.env.DATABASE_URL = u.toString();
process.env.API_PORT = "18081";
process.env.WEB_ORIGIN = "http://127.0.0.1:18081";
const { pool } = await import("../apps/api/src/db.js");
const { migrate } = await import("../scripts/migrate.js");
await migrate(pool,'db/mysql-bigint');
const { hashPassword } = await import("../apps/api/src/security.js");
const password = randomBytes(20).toString("hex");
await pool.query("INSERT INTO users(uuid,username,password_hash,role,active) VALUES(?,?,?,?,true)", [
  randomUUID(),
  "browser-admin",
  hashPassword(password),
  "ADMIN",
]);
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/e2e-secret.json", JSON.stringify({ password, db }),{mode:0o600});
// Isolated browser fixture only: allocation comes from the real internal service in an outer transaction.
const {transaction}=await import('../apps/api/src/db.js');
const {allocateNumbers}=await import('../apps/api/src/numbering.js');
const actor=(await pool.query("SELECT id,uuid,username,role FROM users WHERE username='browser-admin'")).rows[0];actor.company_ids=[];actor.factory_ids=[];
const companyUuid=randomUUID(),ruleUuid=randomUUID();
await pool.query("INSERT INTO companies(uuid,code,name,status,created_by,updated_by) VALUES(?,?,?,'ACTIVE',?,?)",[companyUuid,'NR-E2E','编号浏览器公司',actor.id,actor.id]);
const nrCompany=(await pool.query("SELECT id FROM companies WHERE code='NR-E2E'")).rows[0].id;
await pool.query("INSERT INTO numbering_rules(uuid,company_id,factory_id,purpose,scope_key,scope_type,code,name,prefix,date_format,sequence_width,reset_period,timezone,status,activated_at,created_by,updated_by) VALUES(?,?,NULL,'SN','C','COMPANY','NR-E2E-SN','浏览器分配查询规则','BROWSERSN','YYYYMMDD',5,'DAY','Asia/Shanghai','ACTIVE',UTC_TIMESTAMP(6),?,?)",[ruleUuid,nrCompany,actor.id,actor.id]);
const nrRule=(await pool.query("SELECT id FROM numbering_rules WHERE company_id=? AND code='NR-E2E-SN'",[nrCompany])).rows[0].id;
const nrBusiness=randomUUID();
const allocated=await transaction(c=>allocateNumbers(c,actor,{rule_id:nrRule,rule_uuid:ruleUuid,company_id:nrCompany,company_uuid:companyUuid,factory_id:null,factory_uuid:null,purpose:'SN',request_key:randomUUID(),business_type:'product-serial-batch',business_id:nrBusiness,quantity:3,business_digest:'b'.repeat(64),requestTime:new Date(),businessAuthorization:{company_id:nrCompany,company_uuid:companyUuid,factory_id:null,factory_uuid:null,purpose:'SN',business_type:'product-serial-batch'}}));
await writeFile('artifacts/e2e-numbering.json',JSON.stringify({company_id:nrCompany,company_uuid:companyUuid,allocation_id:allocated.id,allocation_uuid:allocated.uuid,number:allocated.items[0].number,business_id:nrBusiness}),{mode:0o600});
const { buildApp } = await import("../apps/api/src/app.js");
const app = await buildApp();
app.get('/__e2e/numbering-counts',async(req,reply)=>{if(req.headers['x-e2e-key']!==password)return reply.code(403).send({error:true});return {rows:(await pool.query('SELECT count(*) count,COALESCE(CAST(SUM(current_value) AS CHAR),"0") value FROM numbering_counters')).rows};});
let dbClosed = false;
async function closeDb() {
  if (dbClosed) return;
  dbClosed = true;
  await pool.end();
}
// Test harness only: stop idle connections before the teardown drops its own database.
app.post("/__e2e/close-db", async (request, reply) => {
  if (request.headers["x-e2e-key"] !== password)
    return reply.code(403).send({ error: true });
  await closeDb();
  return { closed: true };
});
await app.listen({ host: "127.0.0.1", port: 18081 });
console.log("E2E ready");
let closing = false;
async function cleanup() {
  if (closing) return;
  closing = true;
  await app.close();
  await closeDb();
  if (db.startsWith("mes_test_e2e_"))
    await admin.query(`DROP DATABASE IF EXISTS ${db}`);
  await admin.end();
  await rm("artifacts/e2e-secret.json", { force: true });
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, cleanup);
