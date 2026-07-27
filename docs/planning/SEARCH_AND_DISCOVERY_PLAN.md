# 搜索与内容发现规划 SEARCH_AND_DISCOVERY_PLAN

**创建日期：** 2026-07-27
**依据：** DECISION_LOG D-008, D-009, D-010
**核心文件：** `apps/web/features/search/`（search-page/search-box/sidebar-search/search-results/conversation-search-panel）、`apps/web/app/search/page.tsx`、`apps/web/features/reading/recent-items.tsx`、`apps/web/lib/offline-search.ts` + `offline-search.worker.ts`、后端 `apps/api/app/api/routes/search.py` + `services/search/`。

---

## 1. 搜索入口（D-008）
- **侧栏搜索框**：保留（`sidebar-search.tsx`）。
- **全局快捷键 Cmd/Ctrl+K**：新增，`shortcut-manager.tsx` 派发 `chat-reader:focus-global-search`，`search-box.tsx`/`sidebar-search.tsx` 监听聚焦。
- **Reader 当前对话搜索**：保留（`conversation-search-panel.tsx`，`chat-reader:open-reader-search`）。
- 不提升为一级导航；保持简洁。

---

## 2. 全局搜索（`/search`）
- **筛选：** 关键词 q、状态 status、文档类型、角色 role、Project、日期（现有）。
- **结果呈现优化：**
  - 分组：按对话或类型分组。
  - 每项：标题 + 匹配上下文片段 + Project/角色标识 + 关键词高亮。
  - 排序：相关度/时间。
- **点击定位：** 带 `conversation/message/block/offset` 进入 Reader 精确定位（D-009 路径 2）。
- **返回：** 从 Reader 返回搜索结果保留查询与滚动。
- **状态：** 无结果空态（现 PAGE-006）、加载 skeleton、错误重试。
- **后端：** `GET /api/search`（tsvector/trigram + fallback），`POST /api/search/reindex` 保留。

---

## 3. 当前对话搜索（Reader 内）
- 限定当前 conversation，结果进入统一目标导航。
- 面板呈现匹配上下文 + 高亮。

---

## 4. 离线搜索（`/library`）
- Web Worker FlexSearch（`offline-search.worker.ts`）检索已下载 searchDocuments（标题/正文/章节/代码/description/批注/笔记）。
- 范围提示：仅已下载资料。
- 与在线搜索 UI 一致，标注"离线范围"。

---

## 5. 搜索含批注内容（D-010）
- 搜索索引范围包含批注 comment 与精选笔记内容（离线已含）。
- 在线 `search_documents` 若未含批注，需扩展索引（见 TECHNICAL_CHANGE_PLAN）。

---

## 6. 最近与继续阅读（D-009 路径 3）
- **`/recent`**：分组展示最近 Conversation/Project/Message，显示进度、时间，点击恢复位置。
- **继续阅读：** 桌面通过"最近"入口；移动端首屏卡片（D-018）。
- **数据：** `/api/recent-items`（`routes/reading.py`，`recent_items` 表）+ 阅读位置。

---

## 7. 发现机制关系
- 不合并"最近/搜索/继续阅读"为单一机制，保持各自入口（D-007/D-008/D-009）。
- 三者衔接顺滑，均可进入 Reader 并恢复/定位。

---

## 8. 状态设计
| 状态 | 表现 |
|------|------|
| 无结果 | 空态 + 建议（换关键词/清筛选） |
| 加载 | skeleton |
| 错误 | 重试 |
| 离线 | 标注离线范围 |
| 定位失败 | 回退 block/message + 提示 |

---

## 9. 涉及文件
| 变更 | 文件 |
|------|------|
| 搜索页/结果 | `apps/web/features/search/search-page.tsx`, `search-results.tsx` |
| 搜索入口 | `sidebar-search.tsx`, `search-box.tsx`, `components/shortcut-manager.tsx` |
| 当前对话搜索 | `conversation-search-panel.tsx` |
| 离线搜索 | `apps/web/lib/offline-search.ts`, `offline-search.worker.ts` |
| 最近 | `apps/web/app/recent/page.tsx`, `features/reading/recent-items.tsx` |
| 后端搜索 | `apps/api/app/api/routes/search.py`, `services/search/search_service.py`, `search_indexer.py` |
