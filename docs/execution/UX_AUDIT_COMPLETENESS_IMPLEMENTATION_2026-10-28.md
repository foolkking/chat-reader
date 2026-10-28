# 完整性复审优化实施记录 — 2026-10-28

## 状态

本记录对应 [完整性复审](ux-audit-completeness-review-2026-10-28.md) 的源码实施
跟进。9 项发现均已完成有界源码修复；本轮没有提交、推送、CI 或部署，也没有
运行本地测试、lint、typecheck、构建、浏览器、服务或数据库。

## 已实施的边界修复

| 审查项 | 实施 |
| --- | --- |
| FORM-COMP-01 | 草稿删除保留同一运行期内、原 CAS 版本的待确认意图；失败后先重试删除再 hydrate，未确认期间保留工作区离开提醒，避免重试或快速返回时恢复已放弃文本。 |
| STATE-COMP-01 | 附件改名在同一 API 事务中重建受影响对话（含未放入消息的所属对话）搜索文档、推进离线 revision，并窄化刷新当前／全局／侧栏搜索缓存；同名 no-op 不重建、不推进 revision，派生失败则整体回滚。 |
| NAV-COMP-01 | 自定义排序在超过 API 的 500 条合同后停用拖拽并说明边界；不对已加载子集偷排。 |
| DATA-COMP-01 | 降序自定义拖拽按完整服务器优先级（置顶状态及置顶时间）分组反转为 canonical ascending rank；拒绝跨优先级拖动，避免保存后反转或跳回。 |
| NAV-COMP-02 | TOC 纯追加页面或缓存发布不再重新居中旧活动项；作用域、活动项或对应 DOM 身份变化仍可定位，不扩大真实 Reader 导航合同。 |
| DATA-COMP-02 | XLSX 预览保留有界行号和列坐标，稀疏坐标不再被伪装成连续网格，远坐标不会分配无界数组；ODS 仅适配行结构，不新增重复行列／跨度保真能力。 |
| DATA-COMP-03 | XLSX 工作表与 PPTX 幻灯片按 manifest 的关系声明顺序解析；manifest 存在但关系缺失、无效或外部时明确失败。仅整个 manifest 缺失时，才用通用名称和文件名顺序有界降级并警告顺序未验证。 |
| DATA-COMP-04 | shared strings 保留空项位置；无效或预算外引用显示明确占位，不泄漏内部索引。 |
| STATE-COMP-02 | ZIP 源文件、条目数、单条目、展开总量和损坏结构使用不同错误码与反馈；保留下载降级。 |

## 变更范围

- API：`apps/api/app/api/routes/attachments.py`。
- Web：评论草稿恢复、会话列表排序、TOC 分页锚点、复杂附件 worker/viewer。
- 回归源码：API `test_attachment_upload_api.py` 增加放入／未放入消息的改名、
  搜索／revision、同名 no-op 和派生写入后失败回滚。
- 草稿 helper 与 workspace 用例增加删除失败、隔离、CAS、新写入优先和显式
  重试／离开提醒；列表增加 499/500/501、升降序及置顶时间优先级；TOC 增加
  追加／缓存发布时保持位置和新活动项／新作用域定位。
- `scripts/ux/complex-preview-bounds.test.mjs` 增加关系顺序与无效关系、
  稀疏／自闭合／越界坐标、空 shared strings／无效引用及各类 ZIP 错误码样例。
- 未改 migration、offline package v1/v2/v3、Dexie v2、Share URL、`.cr` 或用户导入资料。

## 证据与恢复边界

上述回归均已编写、未执行；设计覆盖范围仅限 SQLite API fixture、序列化存储
替身、受控 React／几何适配器和实际 worker 源码各自的边界，不能代替
PostgreSQL、真实 IndexedDB、浏览器拖拽或 DOM 滚动验收。

本轮只做只读静态检查：`git diff --check` 返回 0（仅有 Git 行尾转换提示）；
本批新建／未跟踪文件另行扫描，无尾部空白或合并冲突标记。以上不是语法、
类型或运行时验证，不改变“未验收”状态。

删除失败时的待确认意图保存在同一运行期的内存中，而不是声称存储失败时仍能
写入持久 tombstone。若忽略离开提醒并强制刷新或进程崩溃，不能保证该意图保留。
Office XML 解析仍为有界预览，不是完整 OOXML 校验或恶意文档安全认证。

## 未完成的验收门禁

1. 尚未验证 IndexedDB 删除事务失败后的真实刷新／切换时序。
2. 尚未运行 499/500/501 条排序、升降序置顶组合和真实 DOM TOC 滚动。
3. 尚未运行 API 搜索／离线 delta、复杂附件 worker/viewer、Web typecheck 或专项门禁。
4. relationship XML 的恶意文件安全性、完整 Office 保真和性能仍不在本批声明内。

因此“已实施”不等于“已通过测试”或“可部署”。下一步应先获得运行授权，再按
[专项验收边界](../testing.md#completeness-follow-up-optimization--2026-10-28-source-only)
运行对应门禁，之后决定是否提交。
