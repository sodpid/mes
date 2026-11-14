import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
type Props = {
  api: (path: string, method?: string, body?: any) => Promise<any>;
  user: any;
  companies: any[];
  factories: any[];
  initialFactory?: string;
};
type Pattern = { valid_from: string; valid_to: string; work_days: number[] };
const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const weekOptions = weekdays.map((label, i) => ({ label, value: i + 1 }));
const states: any = { DRAFT: "草稿", ACTIVE: "启用", INACTIVE: "停用" };
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const step = (date: string) =>
  new Date(new Date(date + "T00:00:00Z").getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
function result(date: string, data: any) {
  const x = data.exceptions.find((x: any) => x.date === date);
  const p = data.weekPatterns.find(
    (p: Pattern) => p.valid_from <= date && date < p.valid_to,
  );
  return {
    working: x
      ? x.day_type === "WORK"
      : p?.work_days.includes(new Date(date + "T00:00:00Z").getUTCDay() || 7),
    exception: !!x,
    note: x?.note || "",
  };
}
export default function CalendarPage({
  api,
  user,
  companies,
  factories,
  initialFactory,
}: Props) {
  const [company, setCompany] = useState<string>();
  const [factory, setFactory] = useState<string | undefined>(initialFactory);
  const [year, setYear] = useState(new Date().getFullYear());
  const [status, setStatus] = useState<string>();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<any>();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [selected, setSelected] = useState<string[]>([]);
  const [operation, setOperation] = useState("REST");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filterDays, setFilterDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [preview, setPreview] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFactory, setNewFactory] = useState<string>();
  const [newYear, setNewYear] = useState(year);
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [remark, setRemark] = useState("");
  const [formError, setFormError] = useState("");
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleDate, setRuleDate] = useState("");
  const [ruleDays, setRuleDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [ruleReason, setRuleReason] = useState("");
  const [action, setAction] = useState<{ row: any; kind: string }>();
  const [actionReason, setActionReason] = useState("");
  const [info, setInfo] = useState<{ title: string; data: any }>();
  const edit = ["ADMIN", "EDITOR"].includes(user.role);
  const release = ["ADMIN", "RELEASER"].includes(user.role);
  const parentActive = (id: string) => {
    const f = factories.find((f) => f.id === id);
    return (
      f?.status === "ACTIVE" &&
      companies.find((c) => c.id === f.company_id)?.status === "ACTIVE"
    );
  };
  const editable = !!detail && edit && parentActive(detail.factory_id);
  const locked = (date: string) =>
    !!detail?.history_locked_before && date < detail.history_locked_before;
  const fail = (e: any, local = false) => {
    const text =
      (e.status === 409
        ? "版本冲突：未保存输入已保留，请刷新详情、比对并再次预览。"
        : "") + e.message;
    (local ? setFormError : setError)(text);
  };
  async function load() {
    setBusy(true);
    try {
      const q = new URLSearchParams({
        year: String(year),
        page: String(page),
        pageSize: "20",
      });
      if (company) q.set("company_id", company);
      if (factory) q.set("factory_id", factory);
      if (status) q.set("status", status);
      const r = await api("factory-calendars?" + q);
      setRows(r.items);
      setTotal(r.total);
      setError("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string, reset = true) {
    try {
      const r = await api("factory-calendars/" + id);
      setDetail(r.data);
      if (reset) {
        setMonth(
          Number(r.data.today.slice(0, 4)) === r.data.year
            ? Number(r.data.today.slice(5, 7))
            : 1,
        );
        setSelected([]);
        setReason("");
        setNote("");
      }
      setError("");
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    void load();
  }, [company, factory, year, status, page]);
  useEffect(() => {
    setFactory(initialFactory);
    setPage(1);
  }, [initialFactory]);
  async function create() {
    if (!newFactory) {
      setFormError("请选择工厂");
      return;
    }
    setBusy(true);
    try {
      const r = await api("factory-calendars", "POST", {
        factory_id: newFactory,
        year: newYear,
        workDays,
        remark,
      });
      setCreating(false);
      await load();
      await open(r.data.id);
    } catch (e) {
      fail(e, true);
    } finally {
      setBusy(false);
    }
  }
  async function saveChanges() {
    if (!reason.trim()) {
      setFormError("请填写变更原因");
      return;
    }
    setBusy(true);
    try {
      const r = await api("factory-calendars/" + detail.id + "/rules", "PUT", {
        revision: detail.revision,
        reason,
        changes: selected.map((date) => ({
          date,
          operation,
          ...(operation === "RESET" ? {} : { note }),
        })),
      });
      setDetail(r.data);
      setSelected([]);
      setPreview(false);
      setFormError("");
      await load();
    } catch (e) {
      fail(e, true);
    } finally {
      setBusy(false);
    }
  }
  async function saveRule() {
    if (!ruleReason.trim() || !ruleDate) {
      setFormError("请填写生效日期和变更原因");
      return;
    }
    if (
      ruleDate < `${detail.year}-01-01` ||
      ruleDate > `${detail.year}-12-31` ||
      locked(ruleDate)
    ) {
      setFormError("生效日期须在本年度且不早于历史锁定日期");
      return;
    }
    const patterns: Pattern[] = detail.weekPatterns
      .filter((p: Pattern) => p.valid_from < ruleDate)
      .map((p: Pattern) => ({
        ...p,
        valid_to: p.valid_to > ruleDate ? ruleDate : p.valid_to,
      }));
    patterns.push({
      valid_from: ruleDate,
      valid_to: `${detail.year + 1}-01-01`,
      work_days: ruleDays,
    });
    setBusy(true);
    try {
      const r = await api("factory-calendars/" + detail.id + "/rules", "PUT", {
        revision: detail.revision,
        reason: ruleReason,
        weekPatterns: patterns,
      });
      setDetail(r.data);
      setRuleOpen(false);
      await load();
    } catch (e) {
      fail(e, true);
    } finally {
      setBusy(false);
    }
  }
  async function doAction() {
    if (!action) return;
    if (action.kind !== "delete" && !actionReason.trim()) {
      setFormError("请填写启停用原因");
      return;
    }
    setBusy(true);
    try {
      await api(
        "factory-calendars/" +
          action.row.id +
          (action.kind === "delete" ? "" : "/" + action.kind),
        action.kind === "delete" ? "DELETE" : "POST",
        {
          revision: action.row.revision,
          ...(action.kind === "delete" ? {} : { reason: actionReason }),
        },
      );
      if (detail?.id === action.row.id) {
        if (action.kind === "delete") setDetail(undefined);
        else await open(detail.id, false);
      }
      setAction(undefined);
      await load();
    } catch (e) {
      fail(e, true);
    } finally {
      setBusy(false);
    }
  }
  const startAction = (row: any, kind: string) => {
    setAction({ row, kind });
    setActionReason("");
    setFormError("");
  };
  const actions = (r: any) => (
    <Space wrap>
      <Button onClick={() => open(r.id)}>查看日历</Button>
      {release && (
        <Button
          disabled={
            r.status !== "ACTIVE" &&
            (!parentActive(r.factory_id) ||
              r.year < Number(r.today.slice(0, 4)))
          }
          onClick={() =>
            startAction(r, r.status === "ACTIVE" ? "deactivate" : "activate")
          }
        >
          {r.status === "ACTIVE" ? "停用" : "启用"}
        </Button>
      )}
      {edit && r.status === "DRAFT" && !r.activated_at && (
        <Button danger onClick={() => startAction(r, "delete")}>
          删除草稿
        </Button>
      )}
    </Space>
  );
  const addRange = () => {
    if (
      !from ||
      !to ||
      from > to ||
      from.slice(0, 4) !== String(detail.year) ||
      to.slice(0, 4) !== String(detail.year)
    ) {
      setError("日期范围必须在本日历年度内，起始不得晚于结束");
      return;
    }
    const dates: string[] = [];
    for (let d = from; d <= to; d = step(d)) {
      if (locked(d)) {
        setError("范围包含锁定历史，请调整起始日期");
        return;
      }
      if (filterDays.includes(new Date(d + "T00:00:00Z").getUTCDay() || 7))
        dates.push(d);
    }
    setSelected((s) => [...new Set([...s, ...dates])].sort());
    setError("");
  };
  const count = detail
    ? new Date(Date.UTC(detail.year, month, 0)).getUTCDate()
    : 0;
  const offset = detail
    ? (new Date(Date.UTC(detail.year, month - 1, 1)).getUTCDay() + 6) % 7
    : 0;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="班次及班组排班尚未接入"
        description="日历仅定义工厂工作日期；不自动导入法定节假日。日期按工厂时区计算。"
      />
      <Card title="工厂日历管理">
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            style={{ width: 180 }}
            placeholder="全部公司"
            allowClear
            value={company}
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => {
              setCompany(v);
              setFactory(undefined);
              setPage(1);
            }}
          />
          <Select
            style={{ width: 210 }}
            placeholder="全部工厂"
            allowClear
            value={factory}
            options={factories
              .filter((f) => !company || f.company_id === company)
              .map((f) => ({ value: f.id, label: f.name }))}
            onChange={(v) => {
              setFactory(v);
              setPage(1);
            }}
          />
          <InputNumber
            aria-label="日历年度"
            min={2000}
            max={2100}
            value={year}
            onChange={(v) => {
              if (v) {
                setYear(v);
                setPage(1);
              }
            }}
          />
          <Select
            style={{ width: 130 }}
            placeholder="全部状态"
            allowClear
            value={status}
            options={Object.keys(states).map((value) => ({
              value,
              label: states[value],
            }))}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          />
          <Button onClick={load}>刷新列表</Button>
          {edit && (
            <Button
              type="primary"
              onClick={() => {
                setNewFactory(factory);
                setNewYear(year);
                setWorkDays([1, 2, 3, 4, 5]);
                setRemark("");
                setFormError("");
                setCreating(true);
              }}
            >
              新建年度草稿
            </Button>
          )}
        </Space>
        {error && (
          <Alert
            type="error"
            message={error}
            closable
            onClose={() => setError("")}
            style={{ marginBottom: 12 }}
          />
        )}
        <Table
          rowKey="id"
          loading={busy}
          dataSource={rows}
          scroll={{ x: 850 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            onChange: setPage,
            showSizeChanger: false,
          }}
          locale={{
            emptyText: (
              <Empty description="当前筛选未配置日历，可选择已启用工厂新建年度草稿" />
            ),
          }}
          columns={[
            {
              title: "工厂 · 年份",
              render: (_, r) => `${r.factory_name} · ${r.year}`,
            },
            {
              title: "状态",
              render: (_, r) => (
                <Tag color={r.status === "ACTIVE" ? "green" : "default"}>
                  {states[r.status]}
                </Tag>
              ),
            },
            {
              title: "业务有效性",
              render: (_, r) =>
                r.effective_active ? (
                  <Tag color="green">可用</Tag>
                ) : (
                  <span>{r.effectiveness_reasons.join("；")}</span>
                ),
            },
            { title: "修订", dataIndex: "revision" },
            { title: "操作", render: (_, r) => actions(r) },
          ]}
        />
      </Card>
      {detail && (
        <Card
          title={`${detail.factory_name} · ${detail.year}年`}
          extra={<Button onClick={() => setDetail(undefined)}>收起详情</Button>}
        >
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              size="small"
              items={[
                {
                  key: "state",
                  label: "状态",
                  children: states[detail.status],
                },
                { key: "zone", label: "工厂时区", children: detail.timezone },
                { key: "today", label: "当地今天", children: detail.today },
                { key: "rev", label: "修订号", children: detail.revision },
                {
                  key: "lock",
                  label: "历史锁",
                  children: detail.history_locked_before
                    ? `${detail.history_locked_before} 之前只读`
                    : "首次配置，非历史排班记录",
                },
              ]}
            />
            {!detail.effective_active && (
              <Alert
                type="warning"
                message={
                  "配置预览，不可用于业务：" +
                  detail.effectiveness_reasons.join("；")
                }
              />
            )}
            <Space wrap>
              {actions(detail)}
              <Button onClick={() => open(detail.id, false)}>
                刷新详情（保留输入）
              </Button>
              <Button
                disabled={!editable}
                onClick={() => {
                  setRuleDate(
                    detail.history_locked_before &&
                      detail.today > `${detail.year}-01-01`
                      ? detail.today
                      : `${detail.year}-01-01`,
                  );
                  setRuleDays([1, 2, 3, 4, 5]);
                  setRuleReason("");
                  setFormError("");
                  setRuleOpen(true);
                }}
              >
                设置工作周
              </Button>
              <Button
                onClick={async () => {
                  try {
                    setInfo({
                      title: "引用情况",
                      data: (
                        await api(
                          "factory-calendars/" + detail.id + "/references",
                        )
                      ).data,
                    });
                  } catch (e) {
                    fail(e);
                  }
                }}
              >
                查看引用
              </Button>
              {user.role === "ADMIN" && (
                <Button
                  onClick={async () => {
                    try {
                      setInfo({
                        title: "审计记录",
                        data: (
                          await api("factory-calendars/" + detail.id + "/audit")
                        ).data,
                      });
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  查看审计
                </Button>
              )}
            </Space>
            {!editable && (
              <Alert
                type="info"
                message={
                  !edit
                    ? "当前角色只读，无法维护规则及日期。"
                    : "公司或工厂未启用，规则及日期只读。"
                }
              />
            )}
            <Space wrap>
              <Button
                disabled={month === 1}
                onClick={() => setMonth((m) => m - 1)}
              >
                上一月
              </Button>
              <Select
                aria-label="月份"
                value={month}
                options={Array.from({ length: 12 }, (_, i) => ({
                  value: i + 1,
                  label: `${detail.year}年${i + 1}月`,
                }))}
                onChange={setMonth}
              />
              <Button
                disabled={month === 12}
                onClick={() => setMonth((m) => m + 1)}
              >
                下一月
              </Button>
              <Button
                onClick={() => setMonth(Number(detail.today.slice(5, 7)))}
              >
                当地本月
              </Button>
              <Tag color="green">工作日</Tag>
              <Tag color="default">休息日</Tag>
              <Tag color="blue">例外（补班 / 调休）</Tag>
              <span>已选 {selected.length} 天（翻月保留）</span>
            </Space>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7,minmax(0,1fr))",
                gap: 5,
              }}
            >
              {weekdays.map((w) => (
                <div
                  key={w}
                  style={{ textAlign: "center", padding: 8, fontWeight: 600 }}
                >
                  {w}
                </div>
              ))}
              {Array.from({ length: offset }, (_, i) => (
                <div key={"blank" + i} />
              ))}
              {Array.from({ length: count }, (_, i) => {
                const date = iso(detail.year, month, i + 1);
                const r = result(date, detail);
                return (
                  <button
                    key={date}
                    type="button"
                    aria-label={`${date} ${r.working ? "工作" : "休息"}${r.exception ? "例外" : ""}`}
                    title={r.note || date}
                    onClick={() => {
                      if (editable && !locked(date))
                        setSelected((s) =>
                          s.includes(date)
                            ? s.filter((d) => d !== date)
                            : [...s, date].sort(),
                        );
                    }}
                    style={{
                      minHeight: 96,
                      textAlign: "left",
                      padding: 8,
                      border: selected.includes(date)
                        ? "2px solid #1677ff"
                        : "1px solid #ddd",
                      borderRadius: 6,
                      background: r.working ? "#f0fff3" : "#fafafa",
                      color: locked(date) ? "#777" : "#222",
                      cursor: editable && !locked(date) ? "pointer" : "default",
                    }}
                  >
                    <strong>
                      {i + 1}
                      {date === detail.today ? " · 今天" : ""}
                    </strong>
                    <div style={{ marginTop: 5 }}>
                      {r.working ? "工作" : "休息"}{" "}
                      {r.exception ? (
                        <span style={{ color: "#1677ff" }}>
                          {r.working ? "补班例外" : "调休例外"}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12 }}>周规则</span>
                      )}
                    </div>
                    {r.note && (
                      <div
                        style={{
                          fontSize: 12,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.note}
                      </div>
                    )}
                    {locked(date) && (
                      <div style={{ fontSize: 12 }}>历史只读</div>
                    )}
                  </button>
                );
              })}
            </div>
            <Card size="small" title="单日 / 批量日期维护">
              <Space direction="vertical" style={{ width: "100%" }}>
                <Space wrap>
                  <span>选择范围</span>
                  <Input
                    type="date"
                    aria-label="范围开始日期"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    style={{ width: 160 }}
                  />
                  <span>至</span>
                  <Input
                    type="date"
                    aria-label="范围结束日期"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    style={{ width: 160 }}
                  />
                  <Button disabled={!editable} onClick={addRange}>
                    加入选择
                  </Button>
                  <Button onClick={() => setSelected([])}>清空选择</Button>
                </Space>
                <Checkbox.Group
                  options={weekOptions}
                  value={filterDays}
                  onChange={(v) => setFilterDays(v as number[])}
                />
                <Space wrap>
                  <Select
                    aria-label="日期操作"
                    style={{ width: 170 }}
                    value={operation}
                    onChange={setOperation}
                    options={[
                      { value: "REST", label: "设为休息（例外）" },
                      { value: "WORK", label: "设为工作（例外）" },
                      { value: "RESET", label: "恢复默认周规则" },
                    ]}
                  />
                  <Input
                    aria-label="日期备注"
                    placeholder="日期备注（最多500字）"
                    maxLength={500}
                    disabled={operation === "RESET"}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    style={{ width: 280 }}
                  />
                  <Input
                    aria-label="日期变更原因"
                    placeholder="变更原因（必填）"
                    maxLength={2000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    style={{ width: 280 }}
                  />
                  <Button
                    type="primary"
                    disabled={!editable || !selected.length}
                    onClick={() => {
                      setFormError("");
                      setPreview(true);
                    }}
                  >
                    预览并保存 {selected.length} 天
                  </Button>
                </Space>
              </Space>
            </Card>
            <Card size="small" title="当前周规则（结束日不含）">
              {detail.weekPatterns.map((p: Pattern) => (
                <div key={p.valid_from} style={{ padding: 4 }}>
                  {p.valid_from} 至 {p.valid_to}：
                  {p.work_days.length
                    ? p.work_days.map((d) => weekdays[d - 1]).join("、")
                    : "全周休息"}
                </div>
              ))}
            </Card>
          </Space>
        </Card>
      )}
      <Modal
        title="新建年度日历草稿"
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={create}
        confirmLoading={busy}
        okText="创建草稿"
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          {formError && <Alert type="error" message={formError} />}
          <span>工厂（仅已启用公司及工厂可新建）</span>
          <Select
            aria-label="新建工厂"
            style={{ width: "100%" }}
            placeholder="请选择工厂"
            value={newFactory}
            onChange={setNewFactory}
            options={factories.map((f) => ({
              value: f.id,
              label: f.name,
              disabled: !parentActive(f.id),
            }))}
          />
          <span>年度</span>
          <InputNumber
            aria-label="新建年度"
            min={2000}
            max={2100}
            value={newYear}
            onChange={(v) => v && setNewYear(v)}
          />
          <span>每周工作日（请明确选择）</span>
          <Checkbox.Group
            options={weekOptions}
            value={workDays}
            onChange={(v) => setWorkDays(v as number[])}
          />
          {!workDays.length && (
            <Alert
              type="warning"
              message="已选择全周休息，请确认符合工厂安排"
            />
          )}
          <Input.TextArea
            placeholder="日历备注"
            maxLength={2000}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
          <Alert
            type="info"
            message="首次配置为全年基线，非历史排班记录；草稿不对业务生效。"
          />
        </Space>
      </Modal>
      <Modal
        title={`确认日期变更 · ${selected.length}天`}
        open={preview}
        onCancel={() => setPreview(false)}
        onOk={saveChanges}
        confirmLoading={busy}
        okText="保存变更"
        width={700}
      >
        {formError && <Alert type="error" message={formError} />}
        <p>
          原因：{reason || "尚未填写（返回后填写）"}；
          {operation === "RESET"
            ? "删除例外，继承各日期周规则"
            : `统一备注：${note || "无"}`}
        </p>
        <div style={{ maxHeight: 350, overflow: "auto" }}>
          {detail &&
            selected.map((date) => {
              const current = result(date, detail);
              const inherited = result(date, { ...detail, exceptions: [] });
              return (
                <div key={date}>
                  {date}：{current.working ? "工作" : "休息"}（
                  {current.exception ? "例外" : "周规则"}） →{" "}
                  {operation === "RESET"
                    ? `${inherited.working ? "工作" : "休息"}（继承周规则）`
                    : operation === "WORK"
                      ? "工作（例外）"
                      : "休息（例外）"}
                </div>
              );
            })}
        </div>
      </Modal>
      <Modal
        title="分段设置工作周"
        open={ruleOpen}
        onCancel={() => setRuleOpen(false)}
        onOk={saveRule}
        confirmLoading={busy}
        okText="保存规则"
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          {formError && <Alert type="error" message={formError} />}
          <Alert
            type="warning"
            message="生效日起至年末改用新工作周，生效日前规则保留；已有日期例外仍优先。"
          />
          <Button onClick={() => open(detail.id, false)}>
            刷新最新详情并保留规则输入
          </Button>
          <div>
            当前规则：
            {detail?.weekPatterns
              .map(
                (p: Pattern) =>
                  `${p.valid_from} 至 ${p.valid_to}：${p.work_days.map((d) => weekdays[d - 1]).join("、") || "全周休息"}`,
              )
              .join("；")}
          </div>
          <span>生效日期</span>
          <Input
            aria-label="周规则生效日期"
            type="date"
            value={ruleDate}
            onChange={(e) => setRuleDate(e.target.value)}
          />
          <Checkbox.Group
            options={weekOptions}
            value={ruleDays}
            onChange={(v) => setRuleDays(v as number[])}
          />
          {!ruleDays.length && <Alert type="warning" message="全周休息" />}
          <div>
            影响范围：{ruleDate || "请选择日期"} 至 {detail?.year}-12-31
          </div>
          <Input.TextArea
            placeholder="变更原因（必填）"
            maxLength={2000}
            value={ruleReason}
            onChange={(e) => setRuleReason(e.target.value)}
          />
        </Space>
      </Modal>
      <Modal
        title={
          action?.kind === "delete"
            ? "删除未启用草稿"
            : action?.kind === "activate"
              ? "启用日历"
              : "停用日历"
        }
        open={!!action}
        onCancel={() => setAction(undefined)}
        onOk={doAction}
        confirmLoading={busy}
        okText="确认"
      >
        {formError && <Alert type="error" message={formError} />}
        <p>
          {action?.row.factory_name} · {action?.row.year}年，当前修订{" "}
          {action?.row.revision}
        </p>
        {action?.kind === "delete" ? (
          <Alert
            type="warning"
            message="删除整个未启用草稿及其日期配置，此操作不会用于恢复单日默认。"
          />
        ) : (
          <Input.TextArea
            placeholder="启停用原因（必填）"
            value={actionReason}
            maxLength={2000}
            onChange={(e) => setActionReason(e.target.value)}
          />
        )}
      </Modal>
      <Modal
        title={info?.title}
        open={!!info}
        footer={<Button onClick={() => setInfo(undefined)}>关闭</Button>}
        onCancel={() => setInfo(undefined)}
        width={800}
      >
        {Array.isArray(info?.data) && info.data.some((row: any) => row.snapshot_version === 1) && <Alert type="info" message="包含历史UUID快照（版本1），其中旧ID不代表当前数字主键；仅作为历史文本展示。" />}
        <pre
          style={{ whiteSpace: "pre-wrap", maxHeight: 500, overflow: "auto" }}
        >
          {JSON.stringify(info?.data, null, 2)}
        </pre>
      </Modal>
    </Space>
  );
}
