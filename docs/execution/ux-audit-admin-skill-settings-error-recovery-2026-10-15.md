# 管理员 Skill 设置错误恢复审查 — 2026-10-15

本批属于持续普通用户体验优化，范围仅为管理员 Skill 列表中的“统一默认文件”与“恢复内置”两个已有操作。依据当前工作树源码和 `apps/web/lib/admin-client.ts` 的状态错误合同，未启动服务、未登录、未操作生产，不进行浏览器或全量门禁验证。本记录先于源码编辑建立。

## 修改前证据

文件：`apps/web/components/admin-skill-settings.tsx`
修改前 SHA-256：`C18EBC6D152A94D75F5A6ED8EB78E11F92A0E5E2AADAA7406CDF57DC98236989`

源码观察：

- `changeDefault` 与 `restore` 使用 `onSuccess: refresh`；列表、用户 Skill 和 resolved Skill 的失效／重读与写入成功状态没有分开呈现。
- 组件末尾直接渲染 `(changeDefault.error ?? restore.error)?.message`。`AdminRequestError` 会把服务端 `detail` 放进 `message`，网络异常也可能是底层英文文本，用户会看到不稳定的实现细节。
- 明确的 401/403/404/409/422/429 与网络／5xx／未知写入结果需要不同恢复方向；当前没有状态映射，也没有“写入已确认但列表刷新失败”的局部提示。
- 当前已有确认弹窗、dirty/busy 禁用、Skill bundle 文件编辑和管理员 API 合同，不应在本批改变。

## 发现

| ID | 严重度／置信度 | 证据与用户影响 | 处理 |
|---|---|---|---|
| ADMIN-SKILL-ERR-01 | Medium；Observed (code)，渲染 Inferred | 两个管理员写入 mutation 将底层 `.message` 直接显示；内部路径／英文服务端 detail 不能告诉管理员下一步，也可能泄露实现文本。 | 映射有限状态为稳定中英文恢复文案，未知结果要求重新读取核对。 |
| ADMIN-SKILL-STATE-02 | Medium；Observed (code)，渲染 Inferred | `onSuccess: refresh` 没有独立的刷新失败反馈；列表读失败可能掩盖已确认的写入或把成功动作呈现为失败边界。 | 写入成功先保留成功反馈；刷新失败只显示列表未更新并提供现有 Retry，不自动重写。 |

## 保留边界

不改变管理员权限、确认弹窗、Skill bundle 内容、用户首选、系统 Skill API、请求参数、缓存键或自动重试策略；不增加新页面和新网络请求。浏览器、真实管理员会话和资源性能验收留待授权环境。

## 实施记录

`apps/web/components/admin-skill-settings.tsx` 现在将两个管理员写入操作的状态与后续列表刷新分离：确认写入后先保留成功反馈；列表读取失败只显示未刷新并提供只读“重新读取列表”，不把已确认写入误报为失败，也不自动重复写入。

`AdminRequestError` 的 401/403/404/409/413/422/429、408/5xx 和未知结果现在有稳定的中英文恢复文案；不再把服务端 `detail`、网络异常或内部错误名直接放进界面。原有确认、dirty/busy 禁用、Skill bundle 编辑、缓存键和请求参数保持不变。

本轮未启动服务、未登录、未运行浏览器或全量门禁，不提交、不触发 CI、不部署。以上是源码证据；真实管理员会话、渲染、读屏和资源验收仍待授权环境。
