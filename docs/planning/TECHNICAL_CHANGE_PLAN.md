# 技术变更计划 TECHNICAL_CHANGE_PLAN

**创建日期：** 2026-07-27
**依据：** DECISION_LOG D-002, D-024；代码路径核对结果

---

## 1. 前端组件变更

### 1.1 保留（视觉/局部改）
`app-shell.tsx`, `query-provider.tsx`, `interaction-dialog-provider.tsx`, `service-worker-registration.tsx`, `resizable-pane.tsx`, `reader-sidebar-frame.tsx`, `responsive-reader-frame.tsx`, `sort-menu.tsx`, `selection-toolbar.tsx`, `markdown-renderer.tsx`, `block-renderer.tsx`, 渲染 heavy blocks 相关。

### 1.2 重构
| 组件 | 重构内容 |
|------|----------|
| `features/conversations/conversation-reader.tsx` | 渐进式模式、专注模式、批注浮窗/固定协调、顶栏分级 |
| `features/conversations/message-item.tsx` + `assistant-message-renderer.tsx` | 统一左对齐、消息头/背景区分 |
| `features/toc/conversation-index.tsx` | 对话 TOC 视觉/命名 |
| `features/toc/conversation-toc.tsx` | 章节 TOC 树状视觉 |
| `features/annotations/annotation-workspace.tsx` | 混合形态（浮窗/固定左栏/拆离） |
| `features/projects/project-sidebar.tsx` | 最近入口、批注固定覆盖、导航结构 |
| `components/reader-header-action-rail.tsx` | 分级动作 |
| `components/mobile-reader-sheet.tsx` | 移动顶栏/更多菜单/简化批注 |

### 1.3 新增
| 组件/文件 | 用途 |
|-----------|------|
| 专注模式控制（可在 reader 内或独立 hook） | D-011 |
| 继续阅读卡片组件（移动首页） | D-018，可在 `recent-items.tsx` 扩展 |
| 一次性离线引导提示卡 | D-005 |
| 状态组件（Empty/Error/Offline/Conflict/Skeleton 统一） | DESIGN_SYSTEM §6.7 |

### 1.4 hooks / 状态
- `shortcut-manager.tsx`：新增 Cmd/Ctrl+K → `chat-reader:focus-global-search`。
- localStorage：新增专注模式态、批注固定偏好；沿用现有 key 体系。

---

## 2. 后端变更（`apps/api/app/api/routes/` + `services/`）

### 2.1 路由（多数保留，按需扩展）
保留全部现有 route：`health/conversations/messages/projects/search/imports/tasks/shares/annotations/offline/preferences/exports/archive_exports/reading/toc`。

按规划可能扩展：
| 变更 | 文件 | 说明 |
|------|------|------|
| 搜索索引含批注 | `routes/search.py` + `services/search/search_indexer.py` | D-010，批注 comment/notebook 进 search_documents 或独立索引 |
| recent 字段（进度） | `routes/reading.py` + `services/reading/reading_service.py` | 如首页/卡片需进度百分比 |
| preferences 新字段 | `routes/preferences.py` + `services/preferences.py` | 专注模式/批注固定偏好（也可纯前端 localStorage，优先前端） |

### 2.2 service
`import_pipeline/*`, `canonical/*`, `editing/*`, `exporting/*`, `sharing/*`, `toc/*`, `search/*`, `reading/*`, `offline_packages.py`, `annotations.py`, `background_jobs.py`, `task_worker.py` — 逻辑保留；仅搜索索引/偏好按上表微调。

---

## 3. 数据库（`apps/api/app/models/` + `alembic/versions/`）

- **当前 head：** `20260724_0015_annotation_types.py`（23 张表）。
- **原则（D-024）：** 允许破坏性 migration。
- **可能的新 migration（`20260727_0016_*`）：**
  | 变更 | 影响表 |
  |------|--------|
  | 搜索索引含批注（如需列/索引） | `search_documents` 或新 index |
  | recent 进度（如需） | `recent_items` / `reading_positions` |
  | preferences 新字段（如落库） | `user_preferences` |
- **若纯前端偏好，可能 0 migration。** 实际是否需要 migration 在执行时按最终实现确定；本规划标注为"条件性"。

---

## 4. Dexie / 离线（D-024 自由升级）
- `lib/offline-db.ts`：可 bump schema version；stores 不变或按需扩展（批注固定态本地化不入 Dexie，用 localStorage）。
- 破坏性升级需 UI 提示重新下载（OFFLINE_AND_PWA_PLAN §7）。

## 5. Service Worker（D-024 可重写）
- `public/library-sw.js` / `sw.js`：可重写 staging/缓存策略；保持 `/library` scope 隔离语义。
- `library/manifest.webmanifest`：`start_url`/`scope` 保持 `/library`。

## 6. `.cr` / offline package（D-024）
- `services/exporting/cr_archive.py`：可定义新 `.cr` 版本，无需读旧。
- `services/offline_packages.py`：可升级包格式。

## 7. Share token（D-024）
- `services/sharing/share_service.py`：可改 token 规则；旧链接不保证有效。

## 8. 样式
- `app/globals.css`：token 改/新增 + Reader 布局网格 + 组件工具类。
- `tailwind.config.ts`：保持空 extend（继续 CSS 变量体系），不迁移 token 到 Tailwind theme。

## 9. 测试影响
- 现有 `apps/web/e2e/library-offline.spec.ts`：SW/离线重写后需更新。
- 后端 44+ 导入/编辑测试：逻辑保留则多数不受影响；索引/偏好变更需补测试。
- 新增测试见 ACCEPTANCE_AND_TEST_PLAN。

## 10. 回退策略
- 前端/样式：git 回退。
- DB migration：提供 downgrade；破坏性变更前 dump 备份。
- SW/Dexie：版本回退 + 用户重新准备。

## 11. 影响范围标记（供最终总计划）
| 层 | 是否涉及 |
|----|---------|
| 前端 | 是（大量） |
| 后端 | 是（少量，搜索索引/偏好条件性） |
| API | 条件性（可能扩展字段，不破坏现有） |
| 数据库 | 条件性（0-1 个新 migration） |
| Alembic | 条件性 |
| Dexie | 是（版本 bump） |
| Service Worker | 是（可重写） |
| `.cr` | 条件性（可升级） |
| offline package | 条件性（可升级） |
| Share | 条件性（token 规则可改） |
| 生产部署 | 是（前端重建 + 可能 migration + SW 更新） |
