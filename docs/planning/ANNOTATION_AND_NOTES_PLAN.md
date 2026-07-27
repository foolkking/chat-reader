# 批注与精选笔记规划 ANNOTATION_AND_NOTES_PLAN

**创建日期：** 2026-07-27
**依据：** DECISION_LOG D-010, D-015, D-015-A, D-016
**核心文件：** `apps/web/features/annotations/annotation-workspace.tsx`、`apps/web/lib/annotation-repository.ts`、后端 `apps/api/app/api/routes/annotations.py`、`services/annotations.py`、模型 `apps/api/app/models/annotation.py`（`conversation_annotations` / `conversation_notebooks` / `annotation_sync_receipts`）。

---

## 1. 定位（D-010）
- 批注与精选笔记保持 **Reader 内功能**，不做全局中心。
- 搜索范围可含批注内容（见 SEARCH_AND_DISCOVERY_PLAN §5）。

---

## 2. 批注类型与颜色语义
| 类型 | 说明 | CSS（globals.css L145-161） |
|------|------|------|
| highlight | 背景高亮 | `::highlight(annotation-highlight-*)` |
| underline | 下划线 | `annotation-underline-*` |
| strikethrough | 删除线 | `annotation-strikethrough-*` |
| comment | 下划线 + 评论 | `annotation-comment-*` |
| bookmark | 整条消息书签 | `.annotation-bookmark` inset 左条 |

颜色：黄/绿/蓝/粉（保留）。颜色语义在 UI 说明（如黄=重点、绿=已理解等，可选文案）。

---

## 3. 锚点状态
- active / relocated / stale 三态。
- stale 降级到 block/message 并提示。
- 锚点字段：version/block/offset/quote/prefix/suffix。

---

## 4. 工作区形态（D-015 / D-015-A）
见 READER_REDESIGN_PLAN §6。要点：
- **默认浮窗**（覆盖正文，可拖动/调整/记忆）。
- **固定到左侧导航栏**（完全覆盖 Project 树/对话列表，提供返回入口）。
- **拆离/关闭**：可拆回浮窗；关闭恢复左侧导航栏。
- 不取代任何 TOC，独立第四区域。

---

## 5. 管理能力（保留 + 优化）
- 文本选择工具条：选类型 + 颜色，comment 同时编辑评论。
- 单项：改类型/颜色/评论、加入笔记、删除、定位。
- 批量（管理模式）：筛选、全选/反选/清空、批量样式、加入笔记、删除。
- 精选笔记：Markdown 段落 + annotation reference，dnd-kit 拖动排序（`conversation_notebooks`）。

---

## 6. 离线创建与同步
- 离线只允许写 annotation/notebook：UUID + base revision → outbox（Dexie）。
- 同步：`POST /api/annotations/sync` 幂等 + receipt（`annotation_sync_receipts`）。
- 冲突：保留"冲突副本"。
- 事件：`chat-reader:outbox`（`offline-db.ts` 派发，`offline-sync-manager.tsx` 监听）。

---

## 7. 移动端能力（D-016 简化创建）
- **支持创建**：highlight / underline / comment（简化选色，如仅 2-3 色或默认色）。
- 精选笔记：只读查看，不编辑。
- 批量管理：不支持（桌面）。
- 明确提示复杂管理请用桌面端。

---

## 8. 隐私（Share/Export）
- annotations / notebook 默认**不进入** Share 和 Export；仅对应 include flag 开启时包含。

---

## 9. 状态设计
| 状态 | 表现 |
|------|------|
| stale 锚点 | 灰显 + 定位降级提示 |
| 同步中 | outbox 计数/指示 |
| 冲突 | 冲突副本说明 + 操作 |
| 空批注 | 工作区空态引导选文本创建 |
| 移动只读区 | 明确"桌面端管理"提示 |

---

## 10. 涉及文件
| 变更 | 文件 |
|------|------|
| 工作区（浮窗/固定/拆离/管理） | `apps/web/features/annotations/annotation-workspace.tsx` |
| 仓库/同步 | `apps/web/lib/annotation-repository.ts`, `lib/offline-db.ts`, `components/offline-sync-manager.tsx` |
| 左侧栏覆盖 | `apps/web/features/projects/project-sidebar.tsx` |
| 选区工具/书签 | `apps/web/features/conversations/conversation-reader.tsx`（选区+`create-bookmark`） |
| 移动简化创建 | `apps/web/components/mobile-reader-sheet.tsx` |
| 后端 | `apps/api/app/api/routes/annotations.py`, `services/annotations.py`, `models/annotation.py`, `schemas/annotation.py` |
| 颜色/highlight CSS | `apps/web/app/globals.css` |
