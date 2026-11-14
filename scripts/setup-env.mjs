import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) {
  console.log(".env已存在，保持原样");
} else {
  const password = randomBytes(24).toString("hex");
  const rootPassword = randomBytes(32).toString("hex");
  writeFileSync(
    ".env",
    `DATABASE_URL=mysql://mes_app:${password}@127.0.0.1:13379/mes_local_bigint\nMYSQL_APP_PASSWORD=${password}\nMYSQL_ROOT_PASSWORD=${rootPassword}\nMYSQL_ADMIN_URL=mysql://root:${rootPassword}@127.0.0.1:13379/mes_local_bigint\nMES_SCHEMA_PROFILE=BIGINT_UUID25\nAPI_PORT=18080\nWEB_ORIGIN=http://127.0.0.1:18080\n`,
    { flag: "wx" },
  );
  console.log("已生成仅本机使用的.env，未输出密码");
}
