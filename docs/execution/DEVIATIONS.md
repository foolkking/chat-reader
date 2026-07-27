# 执行偏差

| 编号 | 类型 | 规划/预期 | 实际处理 | 产品行为影响 |
|---|---|---|---|---|
| DEV-001 | 文档计数差异 | 摘要称约 46 项 | `EXECUTION_MANIFEST.md` 实际枚举 63 个唯一任务 ID；执行日志逐一记录 63 项 | 无 |
| DEV-002 | 路径差异 | 批注索引回填入口未指定确定路径 | 复用 Python module command，新增 `apps/api/scripts/backfill_annotation_search.py` | 无 |
| DEV-003 | 命令环境差异（已修复） | 根脚本直接调用 `pnpm` | 根 `package.json` 改为显式 `corepack pnpm`，README 中的根命令可直接执行 | 无 |
| DEV-004 | 执行覆盖修正 | OFL-01 原条目提及 schema/重新下载提示 | 按 EX-OVERRIDE-001 保持 Dexie version 1 和 stores 不变，不增加清库或重新下载流程 | 无，属于高优先级覆盖修正 |

没有自行接受的产品行为偏差，也没有需要用户确认的偏差。
