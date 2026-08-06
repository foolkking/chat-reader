# 智能体上下文兼容入口

状态：已合并并压缩；最后整理 2026-07-29。

此文件曾保存一份 2026-07-26 的完整系统快照，后来与根状态文档、系统事实文档和执行日志重复并产生 migration、移动端、最近入口等冲突。为兼容旧链接保留本路径，但不再单独维护项目事实。

新任务按以下顺序读取：

1. [AGENTS.md](../../AGENTS.md)：工作规则和禁止事项。
2. [PROJECT_STATE.md](../../PROJECT_STATE.md)：当前仓库、实现、风险和最后验证。
3. [docs/index.md](../index.md)：专题文档导航。
4. [docs/system/README.md](../system/README.md)：详细系统事实。
5. [docs/documentation-inventory.md](../documentation-inventory.md)：文档生命周期与数据型 Markdown 边界。

关键提醒：

- `docs/planning/`、`docs/execution/`、`docs/evidence/` 是带日期的历史档案，不是当前代码真值。
- 当前源码 Alembic head、OpenAPI 数量、页面入口和测试状态应从代码重新核验。
- 不要读取、改写或持久化导入目录中的私人 Markdown 正文来建立项目上下文。
