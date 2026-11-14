import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test('本人修改密码校验、退出和重新登录',async({page})=>{
 const {password}=JSON.parse(await readFile('artifacts/e2e-secret.json','utf8'));
 await page.goto('/');await page.getByLabel('用户名',{exact:true}).fill('browser-admin');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByRole('button',{name:'修改密码',exact:true}).click();
 await page.getByLabel('当前密码',{exact:true}).fill(password);await page.getByLabel('新密码',{exact:true}).fill('Browser-New!Password123');await page.getByLabel('确认新密码',{exact:true}).fill('mismatch');await page.getByRole('button',{name:'确认修改',exact:true}).click();await expect(page.getByText('两次输入的新密码不一致',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'修改密码',exact:true}).click();await expect(page.getByLabel('当前密码',{exact:true})).toHaveValue('');
 await page.getByLabel('当前密码',{exact:true}).fill(password);await page.getByLabel('新密码',{exact:true}).fill('Browser-New!Password123');await page.getByLabel('确认新密码',{exact:true}).fill('Browser-New!Password123');await page.getByRole('button',{name:'确认修改',exact:true}).click();
 await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();await expect(page.getByText('密码已修改，请使用新密码重新登录',{exact:true})).toBeVisible();
 await page.getByLabel('用户名',{exact:true}).fill('browser-admin');await page.getByLabel('密码',{exact:true}).fill('Browser-New!Password123');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('button',{name:'修改密码',exact:true})).toBeVisible();
 // Restore fixture credentials so the independent master-data scenario can run.
 await page.getByRole('button',{name:'修改密码',exact:true}).click();await page.getByLabel('当前密码',{exact:true}).fill('Browser-New!Password123');await page.getByLabel('新密码',{exact:true}).fill(password);await page.getByLabel('确认新密码',{exact:true}).fill(password);await page.getByRole('button',{name:'确认修改',exact:true}).click();await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
});
