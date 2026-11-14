import Fastify from "fastify";
import {assertIdentitySchema} from "./schema-profile.js";
import {numericId,parseResourcePair,queryPairs,bodyPairs,userBodyPairs,userDTO,dto,validatePair,compareTarget,insertIdentity} from "./identity.js";
import {registerNumbering} from "./numbering.js";
import {registerCalendars} from "./calendars.js";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { isIP } from "node:net";
import { pool, transaction } from "./db.js";
import { hashPassword, verifyPassword, tokenHash } from "./security.js";
import { Failure, entities, type Entity, type Actor, table, scope, get, detail, effective, save, audit, references, changeState, remove, convert, fail, } from "./master.js";
declare module "fastify" {
    interface FastifyRequest {
        actor: Actor;
    }
}
function filterAudit(snapshot: any, actor: Actor) {
    if (!snapshot)
        return snapshot;
    return {
        ...snapshot,
        ...(Array.isArray(snapshot.factoryPolicies)
            ? {
                factoryPolicies: snapshot.factoryPolicies.filter((p: any) => actor.factory_ids.includes(p.factory_id)),
            }
            : {}),
    };
}
const idSchema = numericId;
export async function buildApp() {
    await assertIdentitySchema(pool);
    const proxies = (process.env.TRUST_PROXY || "").split(",").map(x => x.trim()).filter(Boolean);
    if (proxies.some(x => !isIP(x))) throw new Error("TRUST_PROXY仅允许明确的代理IP地址");
    const app = Fastify({
        trustProxy: proxies.length ? proxies : false,
        logger: process.env.NODE_ENV === "production" ? {
            level: "info",
            serializers: {
                req: (req: any) => ({method:req.method,path:req.url.split("?")[0],remoteAddress:req.ip}),
                res: (reply: any) => ({statusCode:reply.statusCode}),
            },
            redact: ["req.headers.cookie", "req.headers.authorization", "req.body", "password", "oldPassword", "newPassword", "confirmPassword", "token"],
        } : false,
        bodyLimit: 1048576,
    });
    app.addHook("onSend",async(req,reply,payload)=>{if(!req.url.startsWith("/api/")&&String(reply.getHeader("content-type")||"").includes("text/html"))reply.header("Cache-Control","no-cache, no-store, must-revalidate");return payload;});
    app.get("/healthz", async (_req, reply) => {
        try { await pool.query("SELECT 1"); return {ok:true}; }
        catch { return reply.code(503).send({ok:false}); }
    });
    await app.register(cookie);
    await app.register(rateLimit, { global: false });
    app.setErrorHandler((e: any, req, reply) => {
        let status = e.statusCode || 500, code = e.code || "INTERNAL", message = e.message, fieldErrors = e.fieldErrors;
        if (e instanceof z.ZodError) {
            status = 400;
            code = "BAD_REQUEST";
            message = "请求格式不正确";
        }
        if (e.code === "ER_DUP_ENTRY") {
            status = 409;
            code = "DUPLICATE_CODE";
            message = "编码或明细已存在（停用编码也不能复用）";
        }
        if (["ER_ROW_IS_REFERENCED_2","ER_NO_REFERENCED_ROW_2"].includes(e.code)) {
            status = 409;
            code = "REFERENCE_CONFLICT";
            message = "关联资料不存在或已被引用";
        }
        if (["ER_CHECK_CONSTRAINT_VIOLATED","ER_DATA_TOO_LONG","ER_TRUNCATED_WRONG_VALUE","ER_WRONG_VALUE_FOR_TYPE","ER_BAD_NULL_ERROR","ER_DATA_OUT_OF_RANGE","WARN_DATA_TRUNCATED","ER_INVALID_JSON_TEXT"].includes(e.code)) {
            status = 422;
            code = "VALIDATION";
            message = "字段值或关联不合法";
        }
        if (["MES_LOCK_TIMEOUT","ER_LOCK_DEADLOCK","ER_LOCK_WAIT_TIMEOUT"].includes(e.code)){status=409;code="RETRY_CONFLICT";message="资料正在被修改，请稍后重试";}
        if (status >= 500) {
            message = "服务处理失败，请稍后重试";
            app.log.error({event:"request_failed",code:/^[A-Z0-9_]+$/.test(e.code||"")?e.code:"INTERNAL"}, "请求处理失败");
        }
        reply
            .code(status)
            .send({ error: { code, message, fieldErrors, requestId: req.id } });
    });
    app.addHook("preHandler", async (req, reply) => {
        if (!req.url.startsWith("/api/"))
            return;
        if(req.headers["x-mes-api-version"]!=="2") throw new Failure(426,"API_VERSION","系统接口已升级，请整页刷新后重新登录");
        const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
        if (write) {
            const origin = req.headers.origin;
            const allowed = [
                process.env.WEB_ORIGIN || "http://127.0.0.1:5173",
                `http://127.0.0.1:${process.env.API_PORT || 3001}`,
            ];
            if (origin && !allowed.includes(origin))
                throw new Failure(403, "ORIGIN", "请求来源不允许");
            if (req.method !== "DELETE" &&
                !req.headers["content-type"]?.includes("application/json"))
                throw new Failure(400, "CONTENT_TYPE", "请使用JSON请求");
        }
        if (req.url.split("?")[0] === "/api/v1/auth/login")
            return;
        const token = req.cookies.mes_session;
        if (!token)
            throw new Failure(401, "UNAUTHENTICATED", "请先登录");
        const user = (await pool.query("SELECT u.id,u.uuid,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>now() AND u.active=true", [tokenHash(token)])).rows[0];
        if (!user)
            throw new Failure(401, "UNAUTHENTICATED", "登录已失效，请重新登录");
        const companies = (await pool.query("SELECT company_id FROM user_company_scopes WHERE user_id=?", [user.id])).rows;
        const factories = (await pool.query("SELECT factory_id FROM user_factory_scopes WHERE user_id=?", [user.id])).rows;
        req.actor = {
            ...user,
            resourcePair:parseResourcePair(req),
            company_ids: companies.map((x) => x.company_id),
            factory_ids: factories.map((x) => x.factory_id),
        };
    });
    app.post("/api/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
        const b = z
            .object({
            username: z.string().min(1).max(100),
            password: z.string().min(1).max(500),
        })
            .strict()
            .parse(req.body);
        const token = randomBytes(32).toString("hex");
        const u = await transaction(async (c) => {
            const user = (await c.query("SELECT * FROM users WHERE username=? FOR UPDATE", [b.username])).rows[0];
            const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
            if (!verifyPassword(b.password, user?.password_hash || dummy) || !user?.active)
                throw new Failure(401, "LOGIN_FAILED", "用户名或密码不正确");
            await c.query("INSERT INTO sessions VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 8 HOUR))", [tokenHash(token), user.id]);
            return user;
        });
        reply.setCookie("mes_session", token, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: 28800,
        });
        return { data: await transaction(c=>userDTO(c,u)) };
    });
    app.post("/api/v1/auth/change-password", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
        const b = z.object({oldPassword:z.string().min(1).max(500),newPassword:z.string().min(12).max(200)}).strict().parse(req.body);
        if (b.oldPassword === b.newPassword) throw new Failure(400,"SAME_PASSWORD","新密码不能与当前密码相同");
        await transaction(async (c) => {
            const user = (await c.query("SELECT id,password_hash,active FROM users WHERE id=? FOR UPDATE",[req.actor.id])).rows[0];
            if (!user?.active) throw new Failure(401,"UNAUTHENTICATED","登录已失效，请重新登录");
            const session = (await c.query("SELECT user_id FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>UTC_TIMESTAMP(6) FOR UPDATE",[tokenHash(req.cookies.mes_session || ""),user.id])).rows[0];
            if (!session) throw new Failure(401,"UNAUTHENTICATED","登录已失效，请重新登录");
            if (!verifyPassword(b.oldPassword,user.password_hash)) throw new Failure(400,"OLD_PASSWORD","当前密码不正确");
            await c.query("UPDATE users SET password_hash=? WHERE id=?",[hashPassword(b.newPassword),user.id]);
            await c.query("DELETE FROM sessions WHERE user_id=?",[user.id]);
            await audit(c,req.actor,"users",user.id,"CHANGE_PASSWORD",null,{id:user.id});
        });
        reply.clearCookie("mes_session",{path:"/"});
        return {data:true};
    });
    app.get("/api/v1/health",async()=>({data:{engine:"MySQL",...(await pool.query("SELECT VERSION() AS version,DATABASE() AS database_name")).rows[0]}}));
    app.get("/api/v1/auth/me", async (req) => transaction(async c=>({ data: await userDTO(c,req.actor) })));
    app.post("/api/v1/auth/logout", async (req, reply) => {
        await pool.query("DELETE FROM sessions WHERE token_hash=?", [tokenHash(req.cookies.mes_session || "")]);
        reply.clearCookie("mes_session", { path: "/" });
        return { data: true };
    });
    const admin = (req: any) => {
        if (req.actor.role !== "ADMIN")
            throw new Failure(403, "FORBIDDEN", "仅管理员可操作");
    };
    app.get("/api/v1/users", async (req) => {
        admin(req);
        return transaction(async (c) => {
            const rows = (await c.query("SELECT id,uuid,username,role,active FROM users ORDER BY username")).rows;
            const data=[];for(const u of rows)data.push(await userDTO(c,u));
            return {data};
        });
    });
    const userSchema = z
        .object({
        username: z.string().trim().min(1).max(100),
        password: z.string().min(12).max(200).optional(),
        role: z.enum(["ADMIN", "EDITOR", "VIEWER", "RELEASER"]),
        active: z.boolean(),
        company_ids: z.array(numericId),
        factory_ids: z.array(numericId),
    })
        .strict();
    async function writeUser(req: any, update: boolean) {
        admin(req);
        return transaction(async (c) => {
            const b=userSchema.parse(await userBodyPairs(c,req));
            let id:string=update?idSchema.parse(req.params.id):"";
            if(!update&&!b.password) fail("新增账号须填写至少12位密码", "password");
            await c.lock("administrators");
            const before = update
                ? (await c.query("SELECT id,uuid,username,role,active FROM users WHERE id=? FOR UPDATE", [id])).rows[0]
                : null;
            if (update && !before)
                throw new Failure(404, "NOT_FOUND", "账号不存在");
            if(update){compareTarget(req.actor,"users",before);Object.assign(before,await userDTO(c,before));}
            if (update &&
                before.role === "ADMIN" &&
                before.active &&
                (b.role !== "ADMIN" || !b.active) &&
                (await c.query("SELECT count(*) count FROM users WHERE active AND role='ADMIN'")).rows[0].count <= 1)
                fail("不能停用或降级最后一个管理员");
            for (const f of b.factory_ids) {
                const row = await get(c, "factories", f);
                if (!b.company_ids.includes(row.company_id))
                    fail("工厂授权须包含所属公司");
            }
            for (const co of b.company_ids)
                await get(c, "companies", co);
            if (update) {
                await c.query("UPDATE users SET username=?,role=?,active=? WHERE id=?", [b.username, b.role, b.active, id]);
                if (b.password)
                    fail("请使用独立重置密码操作");
                await c.query("DELETE FROM sessions WHERE user_id=?", [id]);
            }
            else id=await insertIdentity(c,"users",{uuid:randomUUID(),username:b.username,password_hash:hashPassword(b.password!),role:b.role,active:b.active});
            for (const [t, col, vals] of [
                ["user_company_scopes", "company_id", b.company_ids],
                ["user_factory_scopes", "factory_id", b.factory_ids],
            ] as [
                string,
                string,
                string[]
            ][]) {
                await c.query(`DELETE FROM ${t} WHERE user_id=?`, [id]);
                for (const x of vals)
                    await c.query(`INSERT INTO ${t}(user_id,${col}) VALUES(?,?)`, [
                        id,
                        x,
                    ]);
            }
            const after = await userDTO(c,{id,uuid:before?.uuid||(await c.query('SELECT uuid FROM users WHERE id=?',[id])).rows[0].uuid,username:b.username,role:b.role,active:b.active});
            await audit(c, req.actor, "users", id, update ? "UPDATE" : "CREATE", before, after);
            return { data: after };
        });
    }
    app.post("/api/v1/users", async (req, reply) => {
        const out = await writeUser(req, false);
        return reply.code(201).send(out);
    });
    app.put("/api/v1/users/:id", async (req) => writeUser(req, true));
    app.post("/api/v1/users/:id/reset-password", async (req) => {
        admin(req);
        const id = idSchema.parse((req.params as any).id);
        const b = z
            .object({ password: z.string().min(12).max(200) })
            .strict()
            .parse(req.body);
        return transaction(async (c) => {
            const target=(await c.query("SELECT id,uuid FROM users WHERE id=? FOR UPDATE",[id])).rows[0];if(!target)throw new Failure(404,"NOT_FOUND","资料不存在或不可见");compareTarget(req.actor,"users",target);
            const result = await c.query("UPDATE users SET password_hash=? WHERE id=?", [hashPassword(b.password), id]);
            if (!result.rowCount)
                throw new Failure(404, "NOT_FOUND", "账号不存在");
            await c.query("DELETE FROM sessions WHERE user_id=?", [id]);
            await audit(c, req.actor, "users", id, "RESET_PASSWORD", null, { id });
            return { data: true };
        });
    });
    for (const e of Object.keys(entities) as Entity[]) {
        const base = "/api/v1/" + e;
        const writable = (req: any, release = false) => {
            const a = req.actor;
            if (release
                ? !["ADMIN", "RELEASER"].includes(a.role)
                : !["ADMIN", "EDITOR"].includes(a.role))
                throw new Failure(403, "FORBIDDEN", "当前角色无此操作权限");
            if ((e === "companies" || e === "units") && a.role !== "ADMIN")
                throw new Failure(403, "FORBIDDEN", "公司及全局单位仅管理员维护");
        };
        const rowOf = async (c: any, req: any, lock = false) => {
            const id = idSchema.parse(req.params.id);
            if (lock && e === "factories") {
                const f = await get(c,e,id,req.actor);
                await get(c,"companies",f.company_id,undefined,true);
            }
            if (lock && e === "locations") {
                const child = await get(c, e, id, req.actor);
                await c.query("SELECT id FROM warehouses WHERE id=? FOR UPDATE", [child.warehouse_id]);
            }
            return get(c, e, id, req.actor, lock);
        };
        app.get(base, async (req) => transaction(async (c) => {
            await queryPairs(c,req);
            const q = z
                .object({
                page: z.coerce.number().int().min(1).default(1),
                pageSize: z.coerce.number().int().min(1).max(100).default(20),
                search: z.string().optional(),
                status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]).optional(),
                company_id: numericId.optional(),
                factory_id: numericId.optional(),
                role: z.enum(["CUSTOMER", "SUPPLIER"]).optional(),
                activeOnly: z.enum(["true", "false"]).optional(),
                material_kind: z.enum(["RAW", "SEMI", "FINISHED"]).optional(),
                supply_mode: z.enum(["BUY", "MAKE", "SUBCONTRACT"]).optional(),
                sort: z.enum(["code", "name", "updated_at"]).default("code"),
            })
                .strict()
                .parse(req.query);
            const clauses: string[] = [];
            const vals: any[] = [];
            const add = (sql:string,v:any)=>{vals.push(v);clauses.push(sql);};
            const addIn=(column:string,ids:string[])=>{clauses.push(ids.length?column+' IN ('+ids.map(()=>'?').join(',')+')':'FALSE');vals.push(...ids);};
            const a=req.actor;
            if(a.role!=='ADMIN'&&e!=='units'){addIn(e==='companies'?'id':'company_id',a.company_ids);if(['factories','warehouses','locations','work-centers'].includes(e))addIn(e==='factories'?'id':'factory_id',a.factory_ids);}
            if(q.search){clauses.push('(code COLLATE utf8mb4_0900_ai_ci LIKE CONCAT("%",?,"%") OR name LIKE CONCAT("%",?,"%"))');vals.push(q.search,q.search);}
            if (q.status)
                add("status=?", q.status);
            if (q.company_id && e !== "companies" && e !== "units")
                add("company_id=?", q.company_id);
            if (q.factory_id && ["warehouses", "locations", "work-centers"].includes(e))
                add("factory_id=?", q.factory_id);
            if (q.role && e === "partners")
                add("id IN(SELECT partner_id FROM partner_roles WHERE role=?)", q.role);
            if (q.material_kind && e === "materials")
                add("material_kind=?", q.material_kind);
            if (q.supply_mode && e === "materials")
                add("id IN(SELECT material_id FROM material_factory_policies WHERE JSON_CONTAINS(allowed_supply_modes,JSON_QUOTE(?)))", q.supply_mode);
            const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
            let rows = (await c.query(`SELECT * FROM ${table(e)}${where} ORDER BY ${q.sort}`, vals)).rows;
            const enriched = [];
            for (const row of rows) {
                const d = await detail(c, e, row, a);
                if (q.activeOnly !== "true" || d.effective_active)
                    enriched.push(d);
            }
            return {
                items: await dto(c,table(e),enriched.slice((q.page - 1) * q.pageSize, q.page * q.pageSize)),
                total: enriched.length,
                page: q.page,
                pageSize: q.pageSize,
            };
        }));
        app.get(base + "/:id", async (req) => transaction(async (c) => ({
            data: await dto(c,table(e),await detail(c, e, await rowOf(c, req), req.actor)),
        })));
        app.get(base + "/:id/references", async (req) => transaction(async (c) => ({
            data: await references(c, e, await rowOf(c, req), req.actor),
        })));
        app.get(base + "/:id/audit", async (req) => transaction(async (c) => {
            await rowOf(c, req);
            let rows = (await c.query("SELECT a.*,u.username actor_name FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE entity_type=? AND entity_id=? ORDER BY occurred_at DESC LIMIT 100", [e, (req.params as any).id])).rows;
            if (req.actor.role !== "ADMIN")
                rows = rows.filter((r) => !(r.company_uuid&&!r.company_id) && !(r.factory_uuid&&!r.factory_id) && (!r.company_id || req.actor.company_ids.includes(r.company_id)) &&
                    (!r.factory_id || req.actor.factory_ids.includes(r.factory_id)));
            if (req.actor.role !== "ADMIN" && e === "materials")
                rows = rows.map((r) => ({
                    ...r,
                    before_json: filterAudit(r.before_json, req.actor),
                    after_json: filterAudit(r.after_json, req.actor),
                }));
            return { data: await dto(c,"audit_logs",rows) };
        }));
        app.post(base, async (req, reply) => {
            writable(req);
            const out = await transaction(async (c) => {
                const data = await save(c, e, await bodyPairs(c,req,table(e)), req.actor);
                await audit(c, req.actor, e, data.id, "CREATE", null, data);
                return { data:await dto(c,table(e),data) };
            });
            return reply.code(201).send(out);
        });
        app.put(base + "/:id", async (req) => {
            writable(req);
            return transaction(async (c) => {
                const old = await rowOf(c, req, true), before = await detail(c, e, old, req.actor);
                const data = await save(c, e, await bodyPairs(c,req,table(e)), req.actor, old);
                await audit(c, req.actor, e, data.id, "UPDATE", before, data, (req.body as any).reason);
                return { data:await dto(c,table(e),data) };
            });
        });
        for (const action of ["activate", "deactivate"])
            app.post(base + "/:id/" + action, async (req) => {
                writable(req, true);
                z.object({revision:z.number().int().positive(),reason:z.string().trim().min(1).max(2000)}).strict().parse(req.body);
                return transaction(async (c) => ({
                    data: await dto(c,table(e),await changeState(c, e, await rowOf(c, req, true), req.body, req.actor, action === "activate")),
                }));
            });
        if (e === "partners" || e === "materials")
            app.post(base + "/:id/child-status", async (req) => {
                writable(req, true);
                const schema = z
                    .object({
                    revision: z.number().int().positive(),
                    reason: z.string().trim().min(1).max(2000),
                    role: z.enum(["CUSTOMER", "SUPPLIER"]).optional(),
                    factory_id: numericId.optional(),
                    status: z.enum(["ACTIVE", "INACTIVE"]),
                })
                    .strict();
                return transaction(async (c) => {
                    const b=schema.parse(await bodyPairs(c,req,e==="materials"?"material_factory_policies":"partners"));
                    const old = await rowOf(c, req, true);
                    if (b.revision !== old.revision)
                        throw new Failure(409, "REVISION_CONFLICT", "资料已被修改，请重新加载");
                    const before = await detail(c, e, old, req.actor);
                    if (e === "partners") {
                        if (!b.role)
                            fail("请选择业务角色");
                        const child = (await c.query("SELECT * FROM partner_roles WHERE partner_id=? AND role=?", [old.id, b.role])).rows[0];
                        if (!child)
                            fail("角色不存在");
                        if (b.status === "ACTIVE" &&
                            b.role === "SUPPLIER" &&
                            !old.supplier_capabilities.length)
                            fail("启用供应商角色须有供应能力");
                        await c.query("UPDATE partner_roles SET status=? WHERE partner_id=? AND role=?", [b.status, old.id, b.role]);
                    }
                    else {
                        if (!b.factory_id)
                            fail("请选择工厂策略");
                        if (req.actor.role !== "ADMIN" &&
                            !req.actor.factory_ids.includes(b.factory_id!))
                            throw new Failure(404, "NOT_FOUND", "工厂策略不存在或不可见");
                        const child = (await c.query("SELECT * FROM material_factory_policies WHERE material_id=? AND factory_id=? FOR UPDATE", [old.id, b.factory_id])).rows[0];
                        if (!child)
                            fail("工厂策略不存在");
                        if (b.status === "ACTIVE") {
                            const f = await get(c, "factories", b.factory_id!, req.actor);
                            if ((await effective(c, "factories", f)).length)
                                fail("工厂或上级未启用");
                            if (child.preferred_supplier_id) {
                                const sup = await get(c, "partners", child.preferred_supplier_id, req.actor);
                                const cap = child.default_supply_mode === "BUY"
                                    ? "MATERIAL"
                                    : child.default_supply_mode === "SUBCONTRACT"
                                        ? "PROCESSING"
                                        : null;
                                if ((await effective(c, "partners", sup)).length ||
                                    !(await c.query("SELECT 1 FROM partner_roles WHERE partner_id=? AND role='SUPPLIER' AND status='ACTIVE'", [sup.id])).rowCount ||
                                    (cap && !sup.supplier_capabilities.includes(cap)))
                                    fail("首选供应商或角色、能力不符合要求");
                            }
                        }
                        await c.query("UPDATE material_factory_policies SET status=? WHERE material_id=? AND factory_id=?", [b.status, old.id, b.factory_id]);
                    }
                    await c.query(`UPDATE ${table(e)} SET revision=revision+1,updated_at=UTC_TIMESTAMP(6),updated_by=? WHERE id=? AND revision=?`, [req.actor.id, old.id, old.revision]);
                    const after = await detail(c, e, await get(c, e, old.id), req.actor);
                    await audit(c, req.actor, e, old.id, "CHILD_STATUS", before, after, b.reason);
                    return { data: await dto(c,table(e),after) };
                });
            });
        app.delete(base + "/:id", async (req) => {
            writable(req);
            z.object({revision:z.number().int().positive(),reason:z.string().max(2000).optional()}).strict().parse(req.body);
            return transaction(async (c) => {
                await remove(c, e, await rowOf(c, req, true), req.body, req.actor);
                return { data: true };
            });
        });
    }
    app.post("/api/v1/materials/:id/convert", async (req) => transaction(async (c) => ({
        data: await convert(c, await get(c, "materials", idSchema.parse((req.params as any).id), req.actor), await bodyPairs(c,req,"conversion_input")),
    })));
    registerCalendars(app);
    registerNumbering(app);
    const web = resolve(import.meta.dirname, "../../web/dist");
    if (existsSync(web)) {
        await app.register(staticFiles, { root: web });
        app.setNotFoundHandler((req, reply) => req.url.startsWith("/api/")
            ? reply
                .code(404)
                .send({
                error: {
                    code: "NOT_FOUND",
                    message: "接口不存在",
                    requestId: req.id,
                },
            })
            : reply.sendFile("index.html"));
    }
    return app;
}
