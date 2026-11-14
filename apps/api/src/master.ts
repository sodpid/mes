import type { Connection as PoolClient } from "./db.js";
import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import {compareTarget,insertIdentity,dto} from "./identity.js";
import {resourceTables} from "./entity-map.js";
export class Failure extends Error {
    constructor(public statusCode: number, public code: string, message: string, public fieldErrors?: Record<string, string>) {
        super(message);
    }
}
export const fail = (message: string, field?: string): never => {
    throw new Failure(422, "VALIDATION", message, field ? { [field]: message } : undefined);
};
export const entities = {
    companies: { fields: ["address"] },
    "work-centers": {fields:["company_id","factory_id"]},
    factories: { fields: ["company_id", "address", "timezone"] },
    warehouses: {
        fields: [
            "company_id",
            "factory_id",
            "location_type",
            "custodian_supplier_id",
            "address",
        ],
    },
    locations: {
        fields: ["company_id", "factory_id", "warehouse_id", "usage_hint"],
    },
    partners: {
        fields: [
            "company_id",
            "contact_name",
            "phone",
            "address",
            "supplier_capabilities",
        ],
    },
    units: { fields: ["dimension", "decimal_places"] },
    "material-categories": { fields: ["company_id", "parent_id"] },
    materials: {
        fields: [
            "company_id",
            "category_id",
            "material_kind",
            "specification",
            "base_unit_id",
            "tracking_mode",
            "serial_uniqueness",
        ],
    },
} as const;
export type Entity = keyof typeof entities;
export const table = (e: Entity) => e === "material-categories" ? "material_categories" : e === "work-centers" ? "work_centers" : e;
export type Actor = {
    id: string;
    role: string;
    company_ids: string[];
    factory_ids: string[];
    username: string;
    uuid: string;
    resourcePair?: Readonly<{table:import("./entity-map.js").EntityTable;id:string;uuid:string}>;
};
export async function scope(c: PoolClient, a: Actor, e: Entity, row: any) {
    if (a.role === "ADMIN" || e === "units")
        return;
    if (e === "companies") {
        if (!a.company_ids.includes(row.id))
            throw new Failure(404, "NOT_FOUND", "资料不存在或不可见");
        return;
    }
    if (!a.company_ids.includes(row.company_id) ||
        (row.factory_id && !a.factory_ids.includes(row.factory_id)) ||
        (e === "factories" && !a.factory_ids.includes(row.id)))
        throw new Failure(404, "NOT_FOUND", "资料不存在或不可见");
}
export async function get(c: PoolClient, e: Entity, id: string, a?: Actor, lock = false): Promise<any> {
    if(lock&&e==="work-centers"){const current=await get(c,e,id,a);await get(c,"companies",current.company_id,undefined,true);await get(c,"factories",current.factory_id,undefined,true);}
    if(lock&&e==="material-categories"){const metadata=(await c.query("SELECT company_id FROM material_categories WHERE id=?",[id])).rows[0];if(metadata)await c.lock("categories:"+metadata.company_id);}
    const row = (await c.query(`SELECT * FROM ${table(e)} WHERE id=?${lock ? " FOR UPDATE" : ""}`, [id])).rows[0];
    if (!row)
        throw new Failure(404, "NOT_FOUND", "资料不存在或不可见");
    compareTarget(a,table(e),row);
    if (a)
        await scope(c, a, e, row);
    return row;
}
export async function effective(c: PoolClient, e: Entity, row: any, seen = new Set<string>()): Promise<string[]> {
    if (seen.has(table(e)+":"+row.id))
        return ["分类层级循环"];
    seen.add(table(e)+":"+row.id);
    const reasons: string[] = [];
    if (row.status !== "ACTIVE")
        reasons.push("本资料未启用");
    for (const [field, target] of [
        ["company_id", "companies"],
        ["factory_id", "factories"],
        ["warehouse_id", "warehouses"],
        ["parent_id", "material-categories"],
    ] as const) {
        if (row[field]) {
            const p = await get(c, target, row[field]);
            const r = await effective(c, target, p, new Set(seen));
            if (r.length)
                reasons.push(`${p.code}：${r.join("；")}`);
        }
    }
    if (e === "warehouses" && row.custodian_supplier_id) {
        const p = await get(c, "partners", row.custodian_supplier_id);
        const r = await effective(c, "partners", p, new Set(seen));
        const role = (await c.query("SELECT 1 FROM partner_roles WHERE partner_id=? AND role='SUPPLIER' AND status='ACTIVE'", [p.id])).rowCount;
        if (r.length || !role)
            reasons.push("保管供应商或供应商角色未启用");
    }
    return reasons;
}
export async function detail(c: PoolClient, e: Entity, row: any, a?: Actor) {
    const out = { ...row };
    if(e === "work-centers") out.factory_calendar = {factory_id:row.factory_id,message:"使用工厂工作日历；未配置时不可用于业务"};
    if(e === "factories") out.work_center_count = (await c.query("SELECT count(*) count FROM work_centers WHERE factory_id=?",[row.id])).rows[0].count;
    if(e === "factories") out.calendar_count = (await c.query("SELECT count(*) count FROM factory_calendars WHERE factory_id=?",[row.id])).rows[0].count;
    if (e === "partners")
        out.roles = (await c.query("SELECT role,status FROM partner_roles WHERE partner_id=? ORDER BY role", [row.id])).rows;
    if (e === "materials") {
        out.unitConversions = (await c.query("SELECT unit_id,factor FROM material_units WHERE material_id=?", [row.id])).rows;
        out.factoryPolicies = (await c.query("SELECT * FROM material_factory_policies WHERE material_id=? ORDER BY factory_id", [row.id])).rows;
        if (a && a.role !== "ADMIN")
            out.factoryPolicies = out.factoryPolicies.filter((p: any) => a.factory_ids.includes(p.factory_id));
        for (const p of out.factoryPolicies)
            p.inspectionPolicies = (await c.query("SELECT inspection_type,requirement,exemption_reason FROM material_inspection_policies WHERE policy_id=? ORDER BY inspection_type", [p.id])).rows;
    }
    const reasons = await effective(c, e, row);
    return {
        ...out,
        effective_active: reasons.length === 0,
        effectiveness_reasons: reasons,
    };
}
export async function audit(c:PoolClient,a:Actor,e:string,id:string,action:string,before:any,after:any,reason?:string){
 const tableName=resourceTables[e];const r=after||before||{};
 const entityUUID=r.uuid||(tableName?(await c.query('SELECT uuid FROM '+tableName+' WHERE id=?',[id])).rows[0]?.uuid:null);
 if(!entityUUID)throw new Error('Audit entity UUID unavailable');
 const sourceCompanyId=r.company_id||(e==='companies'?id:null),sourceFactoryId=r.factory_id||(e==='factories'?id:null);
 const companyId=action==='DELETE'&&e==='companies'?null:sourceCompanyId,factoryId=action==='DELETE'&&e==='factories'?null:sourceFactoryId;
 const companyUUID=sourceCompanyId?(r.company_uuid||(e==='companies'?entityUUID:(await c.query('SELECT uuid FROM companies WHERE id=?',[sourceCompanyId])).rows[0]?.uuid)):null;
 const factoryUUID=sourceFactoryId?(r.factory_uuid||(e==='factories'?entityUUID:(await c.query('SELECT uuid FROM factories WHERE id=?',[sourceFactoryId])).rows[0]?.uuid)):null;
 const beforeDTO=before&&tableName?await dto(c,tableName,before):before;
 const afterDTO=after&&tableName?await dto(c,tableName,after):after;
 await insertIdentity(c,'audit_logs',{uuid:randomUUID(),actor_id:a.id,entity_type:e,entity_id:action==='DELETE'?null:id,entity_uuid:entityUUID,action,company_id:companyId,factory_id:factoryId,company_uuid:companyUUID,factory_uuid:factoryUUID,before_json:beforeDTO?JSON.stringify(beforeDTO):null,after_json:afterDTO?JSON.stringify(afterDTO):null,reason:reason||null,snapshot_version:2});
}
const refMap: Record<string, [
    string,
    string,
    string
][]> = {
    companies: [
        ["factories", "company_id", "工厂"],
        ["factory_calendars", "company_id", "工作日历"],
        ["work_centers","company_id","工作中心"],
        ["numbering_rules","company_id","编号规则"],["number_allocations","company_id","编号分配"],
        ["partners", "company_id", "往来单位"],
        ["warehouses", "company_id", "仓库"],
        ["material_categories", "company_id", "分类"],
        ["materials", "company_id", "物料"],
        ["user_company_scopes", "company_id", "用户授权"],
    ],
    factories: [
        ["warehouses", "factory_id", "仓库"],
        ["factory_calendars", "factory_id", "工作日历"],
        ["work_centers","factory_id","工作中心"],
        ["numbering_rules","factory_id","编号规则"],["number_allocations","factory_id","编号分配"],
        ["material_factory_policies", "factory_id", "物料工厂策略"],
        ["user_factory_scopes", "factory_id", "用户授权"],
    ],
    warehouses: [["locations", "warehouse_id", "库位"]],
    partners: [
        ["warehouses", "custodian_supplier_id", "供应商仓"],
        ["material_factory_policies", "preferred_supplier_id", "首选供应商"],
    ],
    units: [
        ["materials", "base_unit_id", "基本单位"],
        ["material_units", "unit_id", "辅助单位"],
    ],
    "material-categories": [
        ["material_categories", "parent_id", "子分类"],
        ["materials", "category_id", "物料"],
    ],
    materials: [
        ["material_units", "material_id", "辅助单位"],
        ["material_factory_policies", "material_id", "工厂策略"],
    ],
};
export async function references(c: PoolClient, e: Entity, row: any, a: Actor) {
    const items = [];
    for (const [t, col, label] of refMap[e] || []) {
        let sql = `SELECT count(*) AS count FROM ${t} WHERE ${col}=?`;
        const vals: any[] = [row.id];
        if (a.role !== "ADMIN" &&
            ["warehouses", "material_factory_policies", "factory_calendars", "work_centers", "numbering_rules", "number_allocations"].includes(t)) {
            vals.push(...a.factory_ids);
            sql += ["numbering_rules","number_allocations"].includes(t) ? (a.factory_ids.length ? " AND (factory_id IS NULL OR factory_id IN ("+a.factory_ids.map(()=>"?").join(",")+"))" : " AND factory_id IS NULL") : (a.factory_ids.length ? " AND factory_id IN ("+a.factory_ids.map(()=>"?").join(",")+")" : " AND FALSE");
        }
        const count = (await c.query(sql, vals)).rows[0].count;
        if (count)
            items.push({ type: label, count });
    }
    return {
        items,
        businessOrdersConnected: false,
        message: e === "work-centers" ? "生产工艺及业务引用尚未接入" : "业务订单引用尚未接入",
    };
}
async function hasAnyRef(c: PoolClient, e: Entity, id: string, externalOnly = false) {
    for (const [t, col] of refMap[e] || []) {
        if (externalOnly &&
            ((e === "warehouses" && t === "locations") ||
                (e === "materials" &&
                    ["material_units", "material_factory_policies"].includes(t))))
            continue;
        if ((await c.query(`SELECT 1 FROM ${t} WHERE ${col}=? LIMIT 1`, [id]))
            .rowCount)
            return true;
    }
    return false;
}
const enumCheck = (v: any, values: string[], field: string, required = false) => {
    if (v == null) {
        if (required)
            fail("请填写" + field, field);
        return;
    }
    if (!values.includes(v))
        fail("选项不合法：" + field, field);
};
const setCheck = (v: any, values: string[], field: string, required = true) => {
    if (!Array.isArray(v) ||
        new Set(v).size !== v.length ||
        (required && !v.length) ||
        v.some((x) => !values.includes(x)))
        fail("集合不合法：" + field, field);
};
export async function save(c: PoolClient, e: Entity, input: any, a: Actor, old?: any, activate = false) {
    if (!input || typeof input !== "object")
        fail("请求内容不合法");
    const allowed = [
        "code",
        "name",
        "remark",
        "revision",
        "reason",
        ...entities[e].fields,
        ...(e === "materials" ? ["unitConversions", "factoryPolicies"] : []),
        ...(e === "partners" ? ["roles"] : []),
    ];
    for (const k of Object.keys(input))
        if (!allowed.includes(k))
            fail("不允许字段：" + k, k);
    if(e === "work-centers"){
        const factoryId = input.factory_id ?? old?.factory_id;
        if(!factoryId) fail("请选择所属工厂", "factory_id");
        const f=await get(c,"factories",factoryId,a);
        await get(c,"companies",f.company_id,undefined,true);
        const lockedFactory=await get(c,"factories",f.id,a,true);
        if(input.company_id && input.company_id!==f.company_id) fail("所属公司与工厂不一致", "company_id");
        if((await effective(c,"factories",lockedFactory)).length) fail("公司或工厂未启用，工作中心不可新建、编辑或启用");
        input={...input,company_id:f.company_id,factory_id:f.id};
    }
    const data: any = {};
    for (const f of ["code", "name", "remark", ...entities[e].fields]) {
        if (f in input)
            data[f] = input[f] === "" ? null : input[f];
    }
    data.code = String(data.code ?? old?.code ?? "")
        .trim()
        .toUpperCase();
    data.name = String(data.name ?? old?.name ?? "").trim();
    if (!/^[A-Z0-9_.-]{1,64}$/.test(data.code))
        fail("编码须为1～64位字母数字或 - _ .", "code");
    if (!data.name || data.name.length > 200)
        fail("名称须为1～200字", "name");
    if (data.remark?.length > 2000)
        fail("备注最多2000字", "remark");
    for (const f of ["address", "specification"])
        if (data[f]?.length > 2000)
            fail("文本最多2000字", f);
    for (const f of ["contact_name", "phone"])
        if (data[f]?.length > 200)
            fail("联系字段过长", f);
    const row = {
        ...(e === "materials"
            ? { tracking_mode: "BATCH" }
            : e === "warehouses"
                ? { location_type: "INTERNAL" }
                : e === "locations"
                    ? { usage_hint: "GENERAL" }
                    : e === "units"
                        ? { decimal_places: 0 }
                        : e === "partners"
                            ? { supplier_capabilities: [] }
                            : {}),
        ...old,
        ...data,
        id: old?.id,
        uuid: old?.uuid || randomUUID(),
        status: activate ? "ACTIVE" : old?.status || "DRAFT",
    };
    const full = activate || row.status === "ACTIVE";
    if (old) {
        if (old.company_id !== row.company_id)
            fail("归属公司不可变更", "company_id");
        for (const f of ["factory_id", "warehouse_id"])
            if (old[f] !== row[f])
                fail("父级归属不可变更", f);
        if (old.status !== "DRAFT" && old.code !== row.code)
            fail("启用后编码不可变更", "code");
        if (input.revision !== old.revision)
            throw new Failure(409, "REVISION_CONFLICT", "资料已被修改，请重新加载");
    }
    await scope(c, a, e, row);
    const link = async (target: Entity, id: any, field: string, prev?: any, force = false) => {
        if (!id)
            return null;
        const p = await get(c, target, id, a);
        if (row.company_id && p.company_id && row.company_id !== p.company_id)
            fail("关联资料须属于同一公司", field);
        if ((force || activate || id !== prev) &&
            (await effective(c, target, p)).length)
            fail("关联资料或上级未启用：" + p.code, field);
        return p;
    };
    if (e !== "companies" && e !== "units") {
        if (!row.company_id)
            fail("请选择公司", "company_id");
        await link("companies", row.company_id, "company_id", old?.company_id);
    }
    if (e === "factories") {
        row.timezone = row.timezone || "Asia/Shanghai";
        try { new Intl.DateTimeFormat("en", {timeZone:row.timezone}); } catch { fail("请输入有效IANA时区", "timezone"); }
        if(old && old.timezone!==row.timezone && (await c.query("SELECT 1 FROM factory_calendars WHERE factory_id=? LIMIT 1",[row.id])).rowCount) fail("已有日历后不能修改工厂时区", "timezone");
    }
    else if (e === "warehouses") {
        if (!row.factory_id)
            fail("请选择工厂", "factory_id");
        await link("factories", row.factory_id, "factory_id", old?.factory_id);
        enumCheck(row.location_type, ["INTERNAL", "SUPPLIER"], "location_type", true);
        if (row.location_type === "SUPPLIER") {
            if (!row.custodian_supplier_id)
                fail("供应商处仓必须选择保管供应商", "custodian_supplier_id");
            await supplier(c, row.custodian_supplier_id, row.company_id, a, "custodian_supplier_id", activate || row.custodian_supplier_id !== old?.custodian_supplier_id);
        }
        else if (row.custodian_supplier_id)
            fail("厂内仓不能有保管供应商", "custodian_supplier_id");
    }
    else if (e === "locations") {
        if (!row.warehouse_id)
            fail("请选择仓库", "warehouse_id");
        const w = await link("warehouses", row.warehouse_id, "warehouse_id", old?.warehouse_id);
        if (w.factory_id !== row.factory_id || w.company_id !== row.company_id)
            fail("库位归属与仓库不一致", "warehouse_id");
        enumCheck(row.usage_hint, ["GENERAL", "RAW", "WIP", "FINISHED", "QUARANTINE"], "usage_hint", true);
    }
    else if (e === "units") {
        enumCheck(row.dimension, ["COUNT", "MASS", "LENGTH", "VOLUME", "OTHER"], "dimension", true);
        if (!Number.isInteger(row.decimal_places) ||
            row.decimal_places < 0 ||
            row.decimal_places > 6)
            fail("小数位须为0～6整数", "decimal_places");
        if (old &&
            (row.decimal_places !== old.decimal_places ||
                row.dimension !== old.dimension) &&
            (await hasAnyRef(c, e, row.id)))
            fail("已引用单位不可修改精度或维度");
    }
    else if (e === "material-categories") {
        await c.lock("categories:" + row.company_id);
        if (row.parent_id) {
            await link("material-categories", row.parent_id, "parent_id", old?.parent_id);
            let id = row.parent_id;
            const visited = new Set<string>([row.id]);
            while (id) {
                if (visited.has(id))
                    fail("分类不能自引用或形成循环", "parent_id");
                visited.add(id);
                id = (await get(c, "material-categories", id, a)).parent_id;
            }
        }
    }
    else if (e === "partners") {
        const roles = input.roles ??
            (old
                ? await c
                    .query("SELECT role,status FROM partner_roles WHERE partner_id=?", [old.id])
                    .then((r) => r.rows)
                : []);
        if (!Array.isArray(roles) ||
            !roles.length ||
            new Set(roles.map((r: any) => r.role)).size !== roles.length)
            fail("请至少选择一个不重复角色", "roles");
        for (const r of roles) {
            enumCheck(r.role, ["CUSTOMER", "SUPPLIER"], "roles", true);
            enumCheck(r.status, ["ACTIVE", "INACTIVE"], "roles", true);
        }
        setCheck(row.supplier_capabilities ?? [], ["MATERIAL", "PROCESSING"], "supplier_capabilities", roles.some((r: any) => r.role === "SUPPLIER"));
        if (old &&
            !roles.some((r: any) => r.role === "SUPPLIER") &&
            (await hasAnyRef(c, e, row.id)))
            fail("已引用供应商角色不能删除，可停用", "roles");
        if (old) {
            const prev = (await c.query("SELECT role,status FROM partner_roles WHERE partner_id=?", [old.id])).rows;
            if (!["ADMIN", "RELEASER"].includes(a.role) &&
                prev.some((x) => x.status === "INACTIVE" &&
                    !roles.some((r: any) => r.role === x.role)))
                throw new Failure(403, "FORBIDDEN", "停用角色只能由启停用员删除");
            const changed = roles.some((r: any) => prev.some((x) => x.role === r.role && x.status !== r.status));
            if (changed) {
                if (!["ADMIN", "RELEASER"].includes(a.role))
                    throw new Failure(403, "FORBIDDEN", "角色状态仅启停用员可变更");
                if (!input.reason?.trim())
                    fail("角色状态变更须填写原因", "reason");
            }
        }
        else if (roles.some((r: any) => r.status !== "ACTIVE") &&
            a.role !== "ADMIN")
            throw new Failure(403, "FORBIDDEN", "新建角色默认为启用");
        row.roles = roles;
    }
    else if (e === "materials") {
        for (const [f, opts] of [
            ["material_kind", ["RAW", "SEMI", "FINISHED"]],
            ["tracking_mode", ["NONE", "BATCH", "SERIAL", "BATCH_SERIAL"]],
        ] as [
            string,
            string[]
        ][])
            enumCheck(row[f], opts, f, full || f === "tracking_mode");
        if (full && (!row.category_id || !row.base_unit_id))
            fail("启用物料须填写分类与基本单位");
        await link("material-categories", row.category_id, "category_id", old?.category_id);
        const u = await link("units", row.base_unit_id, "base_unit_id", old?.base_unit_id);
        if (["SERIAL", "BATCH_SERIAL"].includes(row.tracking_mode)) {
            if (!u || u.dimension !== "COUNT" || u.decimal_places !== 0)
                fail("序列管理须使用零小数件类单位", "base_unit_id");
            if (row.serial_uniqueness !== "MATERIAL")
                fail("请选择公司+物料内序列号唯一", "serial_uniqueness");
        }
        else if (row.serial_uniqueness)
            fail("非序列管理不填写唯一范围", "serial_uniqueness");
        if (old &&
            (row.base_unit_id !== old.base_unit_id ||
                row.tracking_mode !== old.tracking_mode) &&
            (await hasAnyRef(c, e, row.id)))
            fail("已有结构引用，禁止直接修改基本单位或追踪模式");
        row.unitConversions =
            input.unitConversions ??
                (old ? (await detail(c, e, old)).unitConversions : []);
        row.factoryPolicies =
            input.factoryPolicies ??
                (old ? (await detail(c, e, old)).factoryPolicies : []);
        if (a.role !== "ADMIN" && old) {
            const existing = (await detail(c, e, old)).factoryPolicies;
            if (existing.some((p: any) => !a.factory_ids.includes(p.factory_id)))
                throw new Failure(403, "FORBIDDEN", "含未授权工厂策略，不能覆盖物料聚合");
        }
        const unitIds = new Set();
        for (const [i, x] of row.unitConversions.entries()) {
            const f = `unitConversions.${i}.factor`;
            if (x.unit_id === row.base_unit_id || unitIds.has(x.unit_id))
                fail("辅助单位不能重复或等于基本单位", f);
            unitIds.add(x.unit_id);
            if (typeof x.factor !== "string" ||
                !/^\d+(\.\d{1,6})?$/.test(x.factor) ||
                new Decimal(x.factor).lte(0) ||
                new Decimal(x.factor).gte("100000000000000"))
                fail("换算系数须为正数、最多6位小数且整数最多14位", f);
            await link("units", x.unit_id, `unitConversions.${i}.unit_id`, old &&
                (await detail(c, e, old)).unitConversions.some((y: any) => y.unit_id === x.unit_id)
                ? x.unit_id
                : null);
        }
        if (old && !["ADMIN", "RELEASER"].includes(a.role)) {
            const previousPolicies = (await detail(c, e, old)).factoryPolicies;
            if (previousPolicies.some((p: any) => p.status === "INACTIVE" &&
                !row.factoryPolicies.some((x: any) => x.factory_id === p.factory_id)))
                throw new Failure(403, "FORBIDDEN", "停用策略只能由启停用员删除");
        }
        const factories = new Set();
        for (const [i, p] of row.factoryPolicies.entries()) {
            const field = `factoryPolicies.${i}`;
            if (factories.has(p.factory_id))
                fail("工厂策略不可重复", field);
            factories.add(p.factory_id);
            const previous = old
                ? (await detail(c, e, old)).factoryPolicies.find((x: any) => x.factory_id === p.factory_id)
                : null;
            await link("factories", p.factory_id, field, previous?.factory_id);
            if (previous && p.status !== previous.status) {
                if (!["ADMIN", "RELEASER"].includes(a.role))
                    throw new Failure(403, "FORBIDDEN", "策略状态仅启停用员可变更");
                if (!input.reason?.trim())
                    fail("策略状态变更须填写原因", "reason");
            }
            if (!previous && p.status === "INACTIVE" && a.role !== "ADMIN")
                throw new Failure(403, "FORBIDDEN", "新建策略默认为启用");
            setCheck(p.allowed_supply_modes, ["BUY", "MAKE", "SUBCONTRACT"], field);
            if (!p.allowed_supply_modes.includes(p.default_supply_mode))
                fail("默认供应方式必须属于允许集合", field);
            const prod = p.allowed_supply_modes.some((x: string) => x !== "BUY");
            setCheck(p.allowed_production_strategies ?? [], ["MTO", "MTS"], field, prod);
            if ((prod && !p.default_production_strategy) ||
                (p.default_production_strategy &&
                    !p.allowed_production_strategies.includes(p.default_production_strategy)))
                fail("默认生产策略必须属于允许集合", field);
            enumCheck(p.status, ["ACTIVE", "INACTIVE"], field, true);
            if (p.preferred_supplier_id) {
                const sup = await supplier(c, p.preferred_supplier_id, row.company_id, a, field, activate || p.preferred_supplier_id !== previous?.preferred_supplier_id || p.default_supply_mode !== previous?.default_supply_mode);
                const capability = p.default_supply_mode === "BUY"
                    ? "MATERIAL"
                    : p.default_supply_mode === "SUBCONTRACT"
                        ? "PROCESSING"
                        : null;
                if (capability && !sup.supplier_capabilities.includes(capability))
                    fail("首选供应商能力与默认供应方式不匹配", field);
            }
            if (!Array.isArray(p.inspectionPolicies) ||
                p.inspectionPolicies.length !== 3 ||
                new Set(p.inspectionPolicies.map((x: any) => x.inspection_type))
                    .size !== 3)
                fail("须填写IQC/FQC/OQC三项检验要求", field);
            for (const x of p.inspectionPolicies) {
                enumCheck(x.inspection_type, ["IQC", "FQC", "OQC"], field, true);
                enumCheck(x.requirement, ["REQUIRED", "EXEMPT"], field, true);
                if (x.requirement === "EXEMPT" && !x.exemption_reason?.trim())
                    fail("免检须填写原因", field);
                if (x.requirement === "REQUIRED" && x.exemption_reason)
                    fail("必检不填写豁免原因", field);
            }
        }
    }
    const fields = ["code", "name", "remark", ...entities[e].fields].filter((f) => f in row);
    if (!old) {
        row.id = await insertIdentity(c,resourceTables[e],{uuid:row.uuid,...Object.fromEntries(fields.map(f=>[f,row[f]])),status:row.status,created_by:a.id,updated_by:a.id});
    }
    else {
        const result = await c.query(`UPDATE ${table(e)} SET ${fields.map((f) => f + "=?").join(",")},status=?,revision=revision+1,updated_at=UTC_TIMESTAMP(6),updated_by=? WHERE id=? AND revision=?`, [...fields.map((f) => row[f]), row.status, a.id, row.id, old.revision]);
        if (!result.rowCount)
            throw new Failure(409, "REVISION_CONFLICT", "资料已被修改，请重新加载");
    }
    if (e === "partners") {
        await c.query("DELETE FROM partner_roles WHERE partner_id=?", [row.id]);
        for (const r of row.roles)
            await c.query("INSERT INTO partner_roles VALUES(?,?,?)", [row.id,
                r.role,
                r.status]);
    }
    if(e==='materials'){
        const existing=(await c.query('SELECT * FROM material_factory_policies WHERE material_id=? FOR UPDATE',[row.id])).rows;
        for(const previous of existing){if(!row.factoryPolicies.some((p:any)=>p.factory_id===previous.factory_id)){await c.query('DELETE FROM material_inspection_policies WHERE policy_id=?',[previous.id]);await c.query('DELETE FROM material_factory_policies WHERE id=?',[previous.id]);}}
        await c.query('DELETE FROM material_units WHERE material_id=?',[row.id]);
        for(const x of row.unitConversions)await c.query('INSERT INTO material_units VALUES(?,?,?)',[row.id,x.unit_id,x.factor]);
        const policyKeys=['allowed_supply_modes','default_supply_mode','allowed_production_strategies','default_production_strategy','preferred_supplier_id','status'];
        for(const p of row.factoryPolicies){const previous=existing.find((x:any)=>x.factory_id===p.factory_id);if(p.id&&p.id!==previous?.id)throw new Failure(404,'NOT_FOUND','资料不存在或不可见');const values={allowed_supply_modes:p.allowed_supply_modes,default_supply_mode:p.default_supply_mode,allowed_production_strategies:p.allowed_production_strategies||[],default_production_strategy:p.default_production_strategy||null,preferred_supplier_id:p.preferred_supplier_id||null,status:p.status};let pid:string;
            if(previous){pid=previous.id;await c.query('UPDATE material_factory_policies SET '+policyKeys.map(k=>k+'=?').join(',')+' WHERE id=?',[...policyKeys.map(k=>(values as any)[k]),pid]);await c.query('DELETE FROM material_inspection_policies WHERE policy_id=?',[pid]);}
            else pid=await insertIdentity(c,'material_factory_policies',{uuid:randomUUID(),company_id:row.company_id,material_id:row.id,factory_id:p.factory_id,...values});
            for(const x of p.inspectionPolicies)await c.query('INSERT INTO material_inspection_policies VALUES(?,?,?,?)',[pid,x.inspection_type,x.requirement,x.exemption_reason||null]);
        }
    }
    if (e === "warehouses" && !old) {
        const loc = {
            id: '',uuid:randomUUID(),
            company_id: row.company_id,
            factory_id: row.factory_id,
            warehouse_id: row.id,
            code: "DEFAULT",
            name: "默认库位",
            status: "DRAFT",
        };
        loc.id=await insertIdentity(c,'locations',{uuid:loc.uuid,company_id:row.company_id,factory_id:row.factory_id,warehouse_id:row.id,code:loc.code,name:loc.name,created_by:a.id,updated_by:a.id});
        await audit(c, a, "locations", loc.id, "CREATE", null, loc, "随仓库建立默认库位");
    }
    return await detail(c, e, await get(c, e, row.id), a);
}
async function supplier(c: PoolClient, id: string, company: string, a: Actor, field: string, requireActive = true) {
    const p = await get(c, "partners", id, a);
    if (p.company_id !== company)
        fail("供应商须属于同一公司", field);
    if (!requireActive)
        return p;
    if ((await effective(c, "partners", p)).length ||
        !(await c.query("SELECT 1 FROM partner_roles WHERE partner_id=? AND role='SUPPLIER' AND status='ACTIVE'", [id])).rowCount)
        fail("供应商及供应商角色必须启用", field);
    return p;
}
export async function changeState(c: PoolClient, e: Entity, old: any, input: any, a: Actor, active: boolean) {
    if (input.revision !== old.revision)
        throw new Failure(409, "REVISION_CONFLICT", "资料已被修改，请重新加载");
    if (!input.reason?.trim())
        fail("状态变更必须填写原因", "reason");
    const before = await detail(c, e, old, a);
    if (active) {
        if (e === "warehouses") {
            const locations = (await c.query("SELECT * FROM locations WHERE warehouse_id=? ORDER BY code FOR UPDATE", [old.id])).rows;
            if (!locations.length)
                fail("仓库至少需要一个库位");
            if (!locations.some((x) => x.status === "ACTIVE")) {
                const loc = locations.find((x) => x.code === "DEFAULT") || locations[0];
                await c.query("UPDATE locations SET status='ACTIVE',revision=revision+1,updated_at=now(),updated_by=? WHERE id=?", [a.id, loc.id]);
                await audit(c, a, "locations", loc.id, "ACTIVATE", loc, { ...loc, status: "ACTIVE" }, input.reason);
            }
        }
        await save(c, e, { revision: old.revision }, a, old, true);
    }
    else {
        if (old.status === "DRAFT")
            fail("草稿不能停用，请删除草稿");
        if (e === "locations") {
            await c.query("SELECT id FROM warehouses WHERE id=? FOR UPDATE", [old.warehouse_id]);
            const w = await get(c, "warehouses", old.warehouse_id);
            if (w.status === "ACTIVE" &&
                (await c.query("SELECT count(*) count FROM locations WHERE warehouse_id=? AND status='ACTIVE' AND id<>?", [old.warehouse_id, old.id])).rows[0].count === 0)
                fail("不能停用启用仓库的最后一个有效库位");
        }
        await c.query(`UPDATE ${table(e)} SET status='INACTIVE',revision=revision+1,updated_at=UTC_TIMESTAMP(6),updated_by=? WHERE id=? AND revision=?`, [a.id, old.id, old.revision]);
    }
    const after = await detail(c, e, await get(c, e, old.id), a);
    await audit(c, a, e, old.id, active ? "ACTIVATE" : "DEACTIVATE", before, after, input.reason);
    return after;
}
export async function remove(c: PoolClient, e: Entity, old: any, input: any, a: Actor) {
    if (input.revision !== old.revision)
        throw new Failure(409, "REVISION_CONFLICT", "修订冲突，请刷新");
    if (old.status !== "DRAFT")
        throw new Failure(409, "REFERENCE_CONFLICT", "仅可删除未引用草稿");
    if (await hasAnyRef(c, e, old.id, true))
        throw new Failure(409, "REFERENCE_CONFLICT", "资料已被引用，不能删除");
    const before = await detail(c, e, old, a);
    if (e === "warehouses") {
        const children = (await c.query("SELECT * FROM locations WHERE warehouse_id=? FOR UPDATE", [old.id])).rows;
        if (children.some((x) => x.status !== "DRAFT"))
            throw new Failure(409, "REFERENCE_CONFLICT", "自有库位已启用过，不能删除仓库");
        for (const child of children) {
            await c.query("DELETE FROM locations WHERE id=?", [child.id]);
            await audit(c, a, "locations", child.id, "DELETE", child, null, "随未引用草稿仓库删除");
        }
    }
    if (e === "materials") {
        await c.query("DELETE FROM material_inspection_policies WHERE policy_id IN(SELECT id FROM material_factory_policies WHERE material_id=?)", [old.id]);
        await c.query("DELETE FROM material_factory_policies WHERE material_id=?", [old.id]);
        await c.query("DELETE FROM material_units WHERE material_id=?", [old.id]);
    }
    if (e === "partners")
        await c.query("DELETE FROM partner_roles WHERE partner_id=?", [old.id]);
    await c.query(`DELETE FROM ${table(e)} WHERE id=?`, [old.id]);
    await audit(c, a, e, old.id, "DELETE", before, null, input.reason);
}
export async function convert(c: PoolClient, row: any, input: any) {
    if (typeof input.quantity !== "string" ||
        !/^\d+(\.\d{1,6})?$/.test(input.quantity) ||
        new Decimal(input.quantity).gte("100000000000000"))
        fail("数量须为非负十进制字符串，最多6位小数");
    const u = await get(c, "units", input.from_unit_id);
    if (new Decimal(input.quantity).decimalPlaces() > u.decimal_places)
        fail("数量不满足源单位精度", "quantity");
    let factor = "1";
    if (u.id !== row.base_unit_id) {
        const x = (await c.query("SELECT factor FROM material_units WHERE material_id=? AND unit_id=?", [row.id, u.id])).rows[0];
        if (!x)
            fail("当前物料未定义此单位换算");
        factor = x.factor;
    }
    return {
        quantity: new Decimal(input.quantity).mul(factor).toFixed(),
        base_unit_id: row.base_unit_id,
        base_unit_uuid:(await get(c,"units",row.base_unit_id)).uuid,
    };
}
