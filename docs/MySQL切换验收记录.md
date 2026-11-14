# 本地 MySQL 切换验收记录

2026-10-20，本地 MES 从 PostgreSQL 17 切换至 MySQL 8.4.11。范围为已有 S1 主数据应用；S2～S4 尚未实现。本次没有线上部署、Git 提交/推送，也没有修改其他项目。

## 当前运行

- 中文同源界面：http://127.0.0.1:18080；真实认证 `/api/v1/health` 返回 `MySQL`、`8.4.11`、`mes`。
- MySQL：`compose.mysql.yaml`，项目 `mes-mysql-local`，服务 `mysql`，仅 `127.0.0.1:33079`，卷 `mes-mysql-local_mes_mysql_data`，容器健康。
- 运行连接使用 `mes_app`，根管理员连接仅用于本地隔离测试/迁移。`.env` 已切换；密码不在本记录中。
- 原 PG 容器 `mes-local-db-1` 已在 MySQL 验证稳定后停止，原卷 `mes-local_mes_pgdata`、配置和备份保留，未删卷。

## 数据验收

导入前冻结旧 18080 进程，确认源库无其他连接，再导出 custom 格式 `pg_dump` 并用 `pg_restore --list` 核验数据表清单；PG 快照使用 UTC、REPEATABLE READ、READ ONLY。目标启用外键和 CHECK，在同一 DML 事务、同一连接内完成导入及逐表摘要比对，全部一致才提交。

17 张业务表共 **77 行**。字段全量规范化后逐行排序并计算 SHA256，源与目标所有表的行数/摘要一致；保留 UUID、微秒时间、decimal 精度、JSON/数组原义、密码哈希及审计。源迁移历史另存于敏感快照，MySQL 使用独立迁移状态/校验和。

| 表 | 行数 |
| --- | ---: |
| users | 1 |
| sessions | 0 |
| companies | 1 |
| factories | 1 |
| partners | 4 |
| partner_roles | 4 |
| warehouses | 3 |
| locations | 7 |
| units | 2 |
| material_categories | 1 |
| materials | 5 |
| material_units | 1 |
| material_factory_policies | 5 |
| material_inspection_policies | 15 |
| user_company_scopes | 0 |
| user_factory_scopes | 0 |
| audit_logs | 27 |

最终运行验证只创建随机临时 VIEWER，认证后读取5条原物料、检查真实引擎，重启服务后用同一会话再次读取；随后清理临时账号、授权和会话。清理后再次对照最终源快照，**17表77行仍全部一致**。未重置原账号、未 seed，未增加正式业务/审计记录。原用户密码未掌握，凭密码哈希逐字段一致及隔离认证测试验证保留；没有冒充以原用户密码登录。

## 测试与保护

- 完整构建通过；前端单块体积提示仍存在，不阻止运行。
- 切换后默认 `.env` 的真实 MySQL API 集成测试 **21/21** 通过：原13项，加 JSON集合/CHECK/FK、微秒及ISO文本、大小写认证、分类互指并发、最后库位并发、最后管理员并发、连接锁竞争/释放、DDL部分失败与拒绝重放8项。
- 真实 Chromium 中文全流程最终 **1/1通过**（约1.7分钟）：登录、组织/供应商/仓库/单位/分类/物料建档、启用、编辑、刷新持久化、停用、重复编码拒绝。修复六类字典串行刷新拖延确认框关闭的问题，改为跨类型并行、每类仍顺序分页；启停用等待具体响应并断言成功/对应编码及目标行状态。该长流程独立预算180秒，15秒动作预算和业务断言保留，不使用sleep/force绕过检查。
- `npm audit`：0 vulnerabilities。
- 4类非法目标身份（远程主机、错误端口、错误目标库、错误源端口）全部拒绝；18080应用运行时 final 入口实际拒绝，未导入。
- importer 强校验源/目标仅本机专属实例和库，源容器/卷身份、精确17业务表集合；演练库删除严格限定自动生成前缀。
- MySQL迁移使用独立版本、checksum、APPLYING/APPLIED/FAILED、已执行步数和失败步号；DDL失败不自动重放。

## 证据及恢复

敏感目录 `artifacts/mysql-switch/` 已限制为当前 Windows 用户和 SYSTEM，且被 Git/Docker上下文忽略。不要分享原始快照、`.env`、密码或密码哈希。

- `postgres-final.dump`：60,391字节；SHA256 `cec854684c1bdb52420ac321e185a43a0a2b44b750093784574a6cab59f95d3c`；清单验证见 `postgres-backup-check.json`。
- 导入核对 `final-verification.json`；重启及临时用户清理后的核对 `final-runtime-verification.json`；实际认证引擎/重启报告 `runtime-verification.json`。
- 原应用/API构建、脚本、包清单、PG迁移和原 `.env` 在 `rollback/`。旧 PG SQL `db/migrations/` 仅历史保留；运行迁移只读取 `db/mysql/`。
- 仅启动原 PG 供读取：`docker start mes-local-db-1`。如需按旧 Compose 恢复，使用原安全环境：`docker compose -f compose.yaml --env-file artifacts/mysql-switch/rollback/.env up -d db`。这不会自动切换应用。
- 切换后 MySQL 出现新写入时，不得直接回切旧快照；须先停写、备份 MySQL并核对新增数据。没有自动/盲目回滚。
