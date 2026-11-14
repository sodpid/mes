import {assertIdentitySchema} from '../apps/api/src/schema-profile.js';import {assertLocalDatabase} from './local-database.js';
import { pool, transaction } from "../apps/api/src/db.js";
import { save, changeState, detail, get, audit, type Actor, type Entity, } from "../apps/api/src/master.js";
assertLocalDatabase();await assertIdentitySchema(pool);
const u = (await pool.query("SELECT id,uuid,username,role FROM users WHERE role='ADMIN' AND active ORDER BY username LIMIT 1")).rows[0];
if (!u)
    throw new Error("先初始化管理员");
const a: Actor = { ...u, company_ids: [], factory_ids: [] };
await transaction(async (c) => {
    const ensure = async (e: Entity, code: string, body: any) => {
        const t = e === "material-categories" ? "material_categories" : e;
        const scope=e==='factories'?'company_id':e==='warehouses'?'factory_id':e==='locations'?'warehouse_id':body.company_id?'company_id':null;
        const rows=(await c.query(`SELECT * FROM ${t} WHERE code=?${scope?' AND '+scope+'=?':''}`,[code,...(scope?[body[scope]]:[])])).rows;
        if(rows.length>1)throw Error('样例编码范围冲突，拒绝覆盖');
        const existing=rows[0];
        if(existing&&((body.company_id&&existing.company_id!==body.company_id)||(body.factory_id&&existing.factory_id!==body.factory_id)||(body.warehouse_id&&existing.warehouse_id!==body.warehouse_id)))throw Error('样例归属冲突，拒绝覆盖');
        if (existing)
            return detail(c, e, existing);
        const r = await save(c, e, { code, ...body }, a);
        await audit(c, a, e, r.id, "CREATE", null, r, "显式样例初始化");
        return changeState(c, e, r, { revision: r.revision, reason: "显式样例初始化" }, a, true);
    };
    const co = await ensure("companies", "C01", { name: "示例制造公司" });
    const fa = await ensure("factories", "F01", {
        name: "示例工厂",
        company_id: co.id,
    });
    await ensure("partners", "CU01", {
        name: "示例客户",
        company_id: co.id,
        roles: [{ role: "CUSTOMER", status: "ACTIVE" }],
        supplier_capabilities: [],
    });
    const suppliers = [];
    for (const [code, name, caps] of [
        ["SU01", "原料供方", ["MATERIAL"]],
        ["SU02", "表面处理供方", ["PROCESSING"]],
        ["SU03", "整料委外供方", ["MATERIAL", "PROCESSING"]],
    ] as [
        string,
        string,
        string[]
    ][]) {
        suppliers.push(await ensure("partners", code, {
            name,
            company_id: co.id,
            roles: [{ role: "SUPPLIER", status: "ACTIVE" }],
            supplier_capabilities: caps,
        }));
    }
    for (const [i, code] of ["WH01", "WH02", "WH03"].entries())
        await ensure("warehouses", code, {
            name: ["厂内仓", "表面处理供应商仓", "整料委外供应商仓"][i],
            company_id: co.id,
            factory_id: fa.id,
            location_type: i ? "SUPPLIER" : "INTERNAL",
            custodian_supplier_id: i ? suppliers[i].id : null,
        });
    const wh = (await c.query("SELECT * FROM warehouses WHERE factory_id=? AND code='WH01'", [fa.id])).rows[0];
    for (const [code, name, hint] of [
        ["RAW", "原料区", "RAW"],
        ["WIP", "在制区", "WIP"],
        ["FG", "成品区", "FINISHED"],
        ["QA", "隔离区", "QUARANTINE"],
    ])
        await ensure("locations", code, {
            name,
            company_id: co.id,
            factory_id: fa.id,
            warehouse_id: wh.id,
            usage_hint: hint,
        });
    const pcs = await ensure("units", "PCS", {
        name: "件",
        dimension: "COUNT",
        decimal_places: 0,
    });
    const box = await ensure("units", "BOX", {
        name: "箱",
        dimension: "COUNT",
        decimal_places: 0,
    });
    const cat = await ensure("material-categories", "MC01", {
        name: "通用物料",
        company_id: co.id,
    });
    for (const [code, name, kind, modes, defaultMode, strategies, defaultStrategy, required,] of [
        ["R01", "金属毛坯", "RAW", ["BUY"], "BUY", [], null, ["IQC"]],
        ["R02", "紧固件", "RAW", ["BUY"], "BUY", [], null, ["IQC"]],
        [
            "H01",
            "机加工半成品",
            "SEMI",
            ["MAKE", "SUBCONTRACT"],
            "MAKE",
            ["MTO", "MTS"],
            "MTS",
            ["IQC", "FQC"],
        ],
        [
            "H02",
            "装配组件",
            "SEMI",
            ["MAKE"],
            "MAKE",
            ["MTO", "MTS"],
            "MTS",
            ["FQC"],
        ],
        [
            "P01",
            "成品总成",
            "FINISHED",
            ["MAKE"],
            "MAKE",
            ["MTO", "MTS"],
            "MTO",
            ["FQC", "OQC"],
        ],
    ] as any[]) {
        await ensure("materials", code, {
            name,
            company_id: co.id,
            category_id: cat.id,
            material_kind: kind,
            base_unit_id: pcs.id,
            tracking_mode: "BATCH",
            unitConversions: code === "R02" ? [{ unit_id: box.id, factor: "100" }] : [],
            factoryPolicies: [
                {
                    factory_id: fa.id,
                    allowed_supply_modes: modes,
                    default_supply_mode: defaultMode,
                    allowed_production_strategies: strategies,
                    default_production_strategy: defaultStrategy,
                    status: "ACTIVE",
                    inspectionPolicies: ["IQC", "FQC", "OQC"].map((inspection_type) => ({
                        inspection_type,
                        requirement: required.includes(inspection_type)
                            ? "REQUIRED"
                            : "EXEMPT",
                        exemption_reason: required.includes(inspection_type)
                            ? null
                            : "无此采购/制造/销售场景",
                    })),
                },
            ],
        });
    }
    console.log("样例已导入；已有同编码资料保持原样，不创建演示账号。");
}).finally(() => pool.end());
