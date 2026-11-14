# MES 主数据工作台

本地启动后访问 [http://127.0.0.1:18080](http://127.0.0.1:18080)，使用同源构建版。本机原3001端口处于 Windows TCP 保留范围。当前数据规范为 **BIGINT_UUID25**；旧17表/UUID数据与快照属于迁移历史，不能作为日常新环境的建库或样例规则。

当前已实现基础主数据、组织管理及业务编号中心，使用 TypeScript/Fastify、React/Ant Design 中文界面及真实 MySQL 8.4 / InnoDB（mysql2 驱动）。BOM、工艺、检验标准、库存与采购/生产/销售单据尚未实现。

## 当前数据与接口规则

25张业务表中，17张实体表使用内部 `BIGINT UNSIGNED AUTO_INCREMENT` 主键，并保存独立UUID；其余8张认证/关联表保留会话键或复合主键。UUID列不建普通、唯一或复合索引；业务编码、已发号码、幂等键等业务唯一约束保留。

API的ID始终为十进制字符串。单对象请求使用数字路径及必要的UUID配对校验，关联字段与授权引用也须成对；所有API请求带版本2。UUID不替代公司/工厂范围及角色授权。页面会从有权列表取得配对，用户无需手填ID或UUID；旧页面版本不兼容时应整页刷新。

日常迁移入口 `npm run db:migrate` 使用 `db/mysql-bigint/001_bigint_uuid_baseline.json`。旧 `db/mysql/001～004`、旧UUID库、legacy夹具与备份仅供专用迁移/兼容验证保留，不得与日常新库或新样例混用。已有数据应先备份、转换和逐字段核验，不能靠seed、清库或重置管理员替代迁移。实际本地对齐状态见[本地测试数据与环境对齐记录](docs/本地测试数据与环境对齐记录.md)。

## 全新环境运行（Windows PowerShell）

要求 Node.js 24、npm 11、Docker Desktop 已启动。以下命令均在 `D:\aiProject\mes` 执行。

```powershell
npm install
npm run env:init
docker compose -f compose.mysql.yaml --env-file .env up -d --wait mysql
npm run db:migrate
```

`env:init` 仅在不存在 `.env` 时生成独立随机应用和管理密码，不输出密码、不覆盖现有配置。当前 `compose.yaml` 与 `compose.mysql.yaml` 均使用项目 `mes-mysql-local`、MySQL 8.4、原独立卷 `mes-mysql-local_mes_mysql_data`，固定绑定 `127.0.0.1:13379`，日常库为 `mes_local_bigint`，无需额外端口override。旧 `artifacts/production/test-port.yaml` 不属于日常启动命令。

应用连接使用本地日常库账号；`MYSQL_ADMIN_URL` 仅用于明确授权的本地建库、迁移或测试隔离库管理，不作为应用连接。真实配置、密码和备份不提交。已有 `.env`、旧UUID库或旧卷不会因修改Compose变量而自动转换；必须先备份、转换和核对，不能重新初始化、seed或重置管理员替代迁移。PG历史迁移资料另见[MySQL切换方案](docs/MySQL切换方案.md)。

首次建立自己的管理员，密码至少12位，使用安全输入避免回显：

```powershell
$env:ADMIN_USERNAME = 'admin'
$mesSecurePassword = Read-Host '设置管理员密码（至少12位）' -AsSecureString
$env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $mesSecurePassword).Password
try { npm run user:create-admin } finally { Remove-Item Env:ADMIN_PASSWORD; Remove-Variable mesSecurePassword }
```

既有管理员密码随迁移保留；重复执行创建命令默认保留既有管理员密码和权限。若明确需要重置，可用上述安全输入流程，将命令改为 `npm run user:create-admin -- --reset`；它只在本地明确重置指定既有管理员并注销会话。管理员和演示脚本会核验本地目标与新数据系谱，不用于线上库。不要把真实密码写入文档或提交。

```powershell
# 仅在明确需要虚构演示资料的本地新库执行；迁移本身不调用seed
npm run db:seed:demo
npm run build
npm start
```

打开 [http://127.0.0.1:18080](http://127.0.0.1:18080)。API如 `GET /api/v1/auth/me` 需带 `X-MES-API-Version: 2`，带版本头但未登录返回401；直接打开裸API链接缺少版本头时返回426。停止应用按 Ctrl+C。开发模式 `npm run dev` 的前端为5173，代理仍指向3001；当前18080同源配置应使用上述构建版，开发前需配套调整代理、API_PORT和WEB_ORIGIN。

开发/验收使用普通 HTTP；`NODE_ENV=production` 启用 Secure Cookie，生产必须配置 HTTPS。线上部署实际状态以[主键迁移实施与验收记录](docs/主键迁移实施与验收记录.md)及运维记录为准，本地启动或测试命令不能直接用于生产。
## 已有功能

- 公司、工厂、工作中心、工厂日历；仓库、库位、供应商处位置；仓库事务启用默认库位。
- 客户/供应商共享主体和独立角色状态，供料/加工能力。
- 全局单位、树形分类、物料、专属辅助单位换算。
- 物料工厂供应方式、默认值、订单/备货生产策略，IQC/FQC/OQC 必检与有原因的豁免配置。
- 草稿维护、启停用、未引用草稿删除；关联校验、有效性、乐观并发修订、事务审计及已接入引用展示。
- Cookie 会话、管理员/维护员/启停用员/只读四角色及公司/工厂隔离；管理员可维护账号、授权及重置密码。
- 本人修改密码及会话撤销；编号规则维护、不占号格式预览、分配记录查询。生产订单、建批、单件追溯尚未接入，页面没有公开取号或假订单入口。

角色：ADMIN 全部；EDITOR 保存授权资料但不能启停用；RELEASER 只读及启停用；VIEWER 只读。全局单位维护和公司创建只允许 ADMIN。角色/策略的状态在详情中使用专门按钮变更并填写原因，普通编辑不可绕过。普通用户必须同时授权公司及工厂才能访问工厂级资料。

当前演示脚本按新主键与配对规则生成本地虚构资料：C01/F01、CU01/SU01～SU03、WH01～WH03、PCS/BOX、R01/R02/H01/H02/P01。R02 独享 `1 BOX = 100 PCS`。重复运行只补充缺失编码，不覆盖已有同编码数据；若现有数据不符合样例关联，事务失败并提示，不自动修复用户数据。旧UUID快照与legacy测试夹具只用于迁移兼容验证，不是该日常演示脚本的输入。

## 验证

```powershell
npm test
npm exec playwright install chromium
npm run build
npm run test:e2e
npm audit
```

集成测试和浏览器测试均在当前专属 MySQL 实例中新建 `mes_test_*` 临时库；不会 TRUNCATE 开发库。API 测试结束删除自己创建的测试库。浏览器验收临时启动 `127.0.0.1:18081`；仅测试使用随机账号，测试完成后清理。测试日志、截图和录屏在忽略的 `artifacts/`、`test-results/`，不提交密码。

## 开发或测试结束后停止本项目服务

应用进程按 Ctrl+C停止，然后只停止本项目MySQL容器，保留镜像和数据卷：

```powershell
docker compose -f compose.mysql.yaml --env-file .env stop -t 60 mysql
# 下次开发或测试前启动同一服务
docker compose -f compose.mysql.yaml --env-file .env up -d --wait mysql
```

对应容器为 `mes-mysql-local-mysql-1`。镜像只占磁盘，保留作构建缓存和回退；不要用 `down -v` 删除数据卷，不运行全局Docker清理，不停止Docker Desktop或其他项目容器，线上wgroup环境不在这些本地命令范围内。

迁移有checksum校验，已应用SQL不可改写。MySQL DDL不支持整段事务回滚，失败后按迁移状态处理，不盲目重跑或删除已有数据。`compose.postgres.legacy.yaml`、PG17及54329卷仅为历史资料；`pg`依赖只供旧迁移，不是应用运行驱动。数据库卷不是备份；新旧系谱备份不能混用，实际备份/恢复证据以运维记录为准。

## 文档与边界

- [需求与功能范围基线](docs/需求与功能范围基线.md)
- [主数据模块详细设计](docs/主数据模块详细设计.md)
- [技术设计与实施计划](docs/技术设计与实施计划.md)
- [S1 实施与验收记录](docs/S1实施与验收记录.md)
- [生产部署方案](docs/生产部署方案.md)
- [生产部署与运维记录](docs/生产部署与运维记录.md)（发布实测状态以记录内容为准）
- [主键迁移实施与验收记录](docs/主键迁移实施与验收记录.md)
- [本地测试数据与环境对齐记录](docs/本地测试数据与环境对齐记录.md)

本次不建立空的订单/BOM 页面；引用提示明确“业务订单引用尚未接入”，不把未知订单数量展示为已核对的0。主数据保存不产生库存或检验结果。完整权限编排、复杂审批、附件/批量导入、高级排程、设备采集、财务和外部接口尚不在 S1。


