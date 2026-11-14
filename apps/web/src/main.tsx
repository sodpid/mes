import "@ant-design/v5-patch-for-react-19";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ConfigProvider,
  Layout,
  Menu,
  Typography,
  Button,
  Space,
  Table,
  Tag,
  Input,
  Select,
  Modal,
  Form,
  Tabs,
  InputNumber,
  Alert,
  Drawer,
  Descriptions,
  Card,
  Spin,
  TreeSelect,
  message,
  Checkbox,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import "./style.css";
import CalendarPage from "./CalendarPage";
import { api, clearApiPairs } from "./apiClient";
import NumberingCenter from "./NumberingCenter";
const { Header, Sider, Content } = Layout;
const labels: Record<string, string> = {
  "numbering-rules": "编号规则",
  "number-allocations": "分配记录",
  "factory-calendars": "工厂日历管理",
  "work-centers": "工作中心",
  companies: "公司",
  factories: "工厂",
  warehouses: "仓库",
  locations: "库位",
  partners: "往来单位",
  units: "计量单位",
  "material-categories": "物料分类",
  materials: "物料",
  users: "用户权限",
};
const words: Record<string, string> = {
  DRAFT: "草稿",
  ACTIVE: "启用",
  INACTIVE: "停用",
  INTERNAL: "厂内",
  SUPPLIER: "供应商",
  CUSTOMER: "客户",
  MATERIAL: "供料",
  PROCESSING: "加工",
  COUNT: "件类",
  MASS: "质量",
  LENGTH: "长度",
  VOLUME: "体积",
  OTHER: "其他",
  RAW: "原料",
  SEMI: "半成品",
  FINISHED: "成品",
  NONE: "不追踪",
  BATCH: "批次",
  SERIAL: "序列号",
  BATCH_SERIAL: "批次+序列号",
  BUY: "采购",
  MAKE: "自制",
  SUBCONTRACT: "整料委外",
  MTO: "订单生产",
  MTS: "备货生产",
  REQUIRED: "必检",
  EXEMPT: "免检",
  IQC: "进货检",
  FQC: "完工检",
  OQC: "出库检",
  GENERAL: "通用",
  WIP: "在制",
  QUARANTINE: "隔离提示",
  ADMIN: "管理员",
  EDITOR: "维护员",
  RELEASER: "启停用员",
  VIEWER: "只读",
};
const opts = (a: string[]) =>
  a.map((value) => ({ value, label: words[value] || value }));
