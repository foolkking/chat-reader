# 文档维护规则

最后核验：2026-08-24

完整文件分类见 [Markdown 文档台账](../documentation-inventory.md)。

## 真值与生命周期

1. 当前代码、配置、migration 和测试是第一真值。
2. `PROJECT_STATE.md` 是紧凑当前快照；`docs/system/` 是详细当前事实。
3. 根 README/AGENTS 只做入口和规则，不复制架构历史。
4. `planning/`、`execution/`、`evidence/` 按日期封存；可加索引说明，不回写旧结论伪装当前事实。
5. `apps/api/storage/imports/**/*.md` 和 `examples/**/*.md` 是数据/fixture，不属于文档系统。

## 事实等级

- `已确认`：当前代码/配置/migration/test 直接证明。
- `生产快照`：带日期、版本和方法的线上证据。
- `部分确认`：只完成一部分链路或自动化验证。
- `待验证`：证据不足；明确写验证方法。
- `不适用`：当前产品边界明确排除。

“未发现”不能改写成“绝不存在”；设计建议不能混入事实段落。

## 更新触发

| 变更 | 必须更新 |
| --- | --- |
| 产品边界/核心能力 | `PROJECT_STATE`, `product`, `FEATURE_INVENTORY` |
| 页面、面板、移动入口 | `PAGE_AND_ROUTE_MAP`, `USER_FLOWS` |
| API/schema | `api-reference`, `BACKEND_AND_API` |
| 表、migration、Dexie、协议 | `PROJECT_STATE`, `DATA_AND_STORAGE`, deployment docs |
| 环境变量/Compose/代理 | `development`, `deployment`, `DEPLOYMENT_AND_ENVIRONMENT` |
| 身份/Share/离线权限 | roles、API、feature 文档 |
| 新风险或解决风险 | `KNOWN_ISSUES...`；解决过程进入新的 execution record |
| 新增/移动 Markdown | `docs/index` 和 `documentation-inventory` |

## 写作与证据

- 每份事实文档标注最后核验日期；生产结论同时标注证据日期，不只写“当前”。
- 命令必须来自 package scripts、Makefile、Compose 或已验证操作；不发明参数。
- 详细信息只保留一个权威位置，其他文档使用相对链接。
- 截图/请求记录写明 URL 模板、视口/方法、身份、前置条件和脱敏状态。
- 数量、耗时、镜像 ID 和像素误差属于时间点证据，不写成产品规格。

## 安全

禁止持久化密码、Cookie、token、API key、私钥、完整 DB URL、真实用户正文、私人标题/ID、未脱敏环境 dump 或服务器绝对路径。使用 `<PROJECT_ROOT>`、`<PUBLIC_URL>`、`<CONVERSATION_ID>` 等占位符。

## 差异记录模板

```text
核验日期/代码状态：
代码侧事实：
生产侧快照：
原文档描述：
当前确认程度：
证据：
下一次验证方式：
```
