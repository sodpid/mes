import { randomUUID } from "node:crypto";
import { z } from "zod";
import {numericId,compareTarget,bodyPairs,queryPairs,dto,insertIdentity} from "./identity.js";
import type { FastifyInstance } from "fastify";
import { transaction, type Connection } from "./db.js";
import {
  Failure,
  fail,
  get,
  scope,
  effective,
  audit,
  type Actor,
} from "./master.js";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const days = z
  .array(z.number().int().min(1).max(7))
  .max(7)
  .refine((x) => new Set(x).size === x.length);
const pattern = z
  .object({ valid_from: date, valid_to: date, work_days: days })
  .strict();
const revision = z.number().int().positive();
const reason = z.string().trim().min(1).max(2000);
const stateBody = z.object({ revision, reason }).strict();
export function validDate(s: string) {
  const d = new Date(s + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== s
  )
    fail("日期不合法：" + s);
  return s;
}
export function nextDate(s: string) {
  return new Date(new Date(s + "T00:00:00Z").getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
}
export function localToday(zone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function notFound(): never {
  throw new Failure(404, "NOT_FOUND", "日历不存在或不可见");
}
function permitted(a: Actor, release = false) {
  if (!(release ? ["ADMIN", "RELEASER"] : ["ADMIN", "EDITOR"]).includes(a.role))
    throw new Failure(403, "FORBIDDEN", "当前角色无此操作权限");
}
function checkRevision(row: any, r: number) {
  if (row.revision !== r)
    throw new Failure(
      409,
      "REVISION_CONFLICT",
      "日历已被修改，请刷新比对，未保存输入已保留",
    );
}
export function validatePatterns(ps: any[], year: number) {
  let start = year + "-01-01";
  const end = year + 1 + "-01-01";
  if (!ps.length) fail("周规则不能为空");
  for (const p of ps) {
    validDate(p.valid_from);
    validDate(p.valid_to);
    if (
      p.valid_from !== start ||
      p.valid_to <= p.valid_from ||
      p.valid_to > end
    )
      fail("周规则须按顺序无空缺、无重叠地覆盖全年");
    start = p.valid_to;
  }
  if (start !== end) fail("周规则须覆盖全年");
}
async function factory(c: Connection, id: string, a: Actor, lock = false) {
  const f = await get(c, "factories", id, a);
  if (lock) {
    await get(c, "companies", f.company_id, undefined, true);
    return get(c, "factories", id, a, true);
  }
  return f;
}
async function calendar(c: Connection, id: string, a: Actor, lock = false) {
  let row = (await c.query("SELECT * FROM factory_calendars WHERE id=?", [id]))
    .rows[0];
  if (!row) notFound();
  compareTarget(a,"factory_calendars",row);
  await scope(c, a, "warehouses", row);
  const f = await factory(c, row.factory_id, a, lock);
  if (lock) {
    row = (
      await c.query("SELECT * FROM factory_calendars WHERE id=? FOR UPDATE", [
        id,
      ])
    ).rows[0];
    if (!row) notFound();
    compareTarget(a,"factory_calendars",row);
  }
  return { row, f };
}
async function detail(c: Connection, row: any, f: any) {
  const weekPatterns = (
    await c.query(
      "SELECT id,uuid,valid_from,valid_to,work_days FROM calendar_week_patterns WHERE calendar_id=? ORDER BY valid_from",
      [row.id],
    )
  ).rows;
  const exceptions = (
    await c.query(
      "SELECT calendar_id,date,day_type,note FROM calendar_exceptions WHERE calendar_id=? ORDER BY date",
      [row.id],
    )
  ).rows;
  const reasons = await effective(c, "factories", f);
  if (row.status !== "ACTIVE") reasons.unshift("日历未启用");
  return {
    ...row,
    factory_name: f.name,
    timezone: f.timezone,
    today: localToday(f.timezone),
    history_locked_before: row.activated_at ? localToday(f.timezone) : null,
    weekPatterns,
    exceptions,
    effective_active: reasons.length === 0,
    effectiveness_reasons: reasons,
  };
}
async function parentsActive(c: Connection, f: any) {
  if ((await effective(c, "factories", f)).length)
    fail("工厂或公司未启用，禁止新建、修改和启用日历");
}
export function dayResult(d: string, ps: any[], xs: any[]) {
  const x = xs.find((x) => x.date === d);
  const p = ps.find((p) => p.valid_from <= d && d < p.valid_to);
  const weekday = new Date(d + "T00:00:00Z").getUTCDay() || 7;
  return {
    is_working: x
      ? x.day_type === "WORK"
      : p
        ? p.work_days.includes(weekday)
        : null,
    source: x ? "EXCEPTION" : p ? "WEEK" : null,
    note: x?.note || null,
  };
}
function historicPatterns(ps: any[], boundary: string) {
  return ps
    .filter((p) => p.valid_from < boundary)
    .map((p) => ({
      valid_from:p.valid_from,work_days:p.work_days,
      valid_to: p.valid_to < boundary ? p.valid_to : boundary,
    }));
}
async function bump(
  c: Connection,
  row: any,
  a: Actor,
  extra = "",
  values: any[] = [],
) {
  await c.query(
    `UPDATE factory_calendars SET revision=revision+1,updated_at=UTC_TIMESTAMP(6),updated_by=?${extra} WHERE id=? AND revision=?`,
    [a.id, ...values, row.id, row.revision],
  );
}
export function registerCalendars(app: FastifyInstance) {
  const base = "/api/v1/factory-calendars";
  app.get(base, async (req) =>
    transaction(async (c) => {
      await queryPairs(c,req);
      const q = z
        .object({
          company_id: numericId.optional(),
          factory_id: numericId.optional(),
          year: z.coerce.number().int().min(2000).max(2100).optional(),
          status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]).optional(),
          page: z.coerce.number().int().positive().default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(20),
        })
        .strict()
        .parse(req.query);
      const clauses: string[] = [];
      const vals: any[] = [];
      for (const key of ["company_id", "factory_id", "year", "status"] as const)
        if (q[key] !== undefined) {
          clauses.push("c." + key + "=?");
          vals.push(q[key]);
        }
      if (req.actor.role !== "ADMIN") {
        for (const [key, ids] of [
          ["company_id", req.actor.company_ids],
          ["factory_id", req.actor.factory_ids],
        ] as [string, string[]][]) {
          clauses.push(
            ids.length
              ? "c." + key + " IN (" + ids.map(() => "?").join(",") + ")"
              : "FALSE",
          );
          vals.push(...ids);
        }
      }
      const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
      const total = (
        await c.query(
          "SELECT COUNT(*) count FROM factory_calendars c" + where,
          vals,
        )
      ).rows[0].count;
      const rows = (
        await c.query(
          "SELECT c.* FROM factory_calendars c" +
            where +
            " ORDER BY year DESC,factory_id LIMIT ? OFFSET ?",
          [...vals, q.pageSize, (q.page - 1) * q.pageSize],
        )
      ).rows;
      const items = [];
      for (const row of rows)
        items.push(
          await detail(c, row, await factory(c, row.factory_id, req.actor)),
        );
      return { items:await dto(c,"factory_calendars",items), total, page: q.page, pageSize: q.pageSize };
    }),
  );
  app.post(base, async (req, reply) => {
    permitted(req.actor);
    const schema = z
      .object({
        factory_id: numericId,
        year: z.number().int().min(2000).max(2100),
        workDays: days,
        remark: z.string().max(2000).optional(),
      })
      .strict();
    const result = await transaction(async (c) => {
      const b=schema.parse(await bodyPairs(c,req,"factory_calendars"));
      const f = await factory(c, b.factory_id, req.actor, true);
      await parentsActive(c, f);
      const id=await insertIdentity(c,'factory_calendars',{uuid:randomUUID(),company_id:f.company_id,factory_id:f.id,year:b.year,remark:b.remark||null,created_by:req.actor.id,updated_by:req.actor.id});
      await insertIdentity(c,'calendar_week_patterns',{uuid:randomUUID(),calendar_id:id,valid_from:b.year+'-01-01',valid_to:(b.year+1)+'-01-01',work_days:b.workDays});
      const out = await detail(c, (await calendar(c, id, req.actor)).row, f);
      await audit(c, req.actor, "factory-calendars", id, "CREATE", null, out);
      return { data: await dto(c,"factory_calendars",out) };
    });
    return reply.code(201).send(result);
  });
  app.get(base + "/:id", async (req) =>
    transaction(async (c) => {
      const { row, f } = await calendar(
        c,
        numericId.parse((req.params as any).id),
        req.actor,
      );
      return { data: await dto(c,"factory_calendars",await detail(c, row, f)) };
    }),
  );
  app.put(base + "/:id/rules", async (req) => {
    permitted(req.actor);
    const schema = z
      .object({
        revision,
        reason,
        weekPatterns: z.array(pattern).max(366).optional(),
        changes: z
          .array(
            z
              .object({
                date,
                operation: z.enum(["WORK", "REST", "RESET"]),
                note: z.string().max(500).optional(),
              })
              .strict(),
          )
          .max(366)
          .optional(),
        remark: z.string().max(2000).optional(),
      })
      .strict();
    return transaction(async (c) => {
      const b=schema.parse(await bodyPairs(c,req,"factory_calendars"));
      const { row, f } = await calendar(
        c,
        numericId.parse((req.params as any).id),
        req.actor,
        true,
      );
      checkRevision(row, b.revision);
      await parentsActive(c, f);
      const before = await detail(c, row, f);
      const ps = b.weekPatterns ?? before.weekPatterns;
      validatePatterns(ps, row.year);
      if (
        row.activated_at &&
        JSON.stringify(historicPatterns(ps, before.today)) !==
          JSON.stringify(historicPatterns(before.weekPatterns, before.today))
      )
        fail("已启用日历的历史周规则及边界不可修改");
      const changes = b.changes || [];
      if (new Set(changes.map((x) => x.date)).size !== changes.length)
        fail("批量日期不能重复");
      for (const x of changes) {
        validDate(x.date);
        if (Number(x.date.slice(0, 4)) !== row.year)
          fail("日期不属于日历年度：" + x.date);
        if (row.activated_at && x.date < before.today)
          fail("历史日期不可修改：" + x.date);
      }
      if (b.weekPatterns) {
        await c.query(
          "DELETE FROM calendar_week_patterns WHERE calendar_id=?",
          [row.id],
        );
        for (const p of ps) await insertIdentity(c,'calendar_week_patterns',{uuid:randomUUID(),calendar_id:row.id,valid_from:p.valid_from,valid_to:p.valid_to,work_days:p.work_days});
      }
      for (const x of changes) {
        if (x.operation === "RESET")
          await c.query(
            "DELETE FROM calendar_exceptions WHERE calendar_id=? AND date=?",
            [row.id, x.date],
          );
        else
          await c.query(
            "INSERT INTO calendar_exceptions(calendar_id,date,day_type,note) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE day_type=VALUES(day_type),note=VALUES(note)",
            [row.id, x.date, x.operation, x.note || null],
          );
      }
      await bump(
        c,
        row,
        req.actor,
        b.remark !== undefined ? ",remark=?" : "",
        b.remark !== undefined ? [b.remark] : [],
      );
      const after = await detail(
        c,
        (await calendar(c, row.id, req.actor)).row,
        f,
      );
      await audit(
        c,
        req.actor,
        "factory-calendars",
        row.id,
        "UPDATE_RULES",
        before,
        after,
        b.reason,
      );
      return { data: await dto(c,"factory_calendars",after) };
    });
  });
  for (const activate of [true, false])
    app.post(
      base + "/:id/" + (activate ? "activate" : "deactivate"),
      async (req) => {
        permitted(req.actor, true);
        const b = stateBody.parse(req.body);
        return transaction(async (c) => {
          const { row, f } = await calendar(
            c,
            numericId.parse((req.params as any).id),
            req.actor,
            true,
          );
          checkRevision(row, b.revision);
          const before = await detail(c, row, f);
          if (!activate && row.status === "DRAFT")
            fail("草稿不能停用，请删除未启用草稿");
          if (activate) {
            await parentsActive(c, f);
            if (row.year < Number(before.today.slice(0, 4)))
              fail("已结束年度不能启用");
            validatePatterns(before.weekPatterns, row.year);
          }
          await bump(
            c,
            row,
            req.actor,
            ",status=?" +
              (activate
                ? ",activated_at=COALESCE(activated_at,UTC_TIMESTAMP(6))"
                : ""),
            [activate ? "ACTIVE" : "INACTIVE"],
          );
          const after = await detail(
            c,
            (await calendar(c, row.id, req.actor)).row,
            f,
          );
          await audit(
            c,
            req.actor,
            "factory-calendars",
            row.id,
            activate ? "ACTIVATE" : "DEACTIVATE",
            before,
            after,
            b.reason,
          );
          return { data: await dto(c,"factory_calendars",after) };
        });
      },
    );
  app.delete(base + "/:id", async (req) => {
    permitted(req.actor);
    const b = z.object({ revision }).strict().parse(req.body);
    return transaction(async (c) => {
      const { row, f } = await calendar(
        c,
        numericId.parse((req.params as any).id),
        req.actor,
        true,
      );
      checkRevision(row, b.revision);
      if (row.status !== "DRAFT" || row.activated_at)
        throw new Failure(409, "REFERENCED", "仅未曾启用的未引用草稿可删除");
      const before = await detail(c, row, f);
      await c.query("DELETE FROM calendar_exceptions WHERE calendar_id=?", [
        row.id,
      ]);
      await c.query("DELETE FROM calendar_week_patterns WHERE calendar_id=?", [
        row.id,
      ]);
      await c.query("DELETE FROM factory_calendars WHERE id=?", [row.id]);
      await audit(
        c,
        req.actor,
        "factory-calendars",
        row.id,
        "DELETE",
        before,
        null,
      );
      return { data: true };
    });
  });
  app.get(base + "/:id/references", async (req) =>
    transaction(async (c) => {
      await calendar(c, numericId.parse((req.params as any).id), req.actor);
      return {
        data: {
          items: [],
          businessOrdersConnected: false,
          message: "班次及班组排班尚未接入，未核查排班影响",
        },
      };
    }),
  );
  app.get(base + "/:id/audit", async (req) => {
    return transaction(async (c) => {
      const { row } = await calendar(
        c,
        numericId.parse((req.params as any).id),
        req.actor,
      );
      if(req.actor.role!=="ADMIN")throw new Failure(403,"FORBIDDEN","仅管理员可查看审计");
      return {
        data: await dto(c,"audit_logs",(
          await c.query(
            "SELECT a.*,u.username actor_name FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE entity_type=? AND entity_id=? ORDER BY occurred_at DESC",
            ["factory-calendars", row.id],
          )
        ).rows),
      };
    });
  });
  app.get("/api/v1/factories/:id/work-calendar", async (req) =>
    transaction(async (c) => {
      const q = z.object({ from: date, to: date }).strict().parse(req.query);
      validDate(q.from);
      validDate(q.to);
      if (q.from < "2000-01-01" || q.to > "2100-12-31")
        fail("查询年度须为2000～2100");
      if (
        q.to < q.from ||
        (new Date(q.to).getTime() - new Date(q.from).getTime()) / 86400000 >=
          366
      )
        fail("日期范围须为1～366天");
      const f = await factory(
        c,
        numericId.parse((req.params as any).id),
        req.actor,
      );
      const cs = (
        await c.query(
          "SELECT * FROM factory_calendars WHERE factory_id=? AND year BETWEEN ? AND ?",
          [f.id, Number(q.from.slice(0, 4)), Number(q.to.slice(0, 4))],
        )
      ).rows;
      const map = new Map<number, any>();
      for (const row of cs) map.set(row.year, await detail(c, row, f));
      const items = [];
      for (let d = q.from; d <= q.to; d = nextDate(d)) {
        const cal = map.get(Number(d.slice(0, 4)));
        items.push({
          date: d,
          availability: !cal
            ? "UNCONFIGURED"
            : cal.effective_active
              ? "AVAILABLE"
              : "UNAVAILABLE",
          reasons: cal?.effectiveness_reasons ?? ["未配置年度日历"],
          ...(cal?.effective_active
            ? dayResult(d, cal.weekPatterns, cal.exceptions)
            : { is_working: null, source: null, note: null }),
          calendar_id: cal?.id ?? null,
          calendar_uuid: cal?.uuid ?? null,
          revision: cal?.revision ?? null,
        });
      }
      return { data: { timezone: f.timezone, items } };
    }),
  );
}