function App() {
  const [versionError, setVersionError] = useState("");
  const [user, setUser] = useState<any>(),
    [checking, setChecking] = useState(true),
    [resource, setResource] = useState("companies"),
    [roleFilter, setRoleFilter] = useState<string>(),
    [rows, setRows] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState<string>(),
    [company, setCompany] = useState<string>(),
    [factory, setFactory] = useState<string>(),
    [kind, setKind] = useState<string>(),
    [supply, setSupply] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<any>(),
    [open, setOpen] = useState(false),
    [view, setView] = useState<any>(),
    [refs, setRefs] = useState<any>(),
    [history, setHistory] = useState<any[]>([]),
    [dict, setDict] = useState<Record<string, any[]>>({}),
    [form] = Form.useForm(),
    [login] = Form.useForm(),
    [msg, context] = message.useMessage();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  const [passwordForm] = Form.useForm();
  function closePassword() {
    setPasswordOpen(false);
    passwordForm.resetFields();
    setPasswordError("");
  }
  async function changePassword(values: any) {
    setPasswordBusy(true);
    setPasswordError("");
    try {
      await api("auth/change-password", "POST", {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      closePassword();
      setLoginNotice("密码已修改，请使用新密码重新登录");
      setUser(undefined);
      login.resetFields();
    } catch (e: any) {
      setPasswordError(e.message);
    } finally {
      setPasswordBusy(false);
    }
  }
  const [modal, modalContext] = Modal.useModal();
  useEffect(() => {
    if (!checking && !user) {
      clearApiPairs();
      setDict({});
      setRows([]);
      setCompany(undefined);
      setFactory(undefined);
      setView(undefined);
      setOpen(false);
      setResource("companies");
    }
  }, [checking, user]);
  useEffect(() => {
    const version = (event: Event) => setVersionError((event as CustomEvent).detail);
    const invalid = (event: Event) => {
      clearApiPairs();
      setDict({});
      setRows([]);
      setView(undefined);
      setOpen(false);
      if ((event as CustomEvent).detail.status === 401) setUser(undefined);
      else setVersionError("访问权限已变化，请刷新页面重新载入授权资料。");
    };
    window.addEventListener("mes-version-mismatch", version);
    window.addEventListener("mes-access-invalid", invalid);
    return () => {window.removeEventListener("mes-version-mismatch", version);window.removeEventListener("mes-access-invalid", invalid);};
  }, []);
  const isAdmin = user?.role === "ADMIN",
    canEdit =
      ["ADMIN", "EDITOR"].includes(user?.role) &&
      (!["companies", "units", "users"].includes(resource) || isAdmin),
    canRelease =
      ["ADMIN", "RELEASER"].includes(user?.role) &&
      (!["companies", "units"].includes(resource) || isAdmin);
  useEffect(() => {
    api("auth/me")
      .then((x) => setUser(x.data))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  async function dictionaries() {
    const names = [
      "companies",
      "factories",
      "warehouses",
      "partners",
      "units",
      "material-categories",
    ];
    const out: Record<string, any[]> = {};
    await Promise.all(
      names.map(async (k) => {
        let p = 1;
        out[k] = [];
        for (;;) {
          const r = await api(k + "?pageSize=100&page=" + p);
          out[k].push(...r.items);
          if (out[k].length >= r.total) break;
          p++;
        }
      }),
    );
    setDict(out);
  }
  async function load() {
    setBusy(true);
    setError("");
    try {
      if (["factory-calendars", "numbering-rules", "number-allocations"].includes(resource)) return;
      if (resource === "users") {
        setRows((await api("users")).data);
        setTotal(0);
      } else {
        const q = new URLSearchParams({ page: String(page), search });
        if (status) q.set("status", status);
        if (company) q.set("company_id", company);
        if (factory) q.set("factory_id", factory);
        if (kind && resource === "materials") q.set("material_kind", kind);
        if (supply && resource === "materials") q.set("supply_mode", supply);
        if (roleFilter && resource === "partners") q.set("role", roleFilter);
        const r = await api(resource + "?" + q);
        setRows(r.items);
        setTotal(r.total);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (user) {
      load();
      dictionaries().catch((e: any) => setError(e.message));
    }
  }, [
    user,
    resource,
    page,
    search,
    status,
    company,
    factory,
    roleFilter,
    kind,
    supply,
  ]);
  function navigate(key: string) {
    if (key === "customers" || key === "suppliers") {
      setResource("partners");
      setRoleFilter(key === "customers" ? "CUSTOMER" : "SUPPLIER");
    } else {
      setResource(key);
      setRoleFilter(undefined);
    }
    setPage(1);
    setStatus(undefined);
    setSearch("");
  }
  const watchCompany = Form.useWatch("company_id", form),
    watchFactory = Form.useWatch("factory_id", form),
    watchWarehouse = Form.useWatch("warehouse_id", form),
    watchType = Form.useWatch("location_type", form),
    watchRoles = Form.useWatch("roles", form),
    watchTrack = Form.useWatch("tracking_mode", form),
    watchPolicies = Form.useWatch("factoryPolicies", form) || [];
  const selected = (key: string, value: any) =>
    dict[key]?.find((x) => x.id === value);
  const workCenterParentActive = (row: any) => {
    const f = selected("factories", row.factory_id);
    return !!f?.effective_active;
  };
  function openFactoryCenters(row: any) {
    setView(undefined);
    navigate("work-centers");
    setCompany(row.company_id);
    setFactory(row.id);
  }
  function options(key: string, filter?: (x: any) => boolean) {
    return (dict[key] || [])
      .filter((x) => !filter || filter(x))
      .map((x) => ({
        value: x.id,
        label: `${x.code} · ${x.name}${x.effective_active ? "" : "（未生效）"}`,
        disabled: !x.effective_active,
      }));
  }
  const field = (
    name: any,
    label: string,
    child: React.ReactNode,
    required = false,
  ) => (
    <Form.Item
      name={name}
      label={label}
      rules={required ? [{ required: true, message: "请填写" + label }] : []}
    >
      {child}
    </Form.Item>
  );
  function begin(row?: any) {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue(
      row
        ? {
            ...row,
            company_ids: (row.company_refs || []).map((ref: any) => ref.id),
            factory_ids: (row.factory_refs || []).map((ref: any) => ref.id),
            roles: row.roles?.map((r: any) => r.role),
            roleStates: Object.fromEntries(
              (row.roles || []).map((r: any) => [r.role, r.status]),
            ),
          }
        : {
            company_id: resource === "work-centers" && factory ? selected("factories", factory)?.company_id : company,
            factory_id: resource === "work-centers" ? factory : undefined,
            location_type: "INTERNAL",
            timezone: "Asia/Shanghai",
            usage_hint: "GENERAL",
            decimal_places: 0,
            tracking_mode: "BATCH",
            roles: roleFilter ? [roleFilter] : ["CUSTOMER"],
            roleStates: { CUSTOMER: "ACTIVE", SUPPLIER: "ACTIVE" },
            supplier_capabilities: [],
            unitConversions: [],
            factoryPolicies: [],
            active: true,
            role: "VIEWER",
            company_ids: [],
            factory_ids: [],
          },
    );
    setOpen(true);
  }
  async function submit() {
    try {
      const values = await form.validateFields();
      if (resource === "work-centers") delete values.company_id;
      if (resource === "partners") {
        values.roles = values.roles.map((role: string) => ({
          role,
          status: values.roleStates?.[role] || "ACTIVE",
        }));
        delete values.roleStates;
        if (!values.roles.some((r: any) => r.role === "SUPPLIER"))
          values.supplier_capabilities = [];
      }
      if (resource === "materials") {
        values.unitConversions = (values.unitConversions || []).map(
          (x: any) => ({ ...x, factor: String(x.factor) }),
        );
        if (!["SERIAL", "BATCH_SERIAL"].includes(values.tracking_mode))
          values.serial_uniqueness = null;
      }
      if (editing && resource !== "users") values.revision = editing.revision;
      if (resource === "users" && editing) delete values.password;
      await api(
        resource + (editing ? "/" + editing.id : ""),
        editing ? "PUT" : "POST",
        values,
      );
      msg.success("保存成功");
      setOpen(false);
      await load();
      await dictionaries();
    } catch (e: any) {
      if (e.errorFields) return;
      if (e.fields)
        form.setFields(
          Object.entries(e.fields).map(([name, errors]) => ({
            name: name.split(".").map((x) => (/^\d+$/.test(x) ? Number(x) : x)),
            errors: [String(errors)],
          })),
        );
      msg.error(e.message || "保存失败");
    }
  }
  async function childStatus(key: any, status: string) {
    let reason = "";
    modal.confirm({
      title: "变更子项状态",
      content: (
        <Input.TextArea
          placeholder="请输入变更原因（必填）"
          onChange={(e) => (reason = e.target.value)}
        />
      ),
      onOk: async () => {
        try {
          const result = await api(
            resource + "/" + view.id + "/child-status",
            "POST",
            { revision: view.revision, reason, status, ...key },
          );
          setView(result.data);
          await show(result.data);
          await load();
          await dictionaries();
          msg.success("状态已更新");
        } catch (e: any) {
          msg.error(e.message);
          throw e;
        }
      },
    });
  }
  async function show(row: any) {
    try {
      const [d, r, a] = await Promise.all([
        api(resource + "/" + row.id),
        api(resource + "/" + row.id + "/references"),
        isAdmin ? api(resource + "/" + row.id + "/audit") : Promise.resolve({data: []}),
      ]);
      setView(d.data);
      setRefs(r.data);
      setHistory(a.data);
    } catch (e: any) {
      msg.error(e.message);
    }
  }
  async function state(row: any, active: boolean) {
    let reason = "";
    const r = await api(resource + "/" + row.id + "/references");
    modal.confirm({
      title: active ? "启用资料" : "停用资料",
      content: (
        <Space direction="vertical">
          <span>
            {r.data.items
              .map((x: any) => `${x.type} ${x.count}项`)
              .join("；") || "暂无已接入主数据引用"}
          </span>
          <Alert type="info" message={r.data.message} />
          <Input.TextArea
            placeholder="请输入变更原因（必填）"
            onChange={(e) => (reason = e.target.value)}
          />
        </Space>
      ),
      onOk: async () => {
        try {
          await api(
            resource + "/" + row.id + (active ? "/activate" : "/deactivate"),
            "POST",
            { revision: row.revision, reason },
          );
          msg.success("状态已更新");
          await load();
          await dictionaries();
        } catch (e: any) {
          msg.error(e.message);
          throw e;
        }
      },
    });
  }
  function removeRow(row: any) {
    modal.confirm({
      title: "删除未引用草稿？",
      content: "已引用草稿及启用过的资料不能删除。",
      onOk: async () => {
        try {
          await api(resource + "/" + row.id, "DELETE", {
            revision: row.revision,
          });
          msg.success("已删除");
          load();
          dictionaries();
        } catch (e: any) {
          msg.error(e.message);
          throw e;
        }
      },
    });
  }
  const basic = (
    <>
      {!["companies", "units", "users"].includes(resource) &&
        field(
          "company_id",
          "所属公司",
          <Select
            options={options("companies")}
            disabled={!!editing || resource === "work-centers"}
            onChange={() =>
              form.setFieldsValue({
                factory_id: undefined,
                warehouse_id: undefined,
                parent_id: undefined,
                category_id: undefined,
                custodian_supplier_id: undefined,
              })
            }
          />,
          true,
        )}
      {["warehouses", "locations", "work-centers"].includes(resource) &&
        field(
          "factory_id",
          resource === "work-centers" ? "所属工厂" : "管理工厂",
          <Select
            disabled={!!editing}
            options={options("factories", (x) => resource === "work-centers" ? (x.effective_active || x.id === editing?.factory_id) : x.company_id === watchCompany)}
            onChange={(id) => {
              form.setFieldValue("warehouse_id", undefined);
              if (resource === "work-centers") form.setFieldValue("company_id", selected("factories", id)?.company_id);
            }}
          />,
          true,
        )}
      {resource === "locations" &&
        field(
          "warehouse_id",
          "所属仓库",
          <Select
            disabled={!!editing}
            options={options(
              "warehouses",
              (x) => x.factory_id === watchFactory,
            )}
            onChange={(id) => {
              const w = selected("warehouses", id);
              if (w)
                form.setFieldsValue({
                  company_id: w.company_id,
                  factory_id: w.factory_id,
                });
            }}
          />,
          true,
        )}
      {field(
        "code",
        "编码",
        <Input
          disabled={editing && editing.status !== "DRAFT"}
          placeholder="字母数字及 - _ ."
        />,
        true,
      )}
      {field("name", "名称", <Input />, true)}
      {resource === "factories" &&
        field(
          "timezone",
          "工厂时区（IANA；建立日历后固定）",
          <Input
            disabled={!!editing?.calendar_count}
            placeholder="Asia/Shanghai"
          />,
          true,
        )}
      {resource === "units" && (
        <>
          {field(
            "dimension",
            "计量维度",
            <Select
              options={opts(["COUNT", "MASS", "LENGTH", "VOLUME", "OTHER"])}
            />,
            true,
          )}
          {field(
            "decimal_places",
            "数量小数位",
            <InputNumber min={0} max={6} precision={0} />,
            true,
          )}
        </>
      )}
      {resource === "warehouses" && (
        <>
          {field(
            "location_type",
            "存放地点类型",
            <Select
              options={opts(["INTERNAL", "SUPPLIER"])}
              onChange={() => form.setFieldValue("custodian_supplier_id", null)}
            />,
            true,
          )}
          {watchType === "SUPPLIER" &&
            field(
              "custodian_supplier_id",
              "保管供应商",
              <Select
                options={options(
                  "partners",
                  (x) =>
                    x.company_id === watchCompany &&
                    x.roles?.some(
                      (r: any) =>
                        r.role === "SUPPLIER" && r.status === "ACTIVE",
                    ),
                )}
              />,
              true,
            )}
          <Alert
            message="供应商处仍可为我方资产；地点不代表物权或质量状态。"
            type="info"
            showIcon
          />
        </>
      )}
      {resource === "locations" &&
        field(
          "usage_hint",
          "用途提示",
          <Select
            options={opts(["GENERAL", "RAW", "WIP", "FINISHED", "QUARANTINE"])}
          />,
          true,
        )}
      {resource === "partners" && (
        <>
          {field(
            "roles",
            "业务角色",
            <Select mode="multiple" options={opts(["CUSTOMER", "SUPPLIER"])} />,
            true,
          )}
          {(watchRoles || []).map((r: string) =>
            field(
              ["roleStates", r],
              `${words[r]}角色状态`,
              <Select
                disabled={!!editing}
                options={opts(["ACTIVE", "INACTIVE"])}
              />,
              true,
            ),
          )}
          {watchRoles?.includes("SUPPLIER") &&
            field(
              "supplier_capabilities",
              "供应能力",
              <Select
                mode="multiple"
                options={opts(["MATERIAL", "PROCESSING"])}
              />,
              true,
            )}
          {field("contact_name", "联系人", <Input />)}
          {field("phone", "联系电话", <Input />)}
        </>
      )}
      {resource === "material-categories" &&
        field(
          "parent_id",
          "上级分类",
          <TreeSelect
            allowClear
            treeData={(dict["material-categories"] || [])
              .filter((x) => x.company_id === watchCompany)
              .map((x) => ({
                id: x.id,
                value: x.id,
                title: x.code + " · " + x.name,
                pId: x.parent_id || undefined,
                disabled: x.id === editing?.id || !x.effective_active,
              }))}
            treeDataSimpleMode
          />,
        )}
      {resource === "materials" && (
        <>
          {field(
            "category_id",
            "物料分类",
            <TreeSelect
              treeDataSimpleMode
              treeData={(dict["material-categories"] || [])
                .filter((x) => x.company_id === watchCompany)
                .map((x) => ({
                  id: x.id,
                  value: x.id,
                  title: x.code + " · " + x.name,
                  pId: x.parent_id || undefined,
                  disabled: !x.effective_active,
                }))}
            />,
          )}
          {field(
            "material_kind",
            "物料性质",
            <Select options={opts(["RAW", "SEMI", "FINISHED"])} />,
          )}
          {field("specification", "规格描述", <Input.TextArea />)}
          {field(
            "base_unit_id",
            "基本单位",
            <Select options={options("units")} />,
          )}
          {field(
            "tracking_mode",
            "追踪策略",
            <Select
              options={opts(["NONE", "BATCH", "SERIAL", "BATCH_SERIAL"])}
            />,
            true,
          )}
          {["SERIAL", "BATCH_SERIAL"].includes(watchTrack) &&
            field(
              "serial_uniqueness",
              "序列号唯一范围",
              <Select
                options={[{ value: "MATERIAL", label: "公司+物料内唯一" }]}
              />,
              true,
            )}
        </>
      )}
      {["companies", "factories", "warehouses", "partners"].includes(
        resource,
      ) && field("address", "地址", <Input.TextArea />)}
      {resource === "work-centers" && <Alert type="info" style={{marginBottom: 12}} message="一个工厂可有多个工作中心；编码在工厂内唯一，归属创建后固定。使用工厂工作日历，设备及排班尚未接入。" />}
      {field("remark", resource === "work-centers" ? "说明" : "备注", <Input.TextArea maxLength={2000} />)}
    </>
  );
  const conversions = (
    <>
      <Alert
        type="info"
        message="1辅助单位 = 换算系数 × 基本单位；只对当前物料生效，最多6位小数。"
      />
      <Form.List name="unitConversions">
        {(fields, { add, remove }) => (
          <>
            {fields.map((f) => (
              <Card
                size="small"
                key={f.key}
                extra={
                  <Button danger onClick={() => remove(f.name)}>
                    移除
                  </Button>
                }
              >
                {field(
                  [f.name, "unit_id"],
                  "辅助单位",
                  <Select options={options("units")} />,
                  true,
                )}
                {field(
                  [f.name, "factor"],
                  "换算系数",
                  <Input placeholder="如 100" />,
                  true,
                )}
              </Card>
            ))}
            <Button onClick={() => add({ factor: "1" })}>添加辅助单位</Button>
          </>
        )}
      </Form.List>
    </>
  );
  const policies = (
    <>
      <Alert
        type="info"
        message="供应方式与生产策略独立维护。检验标准及BOM/路线将在S2实现。"
      />
      <Form.List name="factoryPolicies">
        {(fields, { add, remove }) => (
          <>
            {fields.map((f) => (
              <Card
                key={f.key}
                title={"工厂策略 " + (f.name + 1)}
                size="small"
                extra={
                  <Button danger onClick={() => remove(f.name)}>
                    移除
                  </Button>
                }
              >
                {field(
                  [f.name, "factory_id"],
                  "适用工厂",
                  <Select
                    options={options(
                      "factories",
                      (x) => x.company_id === watchCompany,
                    )}
                  />,
                  true,
                )}
                {field(
                  [f.name, "status"],
                  "策略状态",
                  <Select
                    disabled={
                      !!editing?.factoryPolicies?.some(
                        (p: any) =>
                          p.factory_id === watchPolicies[f.name]?.factory_id,
                      )
                    }
                    options={opts(["ACTIVE", "INACTIVE"])}
                  />,
                  true,
                )}
                {field(
                  [f.name, "allowed_supply_modes"],
                  "允许供应方式",
                  <Select
                    mode="multiple"
                    options={opts(["BUY", "MAKE", "SUBCONTRACT"])}
                    onChange={() =>
                      form.setFieldValue(
                        ["factoryPolicies", f.name, "default_supply_mode"],
                        undefined,
                      )
                    }
                  />,
                  true,
                )}
                {field(
                  [f.name, "default_supply_mode"],
                  "默认供应方式",
                  <Select
                    options={opts(
                      watchPolicies[f.name]?.allowed_supply_modes || [],
                    )}
                  />,
                  true,
                )}
                {field(
                  [f.name, "allowed_production_strategies"],
                  "允许生产策略",
                  <Select
                    mode="multiple"
                    options={opts(["MTO", "MTS"])}
                    onChange={() =>
                      form.setFieldValue(
                        [
                          "factoryPolicies",
                          f.name,
                          "default_production_strategy",
                        ],
                        undefined,
                      )
                    }
                  />,
                )}
                {field(
                  [f.name, "default_production_strategy"],
                  "默认生产策略",
                  <Select
                    allowClear
                    options={opts(
                      watchPolicies[f.name]?.allowed_production_strategies ||
                        [],
                    )}
                  />,
                )}
                {field(
                  [f.name, "preferred_supplier_id"],
                  "首选供应商",
                  <Select
                    allowClear
                    options={options(
                      "partners",
                      (x) =>
                        x.company_id === watchCompany &&
                        x.roles?.some(
                          (r: any) =>
                            r.role === "SUPPLIER" && r.status === "ACTIVE",
                        ),
                    )}
                  />,
                )}
                {["IQC", "FQC", "OQC"].map((type, index) => (
                  <div key={type} className="inspection">
                    {field(
                      [f.name, "inspectionPolicies", index, "inspection_type"],
                      "检验环节",
                      <Select options={opts([type])} />,
                      true,
                    )}
                    {field(
                      [f.name, "inspectionPolicies", index, "requirement"],
                      "检验要求",
                      <Select
                        options={opts(["REQUIRED", "EXEMPT"])}
                        onChange={(v) => {
                          if (v === "REQUIRED")
                            form.setFieldValue(
                              [
                                "factoryPolicies",
                                f.name,
                                "inspectionPolicies",
                                index,
                                "exemption_reason",
                              ],
                              null,
                            );
                        }}
                      />,
                      true,
                    )}
                    {field(
                      [f.name, "inspectionPolicies", index, "exemption_reason"],
                      "免检原因",
                      <Input />,
                    )}
                  </div>
                ))}
              </Card>
            ))}
            <Button
              onClick={() =>
                add({
                  status: "ACTIVE",
                  allowed_supply_modes: ["BUY"],
                  default_supply_mode: "BUY",
                  allowed_production_strategies: [],
                  inspectionPolicies: ["IQC", "FQC", "OQC"].map(
                    (inspection_type) => ({
                      inspection_type,
                      requirement: "REQUIRED",
                    }),
                  ),
                })
              }
            >
              添加工厂策略
            </Button>
          </>
        )}
      </Form.List>
    </>
  );
  const userForm = (
    <>
      {field("username", "用户名", <Input />, true)}
      {!editing &&
        field(
          "password",
          "初始密码",
          <Input.Password autoComplete="new-password" placeholder="至少12位" />,
          true,
        )}
      {field(
        "role",
        "角色",
        <Select options={opts(["ADMIN", "EDITOR", "VIEWER", "RELEASER"])} />,
        true,
      )}
      <Form.Item name="active" valuePropName="checked">
        <Checkbox>账号启用</Checkbox>
      </Form.Item>
      {field(
        "company_ids",
        "授权公司",
        <Select
          mode="multiple"
          options={(dict.companies || []).map((x) => ({
            value: x.id,
            label: x.code + " · " + x.name,
          }))}
        />,
      )}
      {field(
        "factory_ids",
        "授权工厂",
        <Select
          mode="multiple"
          options={(dict.factories || []).map((x) => ({
            value: x.id,
            label: x.code + " · " + x.name,
          }))}
        />,
      )}
    </>
  );
  if (checking) return <Spin fullscreen />;
  if (!user)
    return (
      <ConfigProvider button={{ autoInsertSpace: false }} locale={zhCN}>
        <div className="login">
          <Card title="MES 制造管理系统">
            {versionError && <Alert type="error" message={versionError} action={<Button onClick={() => window.location.reload()}>刷新页面</Button>} />}
            {loginNotice && (
              <Alert
                type="success"
                showIcon
                message={loginNotice}
                style={{ marginBottom: 16 }}
              />
            )}
            <Typography.Paragraph type="secondary">
              登录后维护组织与制造基础资料
            </Typography.Paragraph>
            <Form
              form={login}
              layout="vertical"
              onFinish={async (v) => {
                try {
                  const x = await api("auth/login", "POST", v);
                  setUser(x.data);
                  setLoginNotice("");
                } catch (e: any) {
                  msg.error(e.message);
                }
              }}
            >
              {field(
                "username",
                "用户名",
                <Input autoComplete="username" />,
                true,
              )}
              {field(
                "password",
                "密码",
                <Input.Password autoComplete="current-password" />,
                true,
              )}
              <Button type="primary" htmlType="submit" block disabled={!!versionError}>
                登录
              </Button>
            </Form>
          </Card>
          {context}
          {modalContext}
        </div>
      </ConfigProvider>
    );
  const menu = [
    {key:"numbering",label:"编号中心",children:[{key:"numbering-rules",label:"编号规则"},{key:"number-allocations",label:"分配记录"}]},
    {
      key: "organization",
      label: "组织管理",
      children: ["companies", "factories", "work-centers", "factory-calendars"].map((key) => ({
        key,
        label: key === "factory-calendars" ? labels[key] : labels[key] + "管理",
      })),
    },
    {
      type: "group" as const,
      label: "仓储基础",
      children: ["warehouses", "locations"].map((key) => ({
        key,
        label: labels[key],
      })),
    },
    {
      type: "group" as const,
      label: "往来单位",
      children: [
        { key: "partners", label: "全部往来单位" },
        { key: "customers", label: "客户" },
        { key: "suppliers", label: "供应商" },
      ],
    },
    {
      type: "group" as const,
      label: "物料基础",
      children: ["units", "material-categories", "materials"].map((key) => ({
        key,
        label: labels[key],
      })),
    },
    ...(isAdmin
      ? [
          {
            type: "group" as const,
            label: "系统",
            children: [{ key: "users", label: "用户权限" }],
          },
        ]
      : []),
  ];
  return (
    <ConfigProvider
      button={{ autoInsertSpace: false }}
      locale={zhCN}
      theme={{ token: { colorPrimary: "#14645d", borderRadius: 6 } }}
    >
      {context}
      {modalContext}
      <Modal
        title="修改密码"
        open={passwordOpen}
        onCancel={closePassword}
        footer={null}
        destroyOnHidden
        maskClosable={!passwordBusy}
        closable={!passwordBusy}
      >
        <Alert
          type="info"
          showIcon
          message="新密码须为12–200个字符；修改后所有设备均需重新登录。"
          style={{ marginBottom: 16 }}
        />
        {passwordError && (
          <Alert
            type="error"
            showIcon
            message={passwordError}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form form={passwordForm} layout="vertical" onFinish={changePassword}>
          <Form.Item
            name="oldPassword"
            label="当前密码"
            rules={[{ required: true, message: "请输入当前密码" }]}
          >
            <Input.Password autoComplete="current-password" maxLength={500} />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: "请输入新密码" },
              { min: 12, max: 200, message: "新密码须为12–200个字符" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value || value !== getFieldValue("oldPassword")
                    ? Promise.resolve()
                    : Promise.reject(new Error("新密码不能与当前密码相同"));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" maxLength={200} />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={["newPassword"]}
            rules={[
              { required: true, message: "请再次输入新密码" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value || value === getFieldValue("newPassword")
                    ? Promise.resolve()
                    : Promise.reject(new Error("两次输入的新密码不一致"));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" maxLength={200} />
          </Form.Item>
          <Space>
            <Button onClick={closePassword} disabled={passwordBusy}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={passwordBusy}>
              确认修改
            </Button>
          </Space>
        </Form>
      </Modal>
      <Layout style={{ minHeight: "100vh" }}>
        <Sider width={216} theme="light">
          <div className="brand">
            MES <small>制造管理系统</small>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[
              roleFilter
                ? roleFilter === "CUSTOMER"
                  ? "customers"
                  : "suppliers"
                : resource,
            ]}
            defaultOpenKeys={["organization"]}
            items={menu}
            onClick={(x) => navigate(x.key)}
          />
        </Sider>
        <Layout>
          <Header className="header">
            <span>
              MES 制造管理系统
            </span>
            <Space>
              {user.username}
              <Tag>{words[user.role]}</Tag>
              <Button
                onClick={() => {
                  passwordForm.resetFields();
                  setPasswordError("");
                  setPasswordOpen(true);
                }}
              >
                修改密码
              </Button>
              <Button
                onClick={async () => {
                  await api("auth/logout", "POST", {});
                  setUser(undefined);
                }}
              >
                退出
              </Button>
            </Space>
          </Header>
          <Content className="content">
            {versionError && <Alert type="error" message={versionError} action={<Button onClick={() => window.location.reload()}>刷新页面</Button>} />}
            {versionError ? null : ["numbering-rules", "number-allocations"].includes(resource) ? <NumberingCenter api={api} user={user} companies={dict.companies || []} factories={dict.factories || []} mode={resource === "numbering-rules" ? "rules" : "allocations"} /> : resource === "factory-calendars" ? (
              <CalendarPage
                api={api}
                user={user}
                companies={dict.companies || []}
                factories={dict.factories || []}
                initialFactory={factory}
              />
            ) : (
              <>
                <Typography.Title level={3}>
                  {roleFilter ? words[roleFilter] : labels[resource]}
                </Typography.Title>
                <Typography.Paragraph type="secondary">
                  维护基础资料，保存草稿后启用。业务订单、库存及
                  BOM/工艺尚未接入。
                </Typography.Paragraph>
                <Card>
                  <Space wrap className="toolbar">
                    <Input.Search
                      placeholder="搜索编码 / 名称"
                      allowClear
                      onSearch={(v) => {
                        setSearch(v);
                        setPage(1);
                      }}
                      style={{ width: 220 }}
                    />
                    {resource !== "users" && (
                      <Select
                        placeholder="全部状态"
                        allowClear
                        options={opts(["DRAFT", "ACTIVE", "INACTIVE"])}
                        value={status}
                        onChange={(v) => {
                          setStatus(v);
                          setPage(1);
                        }}
                        style={{ width: 130 }}
                      />
                    )}
                    {!["companies", "units", "users"].includes(resource) && (
                      <Select
                        placeholder="全部公司"
                        allowClear
                        options={(dict.companies || []).map((x) => ({
                          value: x.id,
                          label: x.code + " · " + x.name,
                        }))}
                        value={company}
                        onChange={(v) => {
                          setCompany(v);
                          setFactory(undefined);
                          setPage(1);
                        }}
                        style={{ width: 180 }}
                      />
                    )}
                    {["warehouses", "locations", "work-centers"].includes(resource) && (
                      <Select
                        placeholder="全部工厂"
                        allowClear
                        options={(dict.factories || [])
                          .filter((x) => !company || x.company_id === company)
                          .map((x) => ({
                            value: x.id,
                            label: x.code + " · " + x.name,
                          }))}
                        value={factory}
                        onChange={(v) => {
                          setFactory(v);
                          setPage(1);
                        }}
                        style={{ width: 180 }}
                      />
                    )}
                    {resource === "materials" && (
                      <>
                        <Select
                          placeholder="全部性质"
                          allowClear
                          style={{ width: 130 }}
                          options={opts(["RAW", "SEMI", "FINISHED"])}
                          value={kind}
                          onChange={(v) => {
                            setKind(v);
                            setPage(1);
                          }}
                        />
                        <Select
                          placeholder="全部供应方式"
                          allowClear
                          style={{ width: 150 }}
                          options={opts(["BUY", "MAKE", "SUBCONTRACT"])}
                          value={supply}
                          onChange={(v) => {
                            setSupply(v);
                            setPage(1);
                          }}
                        />
                      </>
                    )}
                    <Button onClick={load}>刷新</Button>
                    {(canEdit || (resource === "users" && isAdmin)) && (
                      <Button type="primary" onClick={() => begin()}>
                        新建{labels[resource]}
                      </Button>
                    )}
                  </Space>
                  {error && (
                    <Alert
                      type="error"
                      message={error}
                      action={<Button onClick={load}>重试</Button>}
                      style={{ marginBottom: 16 }}
                    />
                  )}
                  <Table
                    rowKey="id"
                    loading={busy}
                    dataSource={rows}
                    scroll={{ x: 980 }}
                    pagination={
                      resource === "users"
                        ? false
                        : {
                            current: page,
                            pageSize: 20,
                            total,
                            onChange: setPage,
                            showSizeChanger: false,
                            showTotal: (n) => `共 ${n} 条`,
                          }
                    }
                    columns={
                      resource === "users"
                        ? [
                            { title: "用户名", dataIndex: "username" },
                            {
                              title: "角色",
                              dataIndex: "role",
                              render: (x) => words[x],
                            },
                            {
                              title: "状态",
                              dataIndex: "active",
                              render: (x) => (x ? "启用" : "停用"),
                            },
                            {
                              title: "操作",
                              render: (_, r) => (
                                <Space>
                                  <Button onClick={() => begin(r)}>
                                    编辑授权
                                  </Button>
                                  <Button
                                    onClick={() => {
                                      let p = "";
                                      modal.confirm({
                                        title: "重置密码（至少12位）",
                                        content: (
                                          <Input.Password
                                            onChange={(e) =>
                                              (p = e.target.value)
                                            }
                                          />
                                        ),
                                        onOk: async () => {
                                          await api(
                                            "users/" + r.id + "/reset-password",
                                            "POST",
                                            { password: p },
                                          );
                                          msg.success("密码已重置");
                                        },
                                      });
                                    }}
                                  >
                                    重置密码
                                  </Button>
                                </Space>
                              ),
                            },
                          ]
                        : [
                            { title: "编码", dataIndex: "code", width: 140 },
                            { title: "名称", dataIndex: "name", width: 190 },
                            {
                          title: resource === "work-centers" ? "公司 / 工厂" : "归属",
                              width: 170,
                          render: (_, r) => resource === "work-centers"
                            ? `${selected("companies", r.company_id)?.name || r.company_id} / ${selected("factories", r.factory_id)?.name || r.factory_id}`
                            : selected("companies", r.company_id)?.name || "全局",
                            },
                            {
                              title: "状态",
                              dataIndex: "status",
                              width: 100,
                              render: (x) => (
                                <Tag
                                  color={
                                    x === "ACTIVE"
                                      ? "green"
                                      : x === "DRAFT"
                                        ? "default"
                                        : "orange"
                                  }
                                >
                                  {words[x]}
                                </Tag>
                              ),
                            },
                            {
                              title: "有效性",
                              width: 150,
                              render: (_, r) =>
                                r.effective_active ? (
                                  <Tag color="green">有效</Tag>
                                ) : (
                                  <span
                                    title={r.effectiveness_reasons.join("；")}
                                  >
                                    未生效
                                  </span>
                                ),
                            },
                            {
                              title: "操作",
                              fixed: "right",
                              width: 320,
                              render: (_, r) => (
                                <Space size={0}>
                                  {resource === "factories" && (
                                    <Button type="link" onClick={() => openFactoryCenters(r)}>工作中心</Button>
                                  )}
                                  {resource === "factories" && (
                                    <Button
                                      type="link"
                                      onClick={() => {
                                        setFactory(r.id);
                                        setResource("factory-calendars");
                                      }}
                                    >
                                      工厂日历管理
                                    </Button>
                                  )}
                                  <Button type="link" onClick={() => show(r)}>
                                    详情
                                  </Button>
                                  {canEdit && (
                                    <Button
                                      type="link"
                                      disabled={resource === "work-centers" && !workCenterParentActive(r)}
                                      onClick={() => begin(r)}
                                    >
                                      编辑
                                    </Button>
                                  )}
                                  {canRelease && (
                                    <Button
                                      type="link"
                                      disabled={resource === "work-centers" && r.status !== "ACTIVE" && !workCenterParentActive(r)}
                                      onClick={() =>
                                        state(r, r.status !== "ACTIVE")
                                      }
                                    >
                                      {r.status === "ACTIVE" ? "停用" : "启用"}
                                    </Button>
                                  )}
                                  {canEdit && r.status === "DRAFT" && (
                                    <Button
                                      type="link"
                                      danger
                                      onClick={() => removeRow(r)}
                                    >
                                      删除
                                    </Button>
                                  )}
                                </Space>
                              ),
                            },
                          ]
                    }
                    locale={{ emptyText: "暂无资料，请新建或调整筛选" }}
                  />
                </Card>
              </>
            )}
          </Content>
        </Layout>
      </Layout>
      <Modal
        title={(editing ? "编辑" : "新建") + labels[resource]}
        open={open}
        width={resource === "materials" ? 880 : 640}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        destroyOnHidden
      >
        <Alert
          type="info"
          message={
            resource === "users"
              ? "授权公司与工厂共同限定访问；更改账号将撤销其现有会话。"
              : "保存草稿需填写编码、名称及结构必需项；启用时执行完整校验。"
          }
          style={{ marginBottom: 16 }}
        />
        <Form form={form} layout="vertical" preserve={false}>
          {resource === "users" ? (
            userForm
          ) : resource === "materials" ? (
            <Tabs
              items={[
                {
                  key: "basic",
                  label: "基本资料",
                  forceRender: true,
                  children: basic,
                },
                {
                  key: "units",
                  label: "辅助单位",
                  forceRender: true,
                  children: conversions,
                },
                {
                  key: "policy",
                  label: "工厂策略与检验",
                  forceRender: true,
                  children: policies,
                },
              ]}
            />
          ) : (
            basic
          )}
        </Form>
      </Modal>
      <Drawer
        title={view ? view.code + " · " + view.name : "详情"}
        open={!!view}
        onClose={() => setView(undefined)}
        width={760}
      >
        {view && (
          <>
            <Descriptions
              bordered
              column={1}
              items={Object.entries(view)
                .filter(([k, v]) => !Array.isArray(v) && v != null && k !== "factory_calendar")
                .map(([k, v]) => ({
                  key: k,
                  label:
                    (
                      {
                        id: "内部标识",
                        uuid: "配对UUID",
                        code: "编码",
                        name: "名称",
                        status: "状态",
                        remark: "备注",
                        revision: "修订号",
                        address: "地址",
                        timezone: "工厂时区",
                        work_center_count: "工作中心数量",
                        calendar_count: "年度日历数量",
                        factory_calendar: "工厂工作日历",
                        effective_active: "当前有效",
                        company_id: "所属公司",
                        factory_id: "所属工厂",
                        warehouse_id: "所属仓库",
                        category_id: "物料分类",
                        parent_id: "上级分类",
                        base_unit_id: "基本单位",
                        custodian_supplier_id: "保管供应商",
                        contact_name: "联系人",
                        phone: "联系电话",
                        location_type: "存放地点",
                        usage_hint: "用途提示",
                        dimension: "计量维度",
                        decimal_places: "数量小数位",
                        material_kind: "物料性质",
                        specification: "规格描述",
                        tracking_mode: "追踪策略",
                        serial_uniqueness: "序列号唯一范围",
                        created_at: "创建时间",
                        updated_at: "更新时间",
                        created_by: "创建人员ID",
                        updated_by: "更新人员ID",
                      } as any
                    )[k] || k,
                  children:
                    typeof v === "boolean"
                      ? v
                        ? "是"
                        : "否"
                      : [
                            "company_id",
                            "factory_id",
                            "warehouse_id",
                            "category_id",
                            "parent_id",
                            "base_unit_id",
                            "custodian_supplier_id",
                          ].includes(k)
                        ? (() => {
                            const d = selected(
                              (
                                {
                                  company_id: "companies",
                                  factory_id: "factories",
                                  warehouse_id: "warehouses",
                                  category_id: "material-categories",
                                  parent_id: "material-categories",
                                  base_unit_id: "units",
                                  custodian_supplier_id: "partners",
                                } as any
                              )[k],
                              v,
                            );
                            return d ? d.code + " · " + d.name : String(v);
                          })()
                        : typeof v === "object" ? JSON.stringify(v) : words[String(v)] || String(v),
                }))}
            />
            {view.effectiveness_reasons?.length > 0 && (
              <Alert
                message={view.effectiveness_reasons.join("；")}
                type="warning"
              />
            )}
            {resource === "factories" && <Space style={{marginTop: 16, marginBottom: 16}} wrap>
              <Button onClick={() => openFactoryCenters(view)}>查看工作中心{view.work_center_count !== undefined ? `（${view.work_center_count}）` : ""}</Button>
              <Button onClick={() => {setFactory(view.id);setView(undefined);setResource("factory-calendars");}}>工厂日历管理</Button>
            </Space>}
            {resource === "work-centers" && <Space direction="vertical" style={{marginTop:16, marginBottom:16, width:"100%"}}>
              <Alert type="info" message="使用所属工厂工作日历" description="工作中心不单独覆盖日历；未配置年度日历时不可作为全工作日。设备及班次排班尚未接入。" />
              {!workCenterParentActive(view) && <Alert type="warning" message="所属工厂或公司未启用，工作中心当前只读，允许停用或删除未引用草稿。" />}
              <Button onClick={() => {setFactory(view.factory_id);setView(undefined);setResource("factory-calendars");}}>工厂日历管理</Button>
            </Space>}
            {resource === "partners" && (
              <>
                <Typography.Title level={5}>业务角色</Typography.Title>
                {view.roles.map((r: any) => (
                  <Space
                    key={r.role}
                    style={{ marginBottom: 8, display: "flex" }}
                  >
                    <Tag>
                      {words[r.role]} · {words[r.status]}
                    </Tag>
                    {canRelease && (
                      <Button
                        onClick={() =>
                          childStatus(
                            { role: r.role },
                            r.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                          )
                        }
                      >
                        {r.status === "ACTIVE" ? "停用" : "启用"}角色
                      </Button>
                    )}
                  </Space>
                ))}
              </>
            )}
            {resource === "materials" && (
              <>
                <Typography.Title level={5}>
                  辅助单位与工厂策略
                </Typography.Title>
                {view.factoryPolicies.map((p: any) => (
                  <Space
                    key={p.factory_id}
                    style={{ marginBottom: 8, display: "flex" }}
                  >
                    <Tag>
                      {selected("factories", p.factory_id)?.name} ·{" "}
                      {words[p.status]}
                    </Tag>
                    {canRelease && (
                      <Button
                        onClick={() =>
                          childStatus(
                            { factory_id: p.factory_id },
                            p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                          )
                        }
                      >
                        {p.status === "ACTIVE" ? "停用" : "启用"}策略
                      </Button>
                    )}
                  </Space>
                ))}
                <pre>
                  {JSON.stringify(
                    {
                      unitConversions: view.unitConversions,
                      factoryPolicies: view.factoryPolicies,
                    },
                    null,
                    2,
                  )}
                </pre>
                <Button
                  onClick={() => {
                    let qty = "2",
                      unit = view.base_unit_id;
                    modal.confirm({
                      title: "单位换算预览",
                      content: (
                        <Space direction="vertical">
                          <Input
                            defaultValue="2"
                            onChange={(e) => (qty = e.target.value)}
                          />
                          <Select
                            style={{ width: 260 }}
                            defaultValue={unit}
                            options={options(
                              "units",
                              (x) =>
                                x.id === view.base_unit_id ||
                                view.unitConversions.some(
                                  (u: any) => u.unit_id === x.id,
                                ),
                            )}
                            onChange={(v) => (unit = v)}
                          />
                        </Space>
                      ),
                      onOk: async () => {
                        try {
                          const r = await api(
                            "materials/" + view.id + "/convert",
                            "POST",
                            { quantity: qty, from_unit_id: unit },
                          );
                          msg.success("基本单位数量：" + r.data.quantity);
                        } catch (e: any) {
                          msg.error(e.message);
                          throw e;
                        }
                      },
                    });
                  }}
                >
                  换算预览
                </Button>
              </>
            )}
            <Typography.Title level={5}>已接入引用</Typography.Title>
            {refs?.items.map((x: any) => (
              <Tag key={x.type}>
                {x.type}：{x.count}
              </Tag>
            ))}
            <Alert type="info" message={refs?.message} />
            <Typography.Title level={5}>审计记录</Typography.Title>
            {history.map((h) => (
              <Card
                size="small"
                key={h.id}
                title={`${h.actor_name} · ${h.action}`}
              >
                <div>
                  {new Date(h.occurred_at).toLocaleString("zh-CN")} {h.reason}
                </div>
                <details>
                  <summary>修改前后明细{h.snapshot_version === 1 ? "（历史UUID快照，非当前数字ID）" : "（数字ID与UUID配对快照）"}</summary>
                  <pre>
                    {JSON.stringify(
                      { before: h.before_json, after: h.after_json },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </Card>
            ))}
          </>
        )}
      </Drawer>
    </ConfigProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);


