# UX audit: noise review bulk selection and exact-range editing — 2026-10-15

Follow-up: the [range-editing batch](ux-audit-noise-range-editing-2026-10-15.md)
supersedes this record's deferral of candidate-range editing. This remains the
dated evidence for the earlier bulk-only decision, not the current contract.
The later batch also restricts pending checks to eligible items and keeps
checkbox names stable while linking state through an accessible description.

## Scope and evidence boundary

本轮只审查导入完成后的“清理噪声”复核，以及设置/对话中的 Content Cleanup review。未启动 Web/API 服务、未登录、未读取生产数据；证据来自当前源码、类型、API schema 和现有 E2E 文本。没有把历史文档或导入原文当作 canonical 真值。

## Current behavior observed

- `apps/web/features/conversations/cleanup-review-workspace.tsx` 已支持单个 occurrence 的 `KEEP/DELETE`，也支持“选择/保留全部匹配项”；后者通过 `/decisions/filter` 作用于当前筛选范围并跨分页。
- `CleanupCandidate` 使用原生 checkbox 显示单个候选，候选默认 `KEEP`；选择后才进入 preview/apply，正文不会在复核阶段改变。
- preview 只读地显示完整 before/after 与 `removed_ranges`；当前 apply contract 只有 `preview_token`，服务端没有接收用户自定义 ranges/text 的字段。
- `apps/web/features/editing/source-editor-workspace.tsx` 已有基于真实源码选区的 focused cleanup 入口，可创建 manual-selection scan；这是当前可安全编辑“确切部分”的既有路径。

## Findings

### NOISE-01 — 中：批量动作的作用域和保存中的反馈不够显眼

现象：批量动作会覆盖当前筛选的全部分页，但按钮文案只是“选择全部匹配项/保留全部匹配项”；底部计数等到服务器返回才变化，`pendingDecisions` 只覆盖单行操作。候选较多时，用户容易把“当前页”“当前分组”和“整个筛选范围”混淆，也看不到批量动作正在保存的明确状态。

证据：`cleanup-review-workspace.tsx` 的批量 mutation 没有 bulk pending overlay；`cleanup-review-workspace.tsx:280-281` 的按钮与说明分离，作用域不在按钮上；`cleanup-review-workspace.tsx:205-210` 的计数/忙碌状态仅依赖服务端 scan 与 mutation。

风险：用户可能误以为只处理当前页，或在请求未确认时重复点击；这与“很多个候选、一次处理多个”的目标冲突。

### NOISE-02 — 中：候选可以逐条 KEEP/DELETE，但缺少“调整确切删除范围”的显式入口

现象：当前 review 是 occurrence 级二元决策，preview 可以显示 exact `removed_ranges`，但不能在 preview 中编辑范围。后端 `CleanupApplyInput` 只有 `preview_token`，直接增加“编辑文本”而不扩展 canonical/version contract 会造成 UI 承诺与实际 apply 不一致。

风险：一个检测范围过宽时，用户只能保留整个候选或删除整个候选，无法在清理前把范围缩小到准确片段。

设计结论：本轮不伪造可编辑 preview，也不把自由文本直接写入 canonical。先把“批量复核 + 明确选择状态”做好；确切范围编辑沿用既有源码编辑器的真实选区入口，作为下一步需要 API/版本语义评审的独立能力。若后续实现，应只允许在同一 message version 上保存明确 ranges，并在 preview token 中绑定 ranges，冲突时整条保持原文。

### NOISE-03 — 低至中：勾选状态只有颜色/原生控件反馈，批量和不可选原因不够聚焦

现象：候选行没有显式的“将删除/保留”状态文本；protected/stale/conflict 主要在下方说明，勾选控件本身没有把“已选、保存中、不可选”状态关联给屏幕阅读器和快速扫读用户。

风险：长列表中用户难以快速确认哪些会进入 preview；批量保存或失败恢复时认知成本更高。

## Chosen change for this batch

1. 保留现有 server-side occurrence decision 与 preview/apply contract，不改数据库、不破坏 `.cr`、Share、离线兼容或 canonical message version。
2. 给批量操作增加同一控件内的 scope/count 文案、保存中状态，并在保存期间锁住重复操作。
3. 给每个候选增加明确的“将删除/保留”状态、选中行强调、忙碌时的可读反馈；仍使用原生 checkbox 和真实 `checked` 状态。
4. 将“精确范围可编辑”明确为源码编辑器选区能力，而不是在当前 review 中做没有后端合同支撑的假编辑。

## Acceptance evidence

- 源码静态回归：批量 action 文案含当前筛选 scope；mutation 期间有 `role=status`；逐条候选的 checkbox label/state 与选中视觉同步；错误仍进入已有“重新读取选择”恢复路径。
- 不运行本地服务、不登录、不读取用户正文；使用 `git diff --check` 及必要的纯源码检查。

## Implemented in this batch

- `cleanup-review-workspace.tsx` 增加 bulk decision 的本地 pending state：批量选择/保留会立即锁住重复动作、给当前筛选范围显示保存中状态，并把当前范围候选的 checkbox 视觉先切到待保存结果；失败仍回到既有“重新读取选择”恢复路径。
- 批量按钮旁直接显示当前筛选候选数，并把“跨全部分页、排除保护区和冲突项”的边界保留在同一操作组中。
- `cleanup-candidate.tsx` 为每个候选显示“将删除/保留/正在保存选择/受保护，不会处理”，并用左侧强调与淡色背景强化已选行；checkbox 的 accessible name 同步包含状态。
- 导入完成提示明确“可多选处理”；清理面板说明精确范围需要回到 Markdown 源码选区后重新扫描，避免承诺当前 API 尚不支持的自由编辑。

Targeted Web ESLint passed for the two changed review components. `git diff --check` passed. No service, browser, build, full test suite, commit, CI or deployment was run.

## Open follow-up

真正的“在 preview 中拖动/编辑删除范围”需要单独设计并实现 API schema、preview token、range overlap/protected validation、message version 冲突和迁移/测试；本轮不以 UI 假装完成。
