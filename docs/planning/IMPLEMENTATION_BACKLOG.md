# 实施清单 IMPLEMENTATION_BACKLOG

**创建日期：** 2026-07-27
**说明：** 文件级实施清单。路径均已核对存在（除标注"新建"）。第二轮一次性完成全部（D-025），下列顺序为内部依赖顺序，非分期。

---

## 阶段 0：设计 token（基础，先做）
| # | 动作 | 文件 |
|---|------|------|
| 0.1 | 改/新增 CSS 变量（accent #10a37f、暖中性、三级阴影、圆角、间距语义） | `apps/web/app/globals.css` |
| 0.2 | Reader 布局网格调整（消息间距、专注模式 `data-focus-mode`、章节/对话 TOC 视觉） | `apps/web/app/globals.css` |
| 0.3 | 保持 tailwind 空 extend | `apps/web/tailwind.config.ts`（不改或仅注释） |

## 阶段 1：全局壳与导航
| # | 动作 | 文件 |
|---|------|------|
| 1.1 | 左侧导航栏：最近入口、搜索(Cmd+K)、对话/项目标签、行内菜单、视觉 | `apps/web/features/projects/project-sidebar.tsx` |
| 1.2 | 应用壳视觉 | `apps/web/components/app-shell.tsx` |
| 1.3 | Cmd/Ctrl+K 快捷键 | `apps/web/components/shortcut-manager.tsx` |
| 1.4 | 搜索入口聚焦 | `apps/web/features/search/sidebar-search.tsx`, `search-box.tsx` |
| 1.5 | 偏好面板（主题/语言/宽度 + 离线库入口 + 新偏好） | `apps/web/components/preferences-panel.tsx`, `preferences-provider.tsx` |

## 阶段 2：首页与列表页
| # | 动作 | 文件 |
|---|------|------|
| 2.1 | 首页列表（进度/时间/摘要） | `apps/web/app/page.tsx`, `features/conversations/conversation-list.tsx` |
| 2.2 | 归档页 | `apps/web/app/archived/page.tsx`, `features/projects/archived-project-list.tsx` |
| 2.3 | 最近页正式化 | `apps/web/app/recent/page.tsx`, `features/reading/recent-items.tsx` |
| 2.4 | 搜索页结果优化 | `apps/web/app/search/page.tsx`, `features/search/search-page.tsx`, `search-results.tsx` |
| 2.5 | Project 详情 | `apps/web/app/projects/[projectId]/page.tsx`, `features/projects/project-conversation-list.tsx` |
| 2.6 | 选择工具/排序 | `apps/web/components/selection-toolbar.tsx`, `sort-menu.tsx` |

## 阶段 3：Reader 核心（最高优先）
| # | 动作 | 文件 |
|---|------|------|
| 3.1 | Reader 主体：渐进式模式/专注模式/顶栏分级/批注协调 | `apps/web/features/conversations/conversation-reader.tsx` |
| 3.2 | 统一左对齐消息 | `message-item.tsx`, `assistant-message-renderer.tsx` |
| 3.3 | 对话 TOC 视觉/命名 | `apps/web/features/toc/conversation-index.tsx` |
| 3.4 | 章节 TOC 树状视觉 | `apps/web/features/toc/conversation-toc.tsx` |
| 3.5 | 顶栏动作分级 | `apps/web/components/reader-header-action-rail.tsx` |
| 3.6 | 布局框架 | `apps/web/components/responsive-reader-frame.tsx`, `reader-sidebar-frame.tsx` |
| 3.7 | 导航逻辑（保持语义） | `reader-navigation.ts`, `reader-window.ts`, `neighborhood-expansion.ts` |
| 3.8 | 消息菜单 | `features/conversations/conversation-action-menu.tsx` |

