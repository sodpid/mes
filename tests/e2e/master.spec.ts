import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("中文UI从登录到组织、供应商、仓库、分类与物料建档并刷新持久化", async ({
  page,
}) => {
  test.setTimeout(180_000);
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
  async function create(
    section: string,
    code: string,
    name: string,
    extra?: () => Promise<void>,
  ) {
    await page.getByRole("menuitem", { name: section === "公司" || section === "工厂" ? section+"管理" : section, exact: true }).click();
    await page
      .getByRole("button", { name: "新建" + section, exact: true })
      .click();
    await page.getByLabel("编码", { exact: true }).fill(code);
    await page.getByLabel("名称", { exact: true }).fill(name);
    if (extra) await extra();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page
        .getByRole("row")
        .filter({ has: page.getByText(code, { exact: true }) }),
    ).toBeVisible();
  }
  async function choose(label: string, text: string) {
    await page
      .getByLabel(label, { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]')
      .click();
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText(text, { exact: true })
      .click();
  }
  async function activate(code: string) {
    const row = page
      .getByRole("row")
      .filter({ has: page.getByText(code, { exact: true }) });
    await row.getByRole("button", { name: "启用", exact: true }).click();
    await page
      .getByPlaceholder("请输入变更原因（必填）")
      .fill("浏览器验收启用");
    const confirmation = page.getByRole("dialog", { name: "启用资料" });
    const activated = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/activate"),
    );
    await confirmation.getByRole("button", { name: /^确\s*定$/ }).click();
    const response = await activated;
    expect(response.status()).toBe(200);
    expect((await response.json()).data.code).toBe(code);
    await expect(row.getByText("有效", { exact: true })).toBeVisible();
    await expect(confirmation).toHaveCount(0);
  }
  await create("公司", "UI-C01", "浏览器公司");
  await page
    .getByRole("row")
    .filter({ has: page.getByText("UI-C01", { exact: true }) })
    .getByRole("button", { name: "启用", exact: true })
    .click();
  await page.getByRole("button", { name: /^取\s*消$/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await activate("UI-C01");
  await create("工厂", "UI-F01", "浏览器工厂", async () =>
    choose("所属公司", "UI-C01 · 浏览器公司"),
  );
  await activate("UI-F01");
  await page.getByRole("menuitem", { name: "供应商", exact: true }).click();
  await page.getByRole("button", { name: "新建往来单位" }).click();
  await page.getByLabel("所属公司", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("UI-C01 · 浏览器公司", { exact: true })
    .click();
  await page.getByLabel("编码", { exact: true }).fill("UI-SU01");
  await page.getByLabel("名称", { exact: true }).fill("浏览器供方");
  await choose("供应能力", "加工");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await activate("UI-SU01");
  await create("仓库", "UI-WH01", "浏览器外部仓", async () => {
    await choose("所属公司", "UI-C01 · 浏览器公司");
    await choose("管理工厂", "UI-F01 · 浏览器工厂");
    await choose("存放地点类型", "供应商");
    await choose("保管供应商", "UI-SU01 · 浏览器供方");
  });
  await activate("UI-WH01");
  await create("计量单位", "UI-PCS", "浏览器件", async () =>
    choose("计量维度", "件类"),
  );
  await activate("UI-PCS");
  await create("物料分类", "UI-CAT1", "根分类甲", async () =>
    choose("所属公司", "UI-C01 · 浏览器公司"),
  );
  await activate("UI-CAT1");
  await create("物料分类", "UI-CAT2", "根分类乙", async () =>
    choose("所属公司", "UI-C01 · 浏览器公司"),
  );
  await activate("UI-CAT2");
  await create("物料分类", "UI-SUB", "子分类", async () => {
    await choose("所属公司", "UI-C01 · 浏览器公司");
    await page.getByLabel("上级分类", { exact: true }).click();
    await page.getByTitle("UI-CAT1 · 根分类甲", { exact: true }).click();
  });
  await activate("UI-SUB");
  await create("物料", "UI-M01", "浏览器物料", async () => {
    await choose("所属公司", "UI-C01 · 浏览器公司");
    await page.getByLabel("物料分类", { exact: true }).click();
    await expect(
      page.getByTitle("UI-CAT1 · 根分类甲", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTitle("UI-CAT2 · 根分类乙", { exact: true }),
    ).toBeVisible();
    await page.getByTitle("UI-CAT2 · 根分类乙", { exact: true }).click();
    await choose("物料性质", "半成品");
    await choose("基本单位", "UI-PCS · 浏览器件");
  });
  await activate("UI-M01");
  let row = page
    .getByRole("row")
    .filter({ has: page.getByText("UI-M01", { exact: true }) });
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("浏览器物料已修改");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("menuitem", { name: "物料", exact: true }).click();
  await expect(
    page.getByText("浏览器物料已修改", { exact: true }),
  ).toBeVisible();
  row = page
    .getByRole("row")
    .filter({ has: page.getByText("UI-M01", { exact: true }) });
  await row.getByRole("button", { name: "停用", exact: true }).click();
  await page.getByPlaceholder("请输入变更原因（必填）").fill("浏览器停用验收");
  const stoppedDialog = page.getByRole("dialog", { name: "停用资料" });
  const deactivated = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname.endsWith("/deactivate"),
  );
  await stoppedDialog.getByRole("button", { name: /^确\s*定$/ }).click();
  const stoppedResponse = await deactivated;
  expect(stoppedResponse.status()).toBe(200);
  expect((await stoppedResponse.json()).data.code).toBe("UI-M01");
  await expect(row.getByText("停用", { exact: true }).first()).toBeVisible();
  await expect(stoppedDialog).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/浏览器物料建档.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "新建物料", exact: true }).click();
  await page.getByLabel("所属公司", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("UI-C01 · 浏览器公司", { exact: true })
    .click();
  await page.getByLabel("编码", { exact: true }).fill(" ui-m01 ");
  await page.getByLabel("名称", { exact: true }).fill("重复编码");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByText("编码或明细已存在（停用编码也不能复用）", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/浏览器重复编码提示.png",
    fullPage: true,
  });
});
