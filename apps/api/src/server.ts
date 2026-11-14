import { buildApp } from "./app.js";
import { pool } from "./db.js";
const app = await buildApp();
await pool.query("SELECT 1");
await app.listen({
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.API_PORT || 3001),
});
console.log("MES API http://127.0.0.1:" + (process.env.API_PORT || 3001));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