## 阶段 4：批注/编辑/工具面板
| # | 动作 | 文件 |
|---|------|------|
| 4.1 | 批注工作区混合形态（浮窗/固定左栏/拆离/管理） | `apps/web/features/annotations/annotation-workspace.tsx` |
| 4.2 | 批注仓库/同步 | `apps/web/lib/annotation-repository.ts`, `lib/offline-db.ts`, `components/offline-sync-manager.tsx` |
| 4.3 | 编辑/版本 | `features/editing/edit-message-form.tsx`, `version-history-panel.tsx`, `version-history-button.tsx`, `restore-version-button.tsx` |
| 4.4 | Share 面板/访客页 | `features/sharing/share-panel.tsx`, `share-button.tsx`, `share-readonly-reader.tsx`, `app/share/[token]/page.tsx` |
| 4.5 | Export 面板 | `features/exporting/export-panel.tsx`, `export-button.tsx`, `lib/bulk-export.ts` |
| 4.6 | 导入对话框/任务 | `components/import-dialog-provider.tsx`, `features/import/import-panel.tsx`, `import-preview-card.tsx`, `import-task-monitor.tsx` |
| 4.7 | 当前对话搜索 | `features/search/conversation-search-panel.tsx` |

## 阶段 5：移动端
| # | 动作 | 文件 |
|---|------|------|
| 5.1 | 移动首页继续阅读卡 | `apps/web/app/page.tsx`, `features/reading/recent-items.tsx` |
| 5.2 | 移动 Reader sheet/顶栏 | `apps/web/components/mobile-reader-sheet.tsx`, `features/conversations/use-mobile-header-auto-hide.ts` |
| 5.3 | 移动简化批注创建 | `annotation-workspace.tsx`, `conversation-reader.tsx` |
| 5.4 | 移动侧栏 | `features/projects/project-sidebar.tsx` |

## 阶段 6：离线/PWA
| # | 动作 | 文件 |
|---|------|------|
| 6.1 | Library 壳视觉 + 升级提示 | `apps/web/features/offline/library-shell.tsx`, `app/library/page.tsx`, `layout.tsx` |
| 6.2 | 离线 DB/壳/搜索（版本 bump） | `lib/offline-db.ts`, `offline-shell.ts`, `offline-search.ts`, `offline-search.worker.ts` |
| 6.3 | SW/manifest（可重写） | `public/library-sw.js`, `sw.js`, `library/manifest.webmanifest`, `components/service-worker-registration.tsx` |
| 6.4 | 离线情景引导 | `conversation-reader.tsx`, `preferences-panel.tsx` |

## 阶段 7：后端（条件性）
| # | 动作 | 文件 |
|---|------|------|
| 7.1 | 搜索索引含批注（如实现 D-010 在线） | `apps/api/app/api/routes/search.py`, `services/search/search_indexer.py`, `search_service.py` |
| 7.2 | recent 进度字段（如需） | `routes/reading.py`, `services/reading/reading_service.py`, `schemas/reading.py` |
| 7.3 | preferences 新字段（如落库，否则纯前端） | `routes/preferences.py`, `services/preferences.py`, `models/user_preference.py`, `schemas/preferences.py` |
| 7.4 | 新 migration（如 7.1-7.3 触及 DB） | `apps/api/alembic/versions/20260727_0016_*.py`（新建） |
| 7.5 | `.cr`/offline package/share token 升级（如实现） | `services/exporting/cr_archive.py`, `services/offline_packages.py`, `services/sharing/share_service.py` |

## 阶段 8：状态/可访问性/收尾
| # | 动作 | 文件 |
|---|------|------|
| 8.1 | 统一状态组件（empty/error/offline/conflict/skeleton） | 各组件 + `globals.css` |
| 8.2 | 可访问性（focus/aria/键盘/reduced-motion） | 全局 |
| 8.3 | i18n 文案 | `apps/web/lib/i18n.ts` |
| 8.4 | 测试更新 | `apps/web/e2e/library-offline.spec.ts` + 新测试 |

---

## 新建文件清单（预期）
- `apps/api/alembic/versions/20260727_0016_*.py`（若触及 DB）
- 可能的状态组件文件（如 `components/states/*` — 执行时按拆分决定）
- 继续阅读卡片可在 `recent-items.tsx` 内实现，不必新文件

**约束：** 除上述，不新建业务模块；不删除现有文件（除非组件合并且功能不丢）。
