import { beforeAll, afterAll, test, expect } from "vitest";
import mysql from "mysql2/promise";
import { config } from "dotenv";
config({
  path: process.env.MES_ENV_FILE || ".env",
  override: true,
  quiet: true,
});
import { randomUUID, randomBytes } from "node:crypto";
import "dotenv/config";
let app: any,
  pool: any,
  adminDb: any,
  dbName: string,
  cookie: string,
  co: any,
  fa: any,
  sup: any,
  pcs: any,
  box: any,
  cat: any,
  material: any,
  wh: any,
  otherCo: any,
  otherFa: any,
  editorCookie: string,
  viewerCookie: string;
const password = randomBytes(18).toString("hex");
const pairCache = new Map<string,string>();
const refResources:Record<string,string>={company_id:'companies',factory_id:'factories',warehouse_id:'warehouses',category_id:'material-categories',parent_id:'material-categories',base_unit_id:'units',unit_id:'units',from_unit_id:'units',custodian_supplier_id:'partners',preferred_supplier_id:'partners',rule_id:'numbering-rules'};
function register(resource:string,row:any){if(row?.id&&row?.uuid)pairCache.set(resource+':'+row.id,row.uuid);}
function refsBody(body:any):any {if(!body||typeof body!=='object')return body;const out={...body};for(const [key,resource] of Object.entries(refResources))if(Object.hasOwn(out,key)&&out[key]!==undefined){const uuidKey=key.slice(0,-3)+'_uuid';if(!Object.hasOwn(out,uuidKey))out[uuidKey]=out[key]===null?null:pairCache.get(resource+':'+out[key]);}for(const [key,resource,target] of [['company_ids','companies','company_refs'],['factory_ids','factories','factory_refs']])if(Array.isArray(out[key])){out[target]=out[key].map((id:string)=>({id,uuid:pairCache.get(resource+':'+id)}));delete out[key];}for(const key of ['unitConversions','factoryPolicies'])if(Array.isArray(out[key]))out[key]=out[key].map(refsBody);return out;}
function pairHeaders(path:string){const [plain,query]=path.split('?');const [resource,id]=plain.split('/');const out:Record<string,string>={'x-mes-api-version':'2'};if(id&&id!=='preview'&&resource!=='auth'){const uuid=pairCache.get(resource+':'+id);if(uuid)out['x-resource-uuid']=uuid;}const params=new URLSearchParams(query);const refs:Record<string,string>={};for(const key of ['company_id','factory_id','rule_id'])if(params.has(key)){const uuid=pairCache.get(refResources[key]+':'+params.get(key));if(uuid)refs[key]=uuid;}if(Object.keys(refs).length)out['x-reference-uuids']=JSON.stringify(refs);return out;}
async function request(
  method: string,
  path: string,
  body?: any,
  auth = cookie,
  extraHeaders: Record<string,string> = {},
) {
  const r = await app.inject({
    method,
    url: "/api/v1/" + path,
    headers: {
      ...(auth ? { cookie: auth } : {}),
      "content-type": "application/json",
      ...pairHeaders(path),
      ...extraHeaders,
    },
    payload: refsBody(body),
  });
  if(r.statusCode<300){const data=r.json();const resource=path.startsWith('auth/')?'users':path.split(/[/?]/)[0];if(!/\/(audit|references)$/.test(path)){for(const row of data.items|| (Array.isArray(data.data)?data.data:[data.data]))register(resource,row);}}
  return { status: r.statusCode, body: r.json() };
}
async function ok(method: string, path: string, body?: any) {
  const r = await request(method, path, body);
  expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  return r.body.data;
}
async function create(e: string, b: any, active = true) {
  let r = await ok("POST", e, b);
  if (active)
    r = await ok("POST", e + "/" + r.id + "/activate", {
      revision: r.revision,
      reason: "验收启用",
    });
  return r;
}
const policy = (factory_id: string) => ({
  factory_id,
  status: "ACTIVE",
  allowed_supply_modes: ["MAKE", "SUBCONTRACT"],
  default_supply_mode: "MAKE",
  allowed_production_strategies: ["MTO", "MTS"],
  default_production_strategy: "MTS",
  inspectionPolicies: ["IQC", "FQC", "OQC"].map((inspection_type) => ({
    inspection_type,
    requirement: "REQUIRED",
  })),
});
beforeAll(async () => {
  const url = new URL(process.env.MYSQL_ADMIN_URL!);
  if(url.hostname!=='127.0.0.1'||!['33079','13379'].includes(url.port))throw new Error('仅允许本地专属测试配置');
  url.port='13379';
  adminDb = mysql.createPool(url.toString());
  dbName = "mes_test_" + randomBytes(6).toString("hex");
  if (url.hostname !== "127.0.0.1" || !["33079", "13379"].includes(url.port))
    throw new Error("测试仅允许专属本地MySQL33079或13379");
  await adminDb.query(
    `CREATE DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`,
  );
  url.pathname = "/" + dbName;
  process.env.DATABASE_URL = url.toString();
  const db = await import("../apps/api/src/db.js");
  pool = db.pool;
  const { migrate } = await import("../scripts/migrate.js");
  await migrate(pool,'db/mysql-bigint');
  const { hashPassword } = await import("../apps/api/src/security.js");
  await pool.query("INSERT INTO users(uuid,username,password_hash,role,active) VALUES(?,?,?,?,true)", [
    randomUUID(),
    "test-admin",
    hashPassword(password),
    "ADMIN",
  ]);
  app = await (await import("../apps/api/src/app.js")).buildApp();
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { "content-type": "application/json", "x-mes-api-version":"2" },
    payload: { username: "test-admin", password },
  });
  expect(r.statusCode).toBe(200);
  cookie = r.headers["set-cookie"].split(";")[0];
  register('users',r.json().data);
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  if (adminDb && dbName?.startsWith("mes_test_")) {
    await adminDb.query(`DROP DATABASE ${dbName}`);
    await adminDb.end();
  }
});
test("S1-01 新库迁移、登录、数据库持久化与服务重建", async () => {
  co = await create("companies", { code: " c01 ", name: "验收公司" });
  expect(co.code).toBe("C01");
  expect(
    (await pool.query("SELECT name FROM companies WHERE id=?", [co.id])).rows[0]
      .name,
  ).toBe("验收公司");
  await app.close();
  app = await (await import("../apps/api/src/app.js")).buildApp();
  expect((await ok("GET", "companies/" + co.id)).name).toBe("验收公司");
});
test("S1-02 组织仓储完整CRUD、状态、引用和审计", async () => {
  fa = await create("factories", {
    code: "F01",
    name: "一厂",
    company_id: co.id,
  });
  sup = await create("partners", {
    code: "SU01",
    name: "双角色主体",
    company_id: co.id,
    roles: [
      { role: "CUSTOMER", status: "ACTIVE" },
      { role: "SUPPLIER", status: "ACTIVE" },
    ],
    supplier_capabilities: ["MATERIAL", "PROCESSING"],
  });
  wh = await create("warehouses", {
    code: "WH01",
    name: "供应商仓",
    company_id: co.id,
    factory_id: fa.id,
    location_type: "SUPPLIER",
    custodian_supplier_id: sup.id,
  });
  expect(wh.effective_active).toBe(true);
  const updated = await ok("PUT", "factories/" + fa.id, {
    name: "一厂更新",
    revision: fa.revision,
  });
  fa = updated;
  expect(fa.name).toBe("一厂更新");
  const draft = await create(
    "warehouses",
    {
      code: "TMP",
      name: "临时草稿仓",
      company_id: co.id,
      factory_id: fa.id,
      location_type: "INTERNAL",
    },
    false,
  );
  expect(
    (
      await request("DELETE", "warehouses/" + draft.id, {
        revision: draft.revision,
      })
    ).status,
  ).toBe(200);
  expect(
    (await ok("GET", "warehouses/" + wh.id + "/audit")).length,
  ).toBeGreaterThan(1);
});
test("S1-03 双角色共享记录、独立停用及新引用阻断", async () => {
  for (const role of ["CUSTOMER", "SUPPLIER"]) {
    const r = await request("GET", "partners?role=" + role);
    expect(r.body.items.some((x: any) => x.id === sup.id)).toBe(true);
  }
  sup = await ok("PUT", "partners/" + sup.id, {
    revision: sup.revision,
    reason: "测试供应角色停用",
    roles: [
      { role: "CUSTOMER", status: "ACTIVE" },
      { role: "SUPPLIER", status: "INACTIVE" },
    ],
  });
  expect(
    (
      await request("POST", "warehouses", {
        code: "BAD",
        name: "禁用供方仓",
        company_id: co.id,
        factory_id: fa.id,
        location_type: "SUPPLIER",
        custodian_supplier_id: sup.id,
      })
    ).status,
  ).toBe(422);
  sup = await ok("PUT", "partners/" + sup.id, {
    revision: sup.revision,
    reason: "恢复供应角色",
    roles: [
      { role: "CUSTOMER", status: "ACTIVE" },
      { role: "SUPPLIER", status: "ACTIVE" },
    ],
  });
});
test("S1-04 编码规范化唯一、跨公司可重复、停用不复用", async () => {
  expect(
    (
      await request("POST", "partners", {
        code: " su01 ",
        name: "重复",
        company_id: co.id,
        roles: [{ role: "CUSTOMER", status: "ACTIVE" }],
        supplier_capabilities: [],
      })
    ).status,
  ).toBe(409);
  otherCo = await create("companies", { code: "C02", name: "其他公司" });
  otherFa = await create("factories", {
    code: "F01",
    name: "其他工厂",
    company_id: otherCo.id,
  });
  const p = await create("partners", {
    code: "SU01",
    name: "跨公司同码",
    company_id: otherCo.id,
    roles: [{ role: "SUPPLIER", status: "ACTIVE" }],
    supplier_capabilities: ["MATERIAL"],
  });
  await ok("POST", "partners/" + p.id + "/deactivate", {
    revision: p.revision,
    reason: "验证编码保留",
  });
  expect(
    (
      await request("POST", "partners", {
        code: "SU01",
        name: "重复停用编码",
        company_id: otherCo.id,
        roles: [{ role: "CUSTOMER", status: "ACTIVE" }],
        supplier_capabilities: [],
      })
    ).status,
  ).toBe(409);
});
test("S1-05 组织隔离、跨公司引用、审计策略字段过滤", async () => {
  const otherCat = await create("material-categories", {
    code: "CAT",
    name: "他公司分类",
    company_id: otherCo.id,
  });
  expect(
    (
      await request("POST", "materials", {
        code: "BAD",
        name: "跨公司",
        company_id: co.id,
        category_id: otherCat.id,
      })
    ).status,
  ).toBe(422);
  const base = {
    password,
    active: true,
    company_ids: [co.id],
    factory_ids: [fa.id],
  };
  await ok("POST", "users", { ...base, username: "editor", role: "EDITOR" });
  await ok("POST", "users", { ...base, username: "viewer", role: "VIEWER" });
  for (const [name, set] of [
    ["editor", (x: string) => (editorCookie = x)],
    ["viewer", (x: string) => (viewerCookie = x)],
  ] as any[]) {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json", "x-mes-api-version":"2" },
      payload: { username: name, password },
    });
    set(r.headers["set-cookie"].split(";")[0]);
  }
  expect(
    (await request("GET", "companies/" + otherCo.id, undefined, editorCookie))
      .status,
  ).toBe(404);
  const list = await request(
    "GET",
    "factories?company_id=" + otherCo.id,
    undefined,
    editorCookie,
  );
  expect(list.status).toBe(404); // v2 validates the filtered entity pair and scope before querying.
  expect(
    (
      await request(
        "GET",
        "companies/" + otherCo.id + "/audit",
        undefined,
        editorCookie,
      )
    ).status,
  ).toBe(404);
});
test("S1-06 单位分类物料CRUD与分类循环", async () => {
  pcs = await create("units", {
    code: "PCS",
    name: "件",
    dimension: "COUNT",
    decimal_places: 0,
  });
  box = await create("units", {
    code: "BOX",
    name: "箱",
    dimension: "COUNT",
    decimal_places: 0,
  });
  cat = await create("material-categories", {
    code: "CAT",
    name: "物料分类",
    company_id: co.id,
  });
  const child = await create("material-categories", {
    code: "SUB",
    name: "子分类",
    company_id: co.id,
    parent_id: cat.id,
  });
  expect(
    (
      await request("PUT", "material-categories/" + cat.id, {
        revision: cat.revision,
        parent_id: child.id,
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await request("PUT", "material-categories/" + cat.id, {
        revision: cat.revision,
        parent_id: cat.id,
      })
    ).status,
  ).toBe(422);
  material = await create("materials", {
    code: "R02",
    name: "紧固件",
    company_id: co.id,
    category_id: cat.id,
    material_kind: "RAW",
    base_unit_id: pcs.id,
    tracking_mode: "BATCH",
    unitConversions: [{ unit_id: box.id, factor: "100" }],
    factoryPolicies: [policy(fa.id)],
  });
  expect(material.unitConversions[0].factor).toBe("100.000000");
});
test("S1-07 物料专属十进制换算及精度拒绝", async () => {
  expect(
    (
      await ok("POST", "materials/" + material.id + "/convert", {
        quantity: "2",
        from_unit_id: box.id,
      })
    ).quantity,
  ).toBe("200");
  expect(
    (
      await request("POST", "materials/" + material.id + "/convert", {
        quantity: "0.5",
        from_unit_id: pcs.id,
      })
    ).status,
  ).toBe(422);
  for (const factor of ["0", "-1", "1.1234567"])
    expect(
      (
        await request("PUT", "materials/" + material.id, {
          revision: material.revision,
          unitConversions: [{ unit_id: box.id, factor }],
        })
      ).status,
    ).toBe(422);
  const m = await create("materials", {
    code: "OTHER",
    name: "其他物料",
    company_id: co.id,
    category_id: cat.id,
    material_kind: "RAW",
    base_unit_id: pcs.id,
    tracking_mode: "BATCH",
  });
  expect(
    (
      await request("POST", "materials/" + m.id + "/convert", {
        quantity: "2",
        from_unit_id: box.id,
      })
    ).status,
  ).toBe(422);
});
test("S1-08 供应默认集合、生产策略及供应能力校验", async () => {
  const p = policy(fa.id);
  expect(
    (
      await request("PUT", "materials/" + material.id, {
        revision: material.revision,
        factoryPolicies: [{ ...p, default_supply_mode: "BUY" }],
      })
    ).status,
  ).toBe(422);
  material = await ok("PUT", "materials/" + material.id, {
    revision: material.revision,
    factoryPolicies: [p],
  });
  expect(material.factoryPolicies[0].allowed_production_strategies).toEqual([
    "MTO",
    "MTS",
  ]);
  const supply = await create("partners", {
    code: "PROCESS",
    name: "仅加工",
    company_id: co.id,
    roles: [{ role: "SUPPLIER", status: "ACTIVE" }],
    supplier_capabilities: ["PROCESSING"],
  });
  expect(
    (
      await request("PUT", "materials/" + material.id, {
        revision: material.revision,
        factoryPolicies: [
          {
            ...p,
            allowed_supply_modes: ["BUY"],
            default_supply_mode: "BUY",
            preferred_supplier_id: supply.id,
          },
        ],
      })
    ).status,
  ).toBe(422);
});
test("S1-09 删除引用、旧详情保留、上级有效性与新增引用", async () => {
  expect(
    (
      await request("DELETE", "materials/" + material.id, {
        revision: material.revision,
      })
    ).status,
  ).toBe(409);
  const draft = await create(
    "material-categories",
    { code: "DRAFT", name: "父草稿", company_id: co.id },
    false,
  );
  await pool.query(
    "INSERT INTO material_categories(uuid,code,name,company_id,parent_id,created_by,updated_by) SELECT ?,?,?,?,?,created_by,updated_by FROM material_categories WHERE id=?",
    [randomUUID(), "DIRECT", "引用草稿", co.id, draft.id, draft.id],
  );
  expect(
    (
      await request("DELETE", "material-categories/" + draft.id, {
        revision: draft.revision,
      })
    ).status,
  ).toBe(409);
  const stopped = await ok("POST", "units/" + box.id + "/deactivate", {
    revision: box.revision,
    reason: "停用辅助单位",
  });
  expect(
    (await ok("GET", "materials/" + material.id)).unitConversions.length,
  ).toBe(1);
  const draftMat = await create(
    "materials",
    { code: "DRAFTMAT", name: "草稿物料", company_id: co.id },
    false,
  );
  expect(
    (
      await request("PUT", "materials/" + draftMat.id, {
        revision: draftMat.revision,
        unitConversions: [{ unit_id: box.id, factor: "1" }],
      })
    ).status,
  ).toBe(422);
  box = await ok("POST", "units/" + box.id + "/activate", {
    revision: stopped.revision,
    reason: "恢复",
  });
  const f = await ok("POST", "factories/" + fa.id + "/deactivate", {
    revision: fa.revision,
    reason: "上级停用",
  });
  expect((await ok("GET", "warehouses/" + wh.id)).effective_active).toBe(false);
  fa = await ok("POST", "factories/" + fa.id + "/activate", {
    revision: f.revision,
    reason: "恢复",
  });
  await ok("DELETE", "materials/" + draftMat.id, {
    revision: draftMat.revision,
  });
});
test("S1-10 并发修订与事务审计一致、字段级审计隔离", async () => {
  const old = await ok("GET", "materials/" + material.id);
  const results = await Promise.all([
    request("PUT", "materials/" + material.id, {
      revision: old.revision,
      name: "并发甲",
    }),
    request("PUT", "materials/" + material.id, {
      revision: old.revision,
      name: "并发乙",
    }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  material = await ok("GET", "materials/" + material.id);
  const count = (await ok("GET", "materials/" + material.id + "/audit")).length;
  expect(
    (
      await request("PUT", "materials/" + material.id, {
        revision: material.revision,
        unitConversions: [{ unit_id: box.id, factor: "0" }],
      })
    ).status,
  ).toBe(422);
  expect((await ok("GET", "materials/" + material.id + "/audit")).length).toBe(
    count,
  );
  const second = await create("factories", {
    code: "F02",
    name: "未授权二厂",
    company_id: co.id,
  });
  material = await ok("PUT", "materials/" + material.id, {
    revision: material.revision,
    factoryPolicies: [policy(fa.id), policy(second.id)],
  });
  const audits = await request(
    "GET",
    "materials/" + material.id + "/audit",
    undefined,
    editorCookie,
  );
  expect(audits.status).toBe(200);
  expect(JSON.stringify(audits.body)).not.toContain(second.uuid);
  expect(
    (await request("GET", "materials/" + material.id, undefined, editorCookie))
      .body.data.factoryPolicies,
  ).toHaveLength(1);
});
test("S1-11 后端权限、子项状态防绕过、无登录写入", async () => {
  for (const auth of [editorCookie, viewerCookie])
    expect(
      (
        await request(
          "POST",
          "materials/" + material.id + "/activate",
          { revision: material.revision, reason: "越权" },
          auth,
        )
      ).status,
    ).toBe(403);
  expect(
    (await request("POST", "companies", { code: "NOAUTH", name: "未登录" }, ""))
      .status,
  ).toBe(401);
  const s = await ok("GET", "partners/" + sup.id);
  expect(
    (
      await request(
        "PUT",
        "partners/" + sup.id,
        {
          revision: s.revision,
          roles: [
            { role: "CUSTOMER", status: "ACTIVE" },
            { role: "SUPPLIER", status: "INACTIVE" },
          ],
        },
        editorCookie,
      )
    ).status,
  ).toBe(403);
  const response = await request(
    "POST",
    "units",
    { code: "NO", name: "不允许", dimension: "COUNT", decimal_places: 0 },
    editorCookie,
  );
  expect(response.status).toBe(403);
});
test("S1-12 默认库位事务启用、最后库位、外部仓与DB CHECK", async () => {
  const loc = (
    await request("GET", "locations?factory_id=" + fa.id)
  ).body.items.find((x: any) => x.warehouse_id === wh.id);
  expect(loc.status).toBe("ACTIVE");
  expect(
    (
      await request("POST", "locations/" + loc.id + "/deactivate", {
        revision: loc.revision,
        reason: "最后库位",
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await request("POST", "warehouses", {
        code: "MISSING",
        name: "未选供方",
        company_id: co.id,
        factory_id: fa.id,
        location_type: "SUPPLIER",
      })
    ).status,
  ).toBe(422);
  const policyRow = (
    await pool.query(
      "SELECT * FROM material_factory_policies WHERE material_id=? LIMIT 1",
      [material.id],
    )
  ).rows[0];
  await expect(
    pool.query(
      "UPDATE material_factory_policies SET default_production_strategy=NULL WHERE id=?",
      [policyRow.id],
    ),
  ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  await expect(
    pool.query(
      "UPDATE material_inspection_policies SET requirement='EXEMPT',exemption_reason=NULL WHERE policy_id=?",
      [policyRow.id],
    ),
  ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  expect(
    (
      await pool.query(
        "SELECT count(*) count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE '%inventory%' ",
      )
    ).rows[0].count,
  ).toBe(0);
});
test("回归 子项状态独立授权、原因、停用删除重建防绕过", async () => {
  const base = {
    password,
    active: true,
    company_ids: [co.id],
    factory_ids: [fa.id],
  };
  await ok("POST", "users", {
    ...base,
    username: "releaser",
    role: "RELEASER",
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { "content-type": "application/json", "x-mes-api-version":"2" },
    payload: { username: "releaser", password },
  });
  const releaseCookie = login.headers["set-cookie"].split(";")[0];
  let p = await ok("GET", "partners/" + sup.id);
  for (const auth of [editorCookie, viewerCookie])
    expect(
      (
        await request(
          "POST",
          "partners/" + p.id + "/child-status",
          {
            revision: p.revision,
            role: "CUSTOMER",
            status: "INACTIVE",
            reason: "越权",
          },
          auth,
        )
      ).status,
    ).toBe(403);
  expect(
    (
      await request(
        "POST",
        "partners/" + p.id + "/child-status",
        {
          revision: p.revision,
          role: "CUSTOMER",
          status: "INACTIVE",
          reason: "",
        },
        releaseCookie,
      )
    ).status,
  ).toBe(400);
  const stopped = await request(
    "POST",
    "partners/" + p.id + "/child-status",
    {
      revision: p.revision,
      role: "CUSTOMER",
      status: "INACTIVE",
      reason: "角色停用测试",
    },
    releaseCookie,
  );
  expect(stopped.status, JSON.stringify(stopped.body)).toBe(200);
  p = stopped.body.data;
  expect(
    (
      await request(
        "PUT",
        "partners/" + p.id,
        {
          revision: p.revision,
          roles: [{ role: "SUPPLIER", status: "ACTIVE" }],
        },
        editorCookie,
      )
    ).status,
  ).toBe(403);
  const restored = await request(
    "POST",
    "partners/" + p.id + "/child-status",
    {
      revision: p.revision,
      role: "CUSTOMER",
      status: "ACTIVE",
      reason: "角色恢复测试",
    },
    releaseCookie,
  );
  expect(restored.status).toBe(200);
  material = await ok("GET", "materials/" + material.id);
  const m = await request(
    "POST",
    "materials/" + material.id + "/child-status",
    {
      revision: material.revision,
      factory_id: fa.id,
      status: "INACTIVE",
      reason: "策略停用测试",
    },
    releaseCookie,
  );
  expect(m.status, JSON.stringify(m.body)).toBe(200);
  const hidden = material.factoryPolicies.find(
    (x: any) => x.factory_id !== fa.id,
  );
  expect(JSON.stringify(m.body)).not.toContain(hidden.factory_uuid);
  const audits = await request(
    "GET",
    "materials/" + material.id + "/audit",
    undefined,
    releaseCookie,
  );
  expect(JSON.stringify(audits.body)).not.toContain(hidden.factory_uuid);
  const restoredM = await request(
    "POST",
    "materials/" + material.id + "/child-status",
    {
      revision: m.body.data.revision,
      factory_id: fa.id,
      status: "ACTIVE",
      reason: "策略恢复",
    },
    releaseCookie,
  );
  expect(restoredM.status).toBe(200);
});

test("MySQL-01 连接级锁竞争、超时、回滚释放与连接复用", async () => {
  const a = await pool.connect(),
    b = await pool.connect();
  try {
    await a.query("START TRANSACTION");
    await a.lock("acceptance-lock");
    await expect(b.lock("acceptance-lock", 0)).rejects.toMatchObject({
      code: "MES_LOCK_TIMEOUT",
    });
    await a.query("ROLLBACK");
    await a.release();
    await b.lock("acceptance-lock", 0);
  } finally {
    await b.release();
  }
  const c = await pool.connect();
  try {
    await c.lock("acceptance-lock", 0);
  } finally {
    await c.release();
  }
});

test("MySQL-02 JSON有限集合拒绝标量、重复、未知项与默认值不在集合", async () => {
  const row = (
    await pool.query(
      "SELECT * FROM material_factory_policies WHERE material_id=? LIMIT 1",
      [material.id],
    )
  ).rows[0];
  for (const value of ['"MAKE"', '["MAKE","MAKE"]', '["UNKNOWN"]', "[]"])
    await expect(
      pool.query(
        "UPDATE material_factory_policies SET allowed_supply_modes=? WHERE id=?",
        [value, row.id],
      ),
    ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  await expect(
    pool.query(
      "UPDATE material_factory_policies SET allowed_supply_modes='[\"BUY\"]',default_supply_mode='MAKE' WHERE id=?",
      [row.id],
    ),
  ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  await expect(
    pool.query("UPDATE material_factory_policies SET factory_id=? WHERE id=?", [
      '18446744073709551614',
      row.id,
    ]),
  ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
});

test("MySQL-03 微秒时间及看似ISO的普通文本原义保留", async () => {
  const text = "2026-10-20T11:12:13.123456Z";
  const row = await create(
    "units",
    { code: "ISOTEXT", name: text, dimension: "COUNT", decimal_places: 0 },
    false,
  );
  await pool.query(
    "UPDATE units SET created_at='2026-10-20 11:12:13.123456',updated_at='2026-10-20 11:12:13.654321' WHERE id=?",
    [row.id],
  );
  const read = (
    await pool.query(
      "SELECT name,created_at,updated_at FROM units WHERE id=?",
      [row.id],
    )
  ).rows[0];
  expect(read).toEqual({
    name: text,
    created_at: "2026-10-20T11:12:13.123456Z",
    updated_at: "2026-10-20T11:12:13.654321Z",
  });
});

test("MySQL-04 用户名大小写精确及认证健康引擎证据", async () => {
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: {"x-mes-api-version":"2"},
    payload: { username: "TEST-ADMIN", password },
  });
  expect(login.statusCode).toBe(401);
  const health = await request("GET", "health");
  expect(health.status).toBe(200);
  expect(health.body.data.engine).toBe("MySQL");
  expect(health.body.data.version).toMatch(/^8\.4\./);
});

test("MySQL-05 并发分类互指只允许一项成功", async () => {
  const a = await create("material-categories", {
    code: "CONCA",
    name: "并发A",
    company_id: co.id,
  });
  const b = await create("material-categories", {
    code: "CONCB",
    name: "并发B",
    company_id: co.id,
  });
  const result = await Promise.all([
    request("PUT", "material-categories/" + a.id, {
      revision: a.revision,
      parent_id: b.id,
    }),
    request("PUT", "material-categories/" + b.id, {
      revision: b.revision,
      parent_id: a.id,
    }),
  ]);
  expect(result.map((r) => r.status).sort()).toEqual([200, 422]);
  const rows = (
    await pool.query(
      "SELECT id,parent_id FROM material_categories WHERE id IN (?,?)",
      [a.id, b.id],
    )
  ).rows;
  expect(rows.filter((r: any) => r.parent_id !== null)).toHaveLength(1);
});

test("MySQL-06 并发停用两库位必须保留最后活动库位", async () => {
  const w = await create("warehouses", {
    code: "CONWH",
    name: "并发仓",
    company_id: co.id,
    factory_id: fa.id,
    location_type: "INTERNAL",
  });
  const existing = (
    await request("GET", "locations?factory_id=" + fa.id)
  ).body.items.find((x: any) => x.warehouse_id === w.id);
  const second = await create("locations", {
    code: "CONLOC",
    name: "并发库位",
    company_id: co.id,
    factory_id: fa.id,
    warehouse_id: w.id,
  });
  const results = await Promise.all(
    [existing, second].map((l) =>
      request("POST", "locations/" + l.id + "/deactivate", {
        revision: l.revision,
        reason: "并发验收",
      }),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
  expect(
    (
      await pool.query(
        "SELECT count(*) count FROM locations WHERE warehouse_id=? AND status='ACTIVE'",
        [w.id],
      )
    ).rows[0].count,
  ).toBe(1);
});

test("MySQL-07 并发降级管理员必须保留最后管理员", async () => {
  const extra = await ok("POST", "users", {
    username: "concurrent-admin",
    password,
    role: "ADMIN",
    active: true,
    company_ids: [],
    factory_ids: [],
  });
  const original = (
    await pool.query("SELECT id FROM users WHERE username='test-admin'")
  ).rows[0];
  try {
    const results = await Promise.all(
      [
        { id: original.id, username: "test-admin" },
        { id: extra.id, username: "concurrent-admin" },
      ].map((u) =>
        request("PUT", "users/" + u.id, {
          username: u.username,
          role: "VIEWER",
          active: true,
          company_ids: [],
          factory_ids: [],
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(
      (
        await pool.query(
          "SELECT count(*) count FROM users WHERE active AND role='ADMIN'",
        )
      ).rows[0].count,
    ).toBe(1);
  } finally {
    await pool.query("UPDATE users SET role='ADMIN' WHERE id=?", [original.id]);
    await pool.query("UPDATE users SET role='VIEWER' WHERE id=?", [extra.id]);
    const login=await app.inject({method:"POST",url:"/api/v1/auth/login",remoteAddress:"127.0.4.100",headers:{"content-type":"application/json","x-mes-api-version":"2"},payload:{username:"test-admin",password}});
    expect(login.statusCode).toBe(200);cookie=login.headers["set-cookie"].split(";")[0];
    expect((await request("GET","auth/me")).status).toBe(200);
  }
});

test("MySQL-08 DDL部分失败记录精确步数并拒绝静默重放", async () => {
  const fs = await import("node:fs/promises");
  const { migrate } = await import("../scripts/migrate.js");
  const directory =
    "artifacts/mysql-switch/test-migration-" + randomBytes(4).toString("hex");
  await fs.mkdir(directory, { recursive: true });
  const name = "999_acceptance_failure.json";
  await fs.writeFile(
    directory + "/" + name,
    JSON.stringify({
      statements: [
        "CREATE TABLE acceptance_ddl(id INT PRIMARY KEY)",
        "THIS IS INVALID SQL",
      ],
    }),
  );
  await expect(migrate(pool, directory)).rejects.toThrow("第2步失败");
  expect(
    (
      await pool.query(
        "SELECT state,executed_steps,error_step FROM schema_migrations WHERE version=?",
        [name],
      )
    ).rows[0],
  ).toEqual({ state: "FAILED", executed_steps: 1, error_step: 2 });
  await expect(migrate(pool, directory)).rejects.toThrow("不自动重放");
  await fs.rm(directory, { recursive: true });
  await pool.query("DROP TABLE acceptance_ddl");
  await pool.query("DELETE FROM schema_migrations WHERE version=?",[name]);
});

test('生产健康端点仅暴露连通且详情仍需认证', async()=>{
 const publicHealth=await app.inject({method:'GET',url:'/healthz'});expect(publicHealth.statusCode).toBe(200);expect(publicHealth.json()).toEqual({ok:true});
 expect((await app.inject({method:'GET',url:'/api/v1/health',headers:{'x-mes-api-version':'2'}})).statusCode).toBe(401);
});
test('生产SecureCookie、Origin及明确代理边界', async()=>{
 const prior={NODE_ENV:process.env.NODE_ENV,WEB_ORIGIN:process.env.WEB_ORIGIN,TRUST_PROXY:process.env.TRUST_PROXY};let production:any;
 try{
  process.env.NODE_ENV='production';process.env.WEB_ORIGIN='https://mes.xiaomtech.cn';process.env.TRUST_PROXY='127.0.0.1';production=await(await import('../apps/api/src/app.js')).buildApp();production.get('/__test/ip',(req:any)=>({ip:req.ip}));
  const denied=await production.inject({method:'POST',url:'/api/v1/auth/login',headers:{'x-mes-api-version':'2',origin:'https://evil.invalid'},payload:{username:'test-admin',password}});expect(denied.statusCode).toBe(403);
  const login=await production.inject({method:'POST',url:'/api/v1/auth/login',headers:{'x-mes-api-version':'2',origin:'https://mes.xiaomtech.cn'},payload:{username:'test-admin',password}});expect(login.statusCode).toBe(200);expect(login.headers['set-cookie']).toMatch(/; Secure/);expect(login.headers['set-cookie']).toMatch(/; HttpOnly/);expect(login.headers['set-cookie']).toMatch(/SameSite=Lax/i);
  expect((await production.inject({method:'GET',url:'/__test/ip',remoteAddress:'127.0.0.1',headers:{'x-forwarded-for':'198.51.100.27'}})).json().ip).toBe('198.51.100.27');
  expect((await production.inject({method:'GET',url:'/__test/ip',remoteAddress:'198.51.100.3',headers:{'x-forwarded-for':'198.51.100.27'}})).json().ip).toBe('198.51.100.3');
  process.env.TRUST_PROXY='0.0.0.0/0';await expect((await import('../apps/api/src/app.js')).buildApp()).rejects.toThrow('明确的代理IP');
 }finally{await production?.close();for(const [k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test('本人改密：角色、会话撤销、校验、审计及并发', async()=>{
 const {hashPassword,tokenHash}=await import('../apps/api/src/security.js');
 let ip=40;
 async function call(path:string,body:any,auth?:string,origin?:string){return app.inject({method:'POST',url:'/api/v1/'+path,remoteAddress:'127.0.1.'+(ip++),headers:{'content-type':'application/json','x-mes-api-version':'2',...(auth?{cookie:auth}:{}),...(origin?{origin}:{})},payload:body});}
 for(const role of ['ADMIN','VIEWER']){
  const userUuid=randomUUID(),username='password-'+role,old='Old-Test!Password123',next='New-Test!Password456';
  await pool.query('INSERT INTO users(uuid,username,password_hash,role,active) VALUES(?,?,?,?,true)',[userUuid,username,hashPassword(old),role]);const id=(await pool.query('SELECT id FROM users WHERE username=?',[username])).rows[0].id;
  const login=async(p=old)=>call('auth/login',{username,password:p});
  const one=await login(),two=await login(); const auth=one.headers['set-cookie'].split(';')[0],other=two.headers['set-cookie'].split(';')[0];
  expect((await call('auth/change-password',{oldPassword:old,newPassword:next})).statusCode).toBe(401);
  expect((await call('auth/change-password',{oldPassword:old,newPassword:next},auth,'https://evil.invalid')).statusCode).toBe(403);
  const before=(await pool.query('SELECT password_hash FROM users WHERE id=?',[id])).rows[0];
  for(const body of [{oldPassword:'wrong',newPassword:next},{oldPassword:old,newPassword:'short'},{oldPassword:old,newPassword:old},{oldPassword:old,newPassword:next,userId:randomUUID()},{oldPassword:old,newPassword:'x'.repeat(201)}]) expect((await call('auth/change-password',body,auth)).statusCode).toBe(400);
  expect((await pool.query('SELECT password_hash FROM users WHERE id=?',[id])).rows[0]).toEqual(before);
  expect((await pool.query('SELECT count(*) n FROM sessions WHERE user_id=?',[id])).rows[0].n).toBe(2);
  const changed=await call('auth/change-password',{oldPassword:old,newPassword:next},auth);expect(changed.statusCode).toBe(200);expect(changed.headers['set-cookie']).toContain('Max-Age=0');
  expect((await request('GET','auth/me',undefined,other)).status).toBe(401);
  expect((await login()).statusCode).toBe(401);expect((await login(next)).statusCode).toBe(200);
  const logs=(await pool.query("SELECT before_json,after_json FROM audit_logs WHERE entity_id=? AND action='CHANGE_PASSWORD'",[id])).rows;
  expect(logs).toEqual([{before_json:null,after_json:{id,uuid:userUuid}}]);expect(JSON.stringify(logs)).not.toContain(old);
  const fresh=await login(next),auth2=fresh.headers['set-cookie'].split(';')[0];
  const outcomes=await Promise.all([call('auth/change-password',{oldPassword:next,newPassword:'Concurrent!Password789'},auth2),call('auth/change-password',{oldPassword:next,newPassword:'Concurrent!Password000'},auth2)]);
  expect(outcomes.map(x=>x.statusCode).sort()).toEqual([200,401]);
  const winning=outcomes[0].statusCode===200?'Concurrent!Password789':'Concurrent!Password000';
  const raceLogin=await login(winning),raceAuth=raceLogin.headers['set-cookie'].split(';')[0];
  await Promise.all([login(winning),call('auth/change-password',{oldPassword:winning,newPassword:'Final-Test!Password999'},raceAuth)]);
  expect((await pool.query('SELECT count(*) n FROM sessions WHERE user_id=?',[id])).rows[0].n).toBe(0);
  expect((await login(winning)).statusCode).toBe(401);expect((await login('Final-Test!Password999')).statusCode).toBe(200);
 }
});

test('ORG-日历年度唯一、周规则例外恢复、原子并发、日期范围与引用', async()=>{
 const year=2028;
 let cal=await ok('POST','factory-calendars',{factory_id:fa.id,year,workDays:[1,2,3,4,5]});
 expect(cal.weekPatterns[0].work_days).toEqual([1,2,3,4,5]);
 expect(cal.timezone).toBe('Asia/Shanghai');
 expect((await request('POST','factory-calendars',{factory_id:fa.id,year,workDays:[1]})).status).toBe(409);
 expect((await request('POST',`factory-calendars/${cal.id}/deactivate`,{revision:cal.revision,reason:'拒绝草稿停用'})).status).toBe(422);
 expect((await request('PUT',`factories/${fa.id}`,{revision:fa.revision,timezone:'UTC'})).status).toBe(422);
 const changes=[{date:'2028-02-29',operation:'REST',note:'闰年休息'},{date:'2028-03-05',operation:'WORK',note:'周末补班'}];
 cal=await ok('PUT',`factory-calendars/${cal.id}/rules`,{revision:cal.revision,reason:'例外设置',changes});
 expect(cal.exceptions).toHaveLength(2);
 const before=JSON.stringify(cal);
 expect((await request('PUT',`factory-calendars/${cal.id}/rules`,{revision:cal.revision,reason:'全部回滚',changes:[{date:'2028-04-01',operation:'REST'},{date:'2028-02-30',operation:'WORK'}],remark:'不应保存'})).status).toBe(422);
 expect(JSON.stringify(await ok('GET',`factory-calendars/${cal.id}`))).toBe(before);
 const raced=await Promise.all([1,2].map(()=>request('PUT',`factory-calendars/${cal.id}/rules`,{revision:cal.revision,reason:'竞争',changes:[{date:'2028-03-05',operation:'RESET'}]})));
 expect(raced.map(x=>x.status).sort()).toEqual([200,409]);
 cal=await ok('GET',`factory-calendars/${cal.id}`);expect(cal.exceptions).toHaveLength(1);
 cal=await ok('POST',`factory-calendars/${cal.id}/activate`,{revision:cal.revision,reason:'启用年度日历'});
 const result=await ok('GET',`factories/${fa.id}/work-calendar?from=2028-02-29&to=2028-03-05`);
 expect(result.items[0]).toMatchObject({availability:'AVAILABLE',is_working:false,source:'EXCEPTION',note:'闰年休息'});
 expect(result.items[5]).toMatchObject({is_working:false,source:'WEEK'});
 const cross=await ok('GET',`factories/${fa.id}/work-calendar?from=2027-12-31&to=2028-01-01`);
 expect(cross.items.map((x:any)=>x.availability)).toEqual(['UNCONFIGURED','AVAILABLE']);
 for(const range of ['from=2027-02-29&to=2027-03-01','from=9999-12-31&to=9999-12-31','from=2028-01-01&to=2029-01-01'])expect((await request('GET',`factories/${fa.id}/work-calendar?${range}`)).status).toBe(422);
 expect((await ok('GET',`factories/${fa.id}/references`)).items.some((x:any)=>x.type==='工作日历')).toBe(true);
 expect((await ok('GET',`factory-calendars/${cal.id}/audit`)).some((x:any)=>x.reason==='例外设置')).toBe(true);
 expect((await request('DELETE',`factory-calendars/${cal.id}`,{revision:cal.revision})).status).toBe(409);
 cal=await ok('POST',`factory-calendars/${cal.id}/deactivate`,{revision:cal.revision,reason:'停用'});
 expect((await ok('GET',`factories/${fa.id}/work-calendar?from=2028-02-29&to=2028-02-29`)).items[0]).toMatchObject({availability:'UNAVAILABLE',is_working:null});
});

test('ORG-历史锁、年中周规则、父级停用与日历角色范围',async()=>{
 const c=await create('companies',{code:'ORGTEST',name:'日历验收公司'});
 let f=await create('factories',{company_id:c.id,code:'ORGTEST',name:'日历验收工厂',timezone:'Pacific/Kiritimati'});
 let cal=await ok('POST','factory-calendars',{factory_id:f.id,year:2026,workDays:[1,2,3,4,5]});
 cal=await ok('POST',`factory-calendars/${cal.id}/activate`,{revision:cal.revision,reason:'历史锁'});
 expect(cal.today).toMatch(/^2026-\d{2}-\d{2}$/);
 expect((await request('PUT',`factory-calendars/${cal.id}/rules`,{revision:cal.revision,reason:'拒绝历史',changes:[{date:'2026-01-01',operation:'REST'}]})).status).toBe(422);
 expect((await request('PUT',`factory-calendars/${cal.id}/rules`,{revision:cal.revision,reason:'拒绝历史改周',weekPatterns:[{valid_from:'2026-01-01',valid_to:'2027-01-01',work_days:[1]}]})).status).toBe(422);
 cal=await ok('PUT',`factory-calendars/${cal.id}/rules`,{revision:cal.revision,reason:'未来周调整',weekPatterns:[{valid_from:'2026-01-01',valid_to:'2026-12-01',work_days:[1,2,3,4,5]},{valid_from:'2026-12-01',valid_to:'2027-01-01',work_days:[1,2,3,4,5,6]}]});
 cal=await ok('POST',`factory-calendars/${cal.id}/deactivate`,{revision:cal.revision,reason:'历史锁保持'});
 expect((await request('PUT',`factory-calendars/${cal.id}/rules`,{revision:cal.revision,reason:'停用后历史不可改',changes:[{date:'2026-01-01',operation:'RESET'}]})).status).toBe(422);
 for(const auth of [editorCookie,viewerCookie]){
 expect((await request('GET',`factory-calendars/${cal.id}`,undefined,auth)).status).toBe(404);
 expect((await request('GET',`factories/${f.id}/work-calendar?from=2026-12-01&to=2026-12-01`,undefined,auth)).status).toBe(404);
 }
 expect((await request('POST','factory-calendars',{factory_id:fa.id,year:2029,workDays:[1]},viewerCookie)).status).toBe(403);
 expect((await request('GET',`factory-calendars/${cal.id}/audit`,undefined,editorCookie)).status).toBe(404);
 f=await ok('POST',`factories/${f.id}/deactivate`,{revision:f.revision,reason:'停用父级'});
 expect((await ok('GET',`factory-calendars/${cal.id}`)).effectiveness_reasons.length).toBeGreaterThan(1);
 expect((await request('PUT',`factory-calendars/${cal.id}/rules`,{revision:cal.revision,reason:'禁止修改',changes:[{date:'2026-12-01',operation:'WORK'}]})).status).toBe(422);
 expect((await request('POST',`factory-calendars/${cal.id}/activate`,{revision:cal.revision,reason:'禁止启用'})).status).toBe(422);
});

test('ORG-EDITOR维护、RELEASER启停、VIEWER只读和双重组织授权',async()=>{
 const {hashPassword}=await import('../apps/api/src/security.js');
 const c=await create('companies',{code:'CALMATRIX',name:'权限验收'});
 const f=await create('factories',{company_id:c.id,code:'CALMATRIX',name:'授权工厂'});
 const f2=await create('factories',{company_id:c.id,code:'CALMATRIX2',name:'第二工厂'});
 const auths:Record<string,string>={};let ip=100;
 for(const role of ['EDITOR','RELEASER','VIEWER']){
  const userUuid=randomUUID(),username='calendar-'+role;
  await pool.query('INSERT INTO users(uuid,username,password_hash,role,active) VALUES(?,?,?,?,true)',[userUuid,username,hashPassword(password),role]);const id=(await pool.query('SELECT id FROM users WHERE username=?',[username])).rows[0].id;
  await pool.query('INSERT INTO user_company_scopes VALUES(?,?)',[id,c.id]);await pool.query('INSERT INTO user_factory_scopes VALUES(?,?)',[id,f.id]);
  const r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.0.2.'+(ip++),headers:{'content-type':'application/json','x-mes-api-version':'2'},payload:{username,password}});expect(r.statusCode).toBe(200);auths[role]=r.headers['set-cookie'].split(';')[0];
 }
 const call=(role:string,method:string,path:string,body?:any)=>request(method,path,body,auths[role]);
 let r=await call('EDITOR','POST','factory-calendars',{factory_id:f.id,year:2030,workDays:[]});expect(r.status).toBe(201);let cal=r.body.data;
 expect((await call('EDITOR','POST',`factory-calendars/${cal.id}/activate`,{revision:1,reason:'无启用权限'})).status).toBe(403);
 expect((await call('RELEASER','PUT',`factory-calendars/${cal.id}/rules`,{revision:1,reason:'无编辑权限',changes:[]})).status).toBe(403);
 expect((await call('VIEWER','DELETE',`factory-calendars/${cal.id}`,{revision:1})).status).toBe(403);
 r=await call('EDITOR','PUT',`factory-calendars/${cal.id}/rules`,{revision:1,reason:'维护',changes:[{date:'2030-01-01',operation:'WORK',note:'指定工作'}]});expect(r.status).toBe(200);cal=r.body.data;
 r=await call('RELEASER','POST',`factory-calendars/${cal.id}/activate`,{revision:cal.revision,reason:'授权启用'});expect(r.status).toBe(200);cal=r.body.data;
 expect((await call('VIEWER','GET',`factory-calendars/${cal.id}`)).status).toBe(200);
 expect((await call('VIEWER','GET',`factories/${f.id}/work-calendar?from=2030-01-01&to=2030-01-01`)).body.data.items[0].is_working).toBe(true);
 const hidden=await ok('POST','factory-calendars',{factory_id:f2.id,year:2030,workDays:[1]});
 expect((await call('EDITOR','GET',`factory-calendars/${hidden.id}`)).status).toBe(404);
 expect((await call('EDITOR','POST','factory-calendars',{factory_id:f2.id,year:2031,workDays:[1]})).status).toBe(404);
 expect((await call('EDITOR','GET',`factory-calendars?factory_id=${f2.id}`)).status).toBe(404);
 expect((await call('EDITOR','GET',`companies/${c.id}/references`)).body.data.items.find((x:any)=>x.type==='工作日历').count).toBe(1);expect((await call('EDITOR','GET',`factory-calendars/${cal.id}/audit`)).status).toBe(403);
 const editable=await call('EDITOR','POST','factory-calendars',{factory_id:f.id,year:2031,workDays:[7]});expect(editable.status).toBe(201);
 expect((await call('EDITOR','DELETE',`factory-calendars/${editable.body.data.id}`,{revision:1})).status).toBe(200);
 const dup=await Promise.all([1,2].map(()=>request('POST','factory-calendars',{factory_id:f.id,year:2032,workDays:[1]})));expect(dup.map(x=>x.status).sort()).toEqual([201,409]);
});

test('WC-工厂一对多、编码范围、归属固定、状态引用并发与审计',async()=>{
 const c=await create('companies',{code:'WCTEST',name:'工作中心公司'});
 let f=await create('factories',{company_id:c.id,code:'WCTEST',name:'工作中心一厂'});
 const f2=await create('factories',{company_id:c.id,code:'WCTEST2',name:'工作中心二厂'});
 let w=await ok('POST','work-centers',{factory_id:f.id,code:' wc01 ',name:' 加工中心 ',remark:'说明'});expect(w).toMatchObject({company_id:c.id,factory_id:f.id,code:'WC01',name:'加工中心',status:'DRAFT'});
 const w2=await ok('POST','work-centers',{factory_id:f.id,code:'WC02',name:'装配中心'});expect(w2.factory_id).toBe(f.id);
 expect((await request('POST','work-centers',{factory_id:f.id,code:'wc01',name:'重复'})).status).toBe(409);
 expect((await request('POST','work-centers',{factory_id:f2.id,code:'WC01',name:'另一厂'})).status).toBe(201);
 expect((await request('POST','work-centers',{code:'NOFACTORY',name:'缺厂'})).status).toBe(422);
 expect((await request('POST','work-centers',{company_id:co.id,factory_id:f.id,code:'FORGED',name:'伪造公司'})).status).toBe(422);
 expect((await request('PUT','work-centers/'+w.id,{factory_id:f2.id,revision:w.revision})).status).toBe(422);
 const raced=await Promise.all([1,2].map(i=>request('PUT','work-centers/'+w.id,{revision:w.revision,name:'并发'+i,reason:'并发修订'})));expect(raced.map(x=>x.status).sort()).toEqual([200,409]);w=await ok('GET','work-centers/'+w.id);
 expect((await request('GET','work-centers?factory_id='+f.id)).body.total).toBe(2);expect((await ok('GET','factories/'+f.id)).work_center_count).toBe(2);
 expect((await ok('GET','factories/'+f.id+'/references')).items.find((x:any)=>x.type==='工作中心').count).toBe(2);
 expect((await request('DELETE','factories/'+f.id,{revision:f.revision})).status).toBe(409);
 expect((await request('POST','work-centers/'+w.id+'/deactivate',{revision:w.revision,reason:'草稿不可停用'})).status).toBe(422);
 w=await ok('POST','work-centers/'+w.id+'/activate',{revision:w.revision,reason:'启用'});expect(w.effective_active).toBe(true);expect(w.factory_calendar.factory_id).toBe(f.id);
 expect((await request('PUT','work-centers/'+w.id,{revision:w.revision,code:'CHANGED'})).status).toBe(422);
 expect((await request('DELETE','work-centers/'+w.id,{revision:w.revision})).status).toBe(409);
 f=await ok('POST','factories/'+f.id+'/deactivate',{revision:f.revision,reason:'父停用'});expect((await ok('GET','work-centers/'+w.id)).effective_active).toBe(false);
 expect((await request('PUT','work-centers/'+w.id,{revision:w.revision,name:'父失效不可编辑'})).status).toBe(422);
 expect((await request('POST','work-centers',{factory_id:f.id,code:'NEW',name:'父失效不可新增'})).status).toBe(422);
 expect((await request('POST','work-centers/'+w.id+'/activate',{revision:w.revision,reason:'父失效'})).status).toBe(422);
 w=await ok('POST','work-centers/'+w.id+'/deactivate',{revision:w.revision,reason:'允许停用'});
 expect((await request('DELETE','work-centers/'+w2.id,{revision:w2.revision})).status).toBe(200);
 f=await ok('POST','factories/'+f.id+'/activate',{revision:f.revision,reason:'恢复父级'});w=await ok('POST','work-centers/'+w.id+'/activate',{revision:w.revision,reason:'恢复中心'});expect(w.effective_active).toBe(true);
 expect((await ok('GET','work-centers/'+w.id+'/audit')).map((x:any)=>x.action)).toEqual(expect.arrayContaining(['CREATE','UPDATE','ACTIVATE','DEACTIVATE']));expect((await ok('GET','work-centers/'+w.id+'/references')).message).toContain('尚未接入');
});

test('WC-角色双重工厂范围、引用过滤及父停用竞争',async()=>{
 const {hashPassword}=await import('../apps/api/src/security.js');const c=await create('companies',{code:'WCSCOPE',name:'工作中心授权公司'});let f=await create('factories',{company_id:c.id,code:'WCSCOPE',name:'范围工厂'});const f2=await create('factories',{company_id:c.id,code:'WCHIDDEN',name:'不可见工厂'});
 const auths:Record<string,string>={};let ip=50;for(const role of ['EDITOR','RELEASER','VIEWER']){const userUuid=randomUUID(),username='wc-'+role;await pool.query('INSERT INTO users(uuid,username,password_hash,role,active) VALUES(?,?,?,?,true)',[userUuid,username,hashPassword(password),role]);const id=(await pool.query('SELECT id FROM users WHERE username=?',[username])).rows[0].id;await pool.query('INSERT INTO user_company_scopes VALUES(?,?)',[id,c.id]);await pool.query('INSERT INTO user_factory_scopes VALUES(?,?)',[id,f.id]);const r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.0.3.'+(ip++),headers:{'content-type':'application/json','x-mes-api-version':'2'},payload:{username,password}});expect(r.statusCode).toBe(200);auths[role]=r.headers['set-cookie'].split(';')[0];}
 let r=await request('POST','work-centers',{factory_id:f.id,code:'WC01',name:'范围内'},auths.EDITOR);expect(r.status).toBe(201);let w=r.body.data;const hidden=await ok('POST','work-centers',{factory_id:f2.id,code:'WC01',name:'范围外'});
 for(const suffix of ['', '/references','/audit'])expect((await request('GET','work-centers/'+hidden.id+suffix,undefined,auths.EDITOR)).status).toBe(404);
 expect((await request('GET','work-centers?factory_id='+f2.id,undefined,auths.EDITOR)).status).toBe(404);
 expect((await request('POST','work-centers',{factory_id:f2.id,code:'HIDDEN',name:'拒绝'},auths.EDITOR)).status).toBe(404);
 expect((await request('POST','work-centers/'+w.id+'/activate',{revision:w.revision,reason:'不允许'},auths.EDITOR)).status).toBe(403);
 expect((await request('PUT','work-centers/'+w.id,{revision:w.revision,name:'不允许'},auths.RELEASER)).status).toBe(403);
 expect((await request('DELETE','work-centers/'+w.id,{revision:w.revision},auths.VIEWER)).status).toBe(403);
 r=await request('POST','work-centers/'+w.id+'/activate',{revision:w.revision,reason:'范围启用'},auths.RELEASER);expect(r.status).toBe(200);w=r.body.data;
 expect((await request('GET','companies/'+c.id+'/references',undefined,auths.EDITOR)).body.data.items.find((x:any)=>x.type==='工作中心').count).toBe(1);
 const race=await Promise.all([request('POST','factories/'+f.id+'/deactivate',{revision:f.revision,reason:'并发停父'}),request('PUT','work-centers/'+w.id,{revision:w.revision,name:'并发编辑'})]);expect(race[0].status).toBe(200);expect([200,422]).toContain(race[1].status);expect((await ok('GET','work-centers/'+w.id)).effective_active).toBe(false);
});

const nrConfig=(company_id:string,purpose='MO',extra:any={})=>({company_id,factory_id:null,scope_type:'COMPANY',purpose,code:'N_'+randomUUID().slice(0,8),name:'编号规则',prefix:'TEST_'+purpose,date_format:'YYYYMMDD',sequence_width:5,reset_period:'DAY',timezone:'Asia/Shanghai',...extra});
async function nrFixture(purpose='MO',extra:any={}){const c=await create('companies',{code:'N'+randomUUID().slice(0,8),name:'编号测试公司'});let rule=await ok('POST','numbering-rules',nrConfig(c.id,purpose,extra));return {c,rule};}
async function nrRequest(rule:any,extra:any={}){return {rule_id:rule.id,rule_uuid:rule.uuid,company_id:rule.company_id,company_uuid:rule.company_uuid,factory_id:rule.factory_id,factory_uuid:rule.factory_uuid,purpose:rule.purpose,request_key:randomUUID(),business_type:({MO:'production-order',LOT:'production-batch',SN:'product-serial-batch'} as any)[rule.purpose],business_id:randomUUID(),quantity:1,business_digest:'a'.repeat(64),requestTime:new Date('2026-10-24T10:00:00Z'),businessAuthorization:{company_id:rule.company_id,company_uuid:rule.company_uuid,factory_id:rule.factory_id,factory_uuid:rule.factory_uuid,purpose:rule.purpose,business_type:({MO:'production-order',LOT:'production-batch',SN:'product-serial-batch'} as any)[rule.purpose]},...extra};}
async function nrBusiness(requestBody:any,abort=false){const {allocateNumbers}=await import('../apps/api/src/numbering.js');const {transaction}=await import('../apps/api/src/db.js');const actor=await ok('GET','auth/me');for(let attempt=0;attempt<3;attempt++){try{const allocated=await transaction(async tx=>{const result=await allocateNumbers(tx,actor,requestBody);if(abort)throw new Error('模拟业务保存失败');await tx.query('INSERT INTO numbering_test_business(id,allocation_id) VALUES(?,?) ON DUPLICATE KEY UPDATE allocation_id=allocation_id',[requestBody.business_id,result.id]);return result;});register("number-allocations",allocated);return allocated;}catch(e:any){if(attempt<2&&['ALLOCATION_RACE','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','MES_LOCK_TIMEOUT'].includes(e.code))continue;throw e;}}throw Error('重试耗尽');}
test('NUM-规则生命周期、无占号预览、冻结核心、命名空间竞争',async()=>{
 await pool.query('CREATE TABLE numbering_test_business(id CHAR(36) PRIMARY KEY,allocation_id BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB');
 const {c,rule:initial}=await nrFixture();let r=initial;
 const count=async()=>JSON.stringify((await pool.query('SELECT count(*) n,COALESCE(SUM(current_value),0) total FROM numbering_counters')).rows);
 const before=await count();const config=nrConfig(c.id);delete (config as any).code;delete (config as any).name;const preview=await ok('POST','numbering-rules/preview',{...config,sampleSequence:'42'});expect(preview.number).toMatch(/TEST_MO-\d{8}-00042/);expect(preview.message).toContain('不保留');expect(await count()).toBe(before);
 expect((await request('POST','numbering-rules/preview',{...config,reset_period:'DAY',date_format:'YYYY',sampleSequence:'1'})).status).toBe(422);
 r=await ok('PUT','numbering-rules/'+r.id,{revision:r.revision,name:'规则更新'});
 const second=await ok('POST','numbering-rules',nrConfig(c.id));const outcomes=await Promise.all([r,second].map(row=>request('POST','numbering-rules/'+row.id+'/activate',{revision:row.revision,reason:'并发命名空间启用'})));expect(outcomes.map(x=>x.status).sort()).toEqual([200,409]);r=outcomes.find(x=>x.status===200)!.body.data;
 expect((await request('PUT','numbering-rules/'+r.id,{revision:r.revision,prefix:'CHANGED'})).status).toBe(422);expect((await request('PUT','numbering-rules/'+r.id,{revision:r.revision,timezone:'UTC'})).status).toBe(422);
 r=await ok('PUT','numbering-rules/'+r.id,{revision:r.revision,name:'启用后仍可改名'});expect((await request('DELETE','numbering-rules/'+r.id,{revision:r.revision})).status).toBe(409);
 expect((await request('POST','numbering-rules/'+r.id+'/allocate',{})).status).toBe(404);expect((await request('POST','number-allocations',{})).status).toBe(404);
});
test('NUM-同键/异键并发、跨日幂等、对象唯一、分配查询与事务回滚',async()=>{
 let {rule:r}=await nrFixture('SN');r=await ok('POST','numbering-rules/'+r.id+'/activate',{revision:r.revision,reason:'启用'});
 const b=await nrRequest(r,{quantity:3});const results=await Promise.all(Array.from({length:6},()=>nrBusiness(b)));expect(new Set(results.map(x=>x.id)).size).toBe(1);expect(results[0].items.map((x:any)=>x.sequence_value)).toEqual(['1','2','3']);
 const distinct=await Promise.all(Array.from({length:8},async()=>nrBusiness(await nrRequest(r))));expect(new Set(distinct.flatMap(x=>x.items.map((i:any)=>i.number))).size).toBe(8);
 const repeat=await nrBusiness({...b,requestTime:new Date('2026-10-25T10:00:00Z')});expect(repeat.id).toBe(results[0].id);
 await expect(nrBusiness({...b,quantity:4})).rejects.toMatchObject({statusCode:409,code:'IDEMPOTENCY_CONFLICT'});await expect(nrBusiness({...b,request_key:randomUUID()})).rejects.toMatchObject({statusCode:409,code:'BUSINESS_NUMBER_EXISTS'});
 const totals=async()=>{const out=[];for(const t of ['numbering_counters','number_allocations','number_allocation_items','audit_logs','numbering_test_business'])out.push((await pool.query('SELECT count(*) n FROM '+t)).rows[0].n);out.push((await pool.query('SELECT CAST(SUM(current_value) AS CHAR) n FROM numbering_counters')).rows[0].n);return out;};const before=await totals();await expect(nrBusiness(await nrRequest(r),true)).rejects.toThrow('模拟业务保存失败');expect(await totals()).toEqual(before);
 const list=await request('GET','number-allocations?number='+encodeURIComponent(results[0].items[0].number));expect(list.body.total).toBe(1);expect(list.body.items[0].fingerprint).toBeUndefined();expect((await ok('GET','number-allocations/'+repeat.id)).items).toHaveLength(3);
 r=await ok('POST','numbering-rules/'+r.id+'/deactivate',{revision:r.revision,reason:'停用后历史幂等'});expect((await nrBusiness(b)).id).toBe(repeat.id);await expect(nrBusiness(await nrRequest(r))).rejects.toMatchObject({statusCode:422});
});
test('NUM-工厂时区/周期、替代规则续号、最终号碰撞、整批溢出',async()=>{
 const {numberingDate}=await import('../apps/api/src/numbering.js');expect(numberingDate(new Date('2026-10-23T16:01:00Z'),'Asia/Shanghai')).toBe('2026-10-24');expect(numberingDate(new Date('2026-10-23T16:01:00Z'),'America/New_York')).toBe('2026-10-23');
 const {c}=await nrFixture('LOT');const f1=await create('factories',{company_id:c.id,code:'NFA',name:'编号厂A',timezone:'Pacific/Kiritimati'}),f2=await create('factories',{company_id:c.id,code:'NFB',name:'编号厂B',timezone:'UTC'});
 let r=await ok('POST','numbering-rules',nrConfig(c.id,'SN',{factory_id:f1.id,scope_type:'FACTORY',prefix:'COLLIDE',reset_period:'NONE',date_format:'NONE',sequence_width:3}));r=await ok('POST','numbering-rules/'+r.id+'/activate',{revision:r.revision,reason:'启用'});expect(r.timezone).toBe('Pacific/Kiritimati');const first=await nrBusiness(await nrRequest(r));expect(first.items[0].number).toBe('COLLIDE-001');
 r=await ok('POST','numbering-rules/'+r.id+'/deactivate',{revision:r.revision,reason:'替代'});let next=await ok('POST','numbering-rules',nrConfig(c.id,'SN',{factory_id:f1.id,scope_type:'FACTORY',prefix:'REPLACED',reset_period:'NONE',date_format:'NONE',sequence_width:3}));next=await ok('POST','numbering-rules/'+next.id+'/activate',{revision:next.revision,reason:'接续旧流水'});expect((await nrBusiness(await nrRequest(next))).items[0].sequence_value).toBe('2');
 let other=await ok('POST','numbering-rules',nrConfig(c.id,'SN',{factory_id:f2.id,scope_type:'FACTORY',prefix:'COLLIDE',reset_period:'NONE',date_format:'NONE',sequence_width:3}));other=await ok('POST','numbering-rules/'+other.id+'/activate',{revision:other.revision,reason:'另一厂'});await expect(nrBusiness(await nrRequest(other))).rejects.toMatchObject({statusCode:409,code:'NUMBER_COLLISION'});
 const before=(await pool.query('SELECT count(*) n FROM number_allocations')).rows[0].n;await expect(nrBusiness(await nrRequest(next,{quantity:1000}))).rejects.toMatchObject({statusCode:422});expect((await pool.query('SELECT count(*) n FROM number_allocations')).rows[0].n).toBe(before);
 for(const quantity of [0,1001])await expect(nrBusiness(await nrRequest(next,{quantity}))).rejects.toThrow();
 for(const reset of ['MONTH','YEAR','NONE']){let period=await ok('POST','numbering-rules',nrConfig(c.id,'MO',{prefix:'PERIOD_'+reset,reset_period:reset,date_format:'YYYYMMDD'}));period=await ok('POST','numbering-rules/'+period.id+'/activate',{revision:period.revision,reason:'周期'});const a=await nrBusiness(await nrRequest(period,{requestTime:new Date('2026-12-31T00:00:00Z')})),b=await nrBusiness(await nrRequest(period,{requestTime:new Date('2027-01-01T00:00:00Z')}));expect(a.items[0].sequence_value).toBe('1');expect(b.items[0].sequence_value).toBe(reset==='NONE'?'2':'1');period=await ok('POST','numbering-rules/'+period.id+'/deactivate',{revision:period.revision,reason:'下一周期测试'});}
});

test('NUM-取号强制外层事务、提交回滚释放后拒绝与DDL误用保护',async()=>{
 const {pool:db,transaction}=await import('../apps/api/src/db.js');const {allocateNumbers}=await import('../apps/api/src/numbering.js');const actor=await ok('GET','auth/me');let {rule}=await nrFixture('MO',{prefix:'TXONLY'});rule=await ok('POST','numbering-rules/'+rule.id+'/activate',{revision:rule.revision,reason:'事务验证'});const b=await nrRequest(rule);const count=async()=> (await pool.query('SELECT count(*) n FROM number_allocations')).rows[0].n;const before=await count();const c=await db.connect();await expect(allocateNumbers(c,actor,b)).rejects.toMatchObject({code:'BUSINESS_TRANSACTION_REQUIRED'});expect(await count()).toBe(before);await c.query('START TRANSACTION');await expect(c.query('START TRANSACTION')).rejects.toThrow('禁止DDL');await expect(c.query('CREATE TABLE numbering_forbidden_ddl(id INT)')).rejects.toThrow('禁止DDL');await c.query('ROLLBACK');await expect(allocateNumbers(c,actor,b)).rejects.toMatchObject({code:'BUSINESS_TRANSACTION_REQUIRED'});await c.query('START TRANSACTION');await c.query('COMMIT');await expect(allocateNumbers(c,actor,b)).rejects.toMatchObject({code:'BUSINESS_TRANSACTION_REQUIRED'});await c.release();await expect(allocateNumbers(c,actor,b)).rejects.toMatchObject({code:'BUSINESS_TRANSACTION_REQUIRED'});expect(await count()).toBe(before);
});

test('NUM-公司工厂范围、角色、只读父停用预览及业务授权',async()=>{
 const {hashPassword}=await import('../apps/api/src/security.js');const {c,rule}=await nrFixture('LOT');const f=await create('factories',{company_id:c.id,code:'NRSCOPE',name:'无权编号工厂'});const hidden=await ok('POST','numbering-rules',nrConfig(c.id,'MO',{scope_type:'FACTORY',factory_id:f.id}));const auth:Record<string,string>={};let ip=10;for(const role of ['EDITOR','RELEASER','VIEWER']){const userUuid=randomUUID(),username='nr-'+role;await pool.query('INSERT INTO users(uuid,username,password_hash,role,active) VALUES(?,?,?,?,true)',[userUuid,username,hashPassword(password),role]);const id=(await pool.query('SELECT id FROM users WHERE username=?',[username])).rows[0].id;await pool.query('INSERT INTO user_company_scopes VALUES(?,?)',[id,c.id]);const r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.0.5.'+(ip++),headers:{'content-type':'application/json','x-mes-api-version':'2'},payload:{username,password}});auth[role]=r.headers['set-cookie'].split(';')[0];}
 for(const suffix of ['', '/references','/audit'])expect((await request('GET','numbering-rules/'+hidden.id+suffix,undefined,auth.EDITOR)).status).toBe(404);
 expect((await request('GET','numbering-rules?factory_id='+f.id,undefined,auth.VIEWER)).status).toBe(404);
 const cfg=nrConfig(c.id,'MO',{factory_id:f.id,scope_type:'FACTORY'});delete (cfg as any).code;delete (cfg as any).name;expect((await request('POST','numbering-rules/preview',{...cfg,sampleSequence:'1'},auth.VIEWER)).status).toBe(404);
 expect((await request('POST','numbering-rules',nrConfig(c.id),auth.VIEWER)).status).toBe(403);expect((await request('POST','numbering-rules/'+rule.id+'/activate',{revision:rule.revision,reason:'无权启用'},auth.EDITOR)).status).toBe(403);expect((await request('PUT','numbering-rules/'+rule.id,{revision:rule.revision,name:'无权编辑'},auth.RELEASER)).status).toBe(403);
 let active=await ok('POST','numbering-rules/'+rule.id+'/activate',{revision:rule.revision,reason:'授权测试'});const b=await nrRequest(active);await expect(nrBusiness({...b,businessAuthorization:{...b.businessAuthorization,purpose:'MO'}})).rejects.toMatchObject({statusCode:403});const allocation=await nrBusiness(b);
 const coNow=await ok('GET','companies/'+c.id);await ok('POST','companies/'+c.id+'/deactivate',{revision:coNow.revision,reason:'父停用保留历史'});expect((await nrBusiness(b)).id).toBe(allocation.id);await expect(nrBusiness(await nrRequest(active))).rejects.toMatchObject({statusCode:422});const companyCfg=nrConfig(c.id,'LOT');delete (companyCfg as any).code;delete (companyCfg as any).name;expect((await request('POST','numbering-rules/preview',{...companyCfg,sampleSequence:'2'},auth.VIEWER)).status).toBe(200);
 expect((await request('GET','number-allocations/'+allocation.id,undefined,viewerCookie)).status).toBe(404);expect((await request('GET','number-allocations?company_id='+c.id,undefined,viewerCookie)).status).toBe(404);
});

test('ID-V2 配对/版本门禁显式恶意输入不被测试helper补正',async()=>{
 const c=await create('companies',{code:'V2PAIR',name:'配对门禁验收'});
 const headers={'cookie':cookie,'x-mes-api-version':'2'};
 const raw=(method:string,path:string,body?:any,extra:Record<string,string>={})=>app.inject({method,url:'/api/v1/'+path,headers:{...headers,...extra},payload:body});
 expect(typeof c.id).toBe('string');expect(c.id).toMatch(/^[1-9][0-9]*$/);expect(c.uuid).toMatch(/^[0-9a-f-]{36}$/);
 expect((await raw('GET','companies/'+c.id)).statusCode).toBe(422);
 expect((await request('GET','companies/'+c.id,undefined,cookie,{'x-resource-uuid':randomUUID()})).status).toBe(404);
 expect((await raw('GET','companies/'+c.id,undefined,{'x-resource-uuid':c.uuid})).statusCode).toBe(200);
 for(const id of ['01','18446744073709551616',c.uuid])expect((await raw('GET','companies/'+id,undefined,{'x-resource-uuid':c.uuid})).statusCode).toBe(422);
 expect((await raw('GET','factories?company_id='+c.id)).statusCode).toBe(422);
 expect((await raw('GET','factories?company_id='+c.id,undefined,{'x-reference-uuids':JSON.stringify({company_id:randomUUID()})})).statusCode).toBe(404);
 expect((await raw('GET','factories',undefined,{'x-reference-uuids':JSON.stringify({company_id:c.uuid})})).statusCode).toBe(422);
 const count=(await pool.query('SELECT count(*) n FROM factories')).rows[0].n;
 expect((await raw('POST','factories',{company_id:c.id,code:'NOPAIR',name:'缺少UUID'})).statusCode).toBe(422);
 expect((await request('POST','factories',{company_id:c.id,company_uuid:randomUUID(),code:'WRONGPAIR',name:'错误配对'})).status).toBe(404);
 expect((await pool.query('SELECT count(*) n FROM factories')).rows[0].n).toBe(count);
 const sessions=(await pool.query('SELECT count(*) n FROM sessions')).rows[0].n;
 const old=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'test-admin',password}});expect(old.statusCode).toBe(426);
 expect((await pool.query('SELECT count(*) n FROM sessions')).rows[0].n).toBe(sessions);
});
