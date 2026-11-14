import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("工作日历真实月历保存、批量恢复、周规则、冲突保留与刷新", async ({
  page,
}) => {
  test.setTimeout(180000);
  const { password } = JSON.parse(
    await readFile("artifacts/e2e-secret.json", "utf8"),
  );
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("browser-admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "公司管理", exact: true }),
  ).toBeVisible();
  const pairs=new Map<string,string>();
  async function api(path: string, method = "GET", data?: any) {
    const [resource,id]=path.split('/');const headers:Record<string,string>={'x-mes-api-version':'2'};
    if(id)headers['x-resource-uuid']=pairs.get(resource+':'+id)!;
    const body=data?{...data}:undefined;
    for(const [key,entity] of [['company_id','companies'],['factory_id','factories']])if(body?.[key])body[key.slice(0,-3)+'_uuid']=pairs.get(entity+':'+body[key]);
    const r = await page.request.fetch("/api/v1/" + path, { method, data:body, headers });
    expect(r.status(), await r.text()).toBeLessThan(300);
    const result=(await r.json()).data;if(result?.id&&result.uuid)pairs.set(resource+':'+result.id,result.uuid);return result;
  }
  let co = await api("companies", "POST", {
    code: "CAL-UI",
    name: "日历浏览器公司",
  });
  co = await api("companies/" + co.id + "/activate", "POST", {
    revision: co.revision,
    reason: "浏览器前置",
  });
  let f = await api("factories", "POST", {
    company_id: co.id,
    code: "CAL-UI",
    name: "日历浏览器工厂",
  });
  f = await api("factories/" + f.id + "/activate", "POST", {
    revision: f.revision,
    reason: "浏览器前置",
  });
  await page.reload();
  await page
    .getByRole("menuitem", { name: "工厂日历管理", exact: true })
    .click();
  await page.getByLabel("日历年度", { exact: true }).fill("2028");
  await page.getByLabel("日历年度", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "新建年度草稿", exact: true }).click();
  async function choose(label: string, text: string) {
    await page.getByRole("combobox",{name:label,exact:true}).locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]').click();
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText(text, { exact: true })
      .click();
  }
  await choose("新建工厂", "日历浏览器工厂");
  await page.getByLabel("新建年度", { exact: true }).fill("2028");
  await page.getByRole("dialog").getByText("周六", { exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("周六",{exact:true})).toBeChecked();
  await page.getByRole("button", { name: "创建草稿", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "2028-01-01 工作", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "设置工作周", exact: true }).click();
  await page.getByLabel("周规则生效日期", { exact: true }).fill("2028-01-01");
  await page
    .getByRole("dialog")
    .getByPlaceholder("变更原因（必填）", { exact: true })
    .fill("调整为双休");
  await page.getByRole("button", { name: "保存规则", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await choose("月份", "2028年2月");
  await page
    .getByRole("button", { name: "2028-02-29 工作", exact: true })
    .click();
  await page.getByLabel("日期备注", { exact: true }).fill("闰年休息备注");
  await page.getByLabel("日期变更原因", { exact: true }).fill("单日休息");
  await page
    .getByRole("button", { name: "预览并保存 1 天", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("2028-02-29");
  await page.getByRole("button", { name: "保存变更", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "2028-02-29 休息例外", exact: true }),
  ).toContainText("闰年休息备注");
  await page
    .getByRole("button", { name: "2028-02-27 休息", exact: true })
    .click();
  await choose("日期操作", "设为工作（例外）");
  await page.getByLabel("日期备注", { exact: true }).fill("周日补班");
  await page.getByLabel("日期变更原因", { exact: true }).fill("补班验证");
  await page
    .getByRole("button", { name: "预览并保存 1 天", exact: true })
    .click();
  await page.getByRole("button", { name: "保存变更", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "2028-02-27 工作例外", exact: true }),
  ).toBeVisible();
  await page.getByLabel("范围开始日期", { exact: true }).fill("2028-02-01");
  await page.getByLabel("范围结束日期", { exact: true }).fill("2028-02-03");
  await page.getByRole("button", { name: "加入选择", exact: true }).click();
  await choose("日期操作", "设为休息（例外）");
  await page.getByLabel("日期备注", { exact: true }).fill("批量休息");
  await page.getByLabel("日期变更原因", { exact: true }).fill("批量验证");
  await page
    .getByRole("button", { name: "预览并保存 3 天", exact: true })
    .click();
  await page.getByRole("button", { name: "保存变更", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "2028-02-02 休息例外", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "2028-02-02 休息例外", exact: true })
    .click();
  await choose("日期操作", "恢复默认周规则");
  await page.getByLabel("日期变更原因", { exact: true }).fill("恢复默认验证");
  await page
    .getByRole("button", { name: "预览并保存 1 天", exact: true })
    .click();
  await page.getByRole("button", { name: "保存变更", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "2028-02-02 工作", exact: true }),
  ).toContainText("周规则");
  // Update through the same authenticated API to emulate another editor and verify conflict inputs.
  const list = await page.request.get("/api/v1/factory-calendars?year=2028",{headers:{'x-mes-api-version':'2'}});
  let cal = (await list.json()).items.find((x: any) => x.factory_id === f.id);
  pairs.set('factory-calendars:'+cal.id,cal.uuid);
  await page.getByRole("button", { name: "设置工作周", exact: true }).click();
  await page.getByLabel("周规则生效日期", { exact: true }).fill("2028-06-01");
  await page.getByRole("dialog").getByLabel("周六", { exact: true }).check();
  await page
    .getByRole("dialog")
    .getByPlaceholder("变更原因（必填）", { exact: true })
    .fill("冲突后保留的规则");
  await api("factory-calendars/" + cal.id + "/rules", "PUT", {
    revision: cal.revision,
    reason: "并发编辑",
    changes: [{ date: "2028-12-31", operation: "REST" }],
  });
  await page.getByRole("button", { name: "保存规则", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("版本冲突");
  const refreshed=page.waitForResponse(r=>r.request().method()==="GET"&&new URL(r.url()).pathname===`/api/v1/factory-calendars/${cal.id}`);
  await page
    .getByRole("button", { name: "刷新最新详情并保留规则输入", exact: true })
    .click();
  const freshResponse=await refreshed;expect(freshResponse.status()).toBe(200);await freshResponse.finished();
  await expect(page.getByRole("button",{name:/保存规则$/})).not.toHaveClass(/ant-btn-loading/);
  await expect(page.getByLabel("周规则生效日期", { exact: true })).toHaveValue(
    "2028-06-01",
  );
  await expect(
    page
      .getByRole("dialog")
      .getByPlaceholder("变更原因（必填）", { exact: true }),
  ).toHaveValue("冲突后保留的规则");
  const saved=page.waitForResponse(r=>r.request().method()==="PUT"&&new URL(r.url()).pathname===`/api/v1/factory-calendars/${cal.id}/rules`);
  const saveButton=page.getByRole("dialog").getByRole("button",{name:/保存规则$/});
  await expect(saveButton).not.toHaveClass(/ant-btn-loading/);
  await saveButton.click();
  const savedResponse=await saved;expect(savedResponse.status()).toBe(200);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("menuitem", { name: "工厂日历管理", exact: true })
    .click();
  await page.getByLabel("日历年度", { exact: true }).fill("2028");
  await page.getByLabel("日历年度", { exact: true }).press("Tab");
  await page
    .getByRole("row")
    .filter({ hasText: "日历浏览器工厂 · 2028" })
    .getByRole("button", { name: "查看日历", exact: true })
    .click();
  await choose("月份", "2028年2月");
  await expect(
    page.getByRole("button", { name: "2028-02-29 休息例外", exact: true }),
  ).toContainText("闰年休息备注");
  await expect(
    page.getByRole("button", { name: "2028-02-02 工作", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "下一月", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "2028-03-01 工作", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/organization-calendar-browser.png",
    fullPage: true,
  });
});
