# 事实基线对齐记录 FACT_BASELINE_RECONCILIATION

**核验日期：** 2026-07-27
**核验 commit：** e752e9ddf25595c3f373977a1803956354ca71b0
**核验范围：** PostgreSQL 表数量、migration head、后端 routes 路径、CSS 设计 token 体系、前端组件路径

---

## 修正项

### FB-001 后端 Routes 路径
| 字段 | 内容 |
|------|------|
| 原文档 | `apps/api/app/routes/` 或 `routes/` |
| 实际代码事实 | `apps/api/app/api/routes/`（内含 16 个路由模块 + `__init__`） |
| 核验方法 | `ls apps/api/app/api/routes/` 确认文件存在；`apps/api/app/routes/` 不存在 |
| 证据路径 | `apps/api/app/api/routes/*.py` |
| 最终修正 | 所有涉及后端路由路径的文档统一使用 `apps/api/app/api/routes/` |
| 影响的规划文档 | `TECHNICAL_CHANGE_PLAN.md`（已正确）、`BACKEND_AND_API.md`（需修正） |
| 是否影响产品方案 | 否 |
| 是否影响执行顺序 | 否 |

### FB-002 PostgreSQL 业务表数量
| 字段 | 内容 |
|------|------|
| 原文档 | `DATA_AND_STORAGE.md` 写"21 张业务表"，列表仅 19 行 |
| 实际代码事实 | 通过 `grep __tablename__ apps/api/app/models/*.py` 确认：**22 个 `__tablename__` 声明 = 22 张业务表**。加上 Alembic 自动创建的 `alembic_version` 表，数据库共 23 张。 |
| 统计口径差异 | 原 21 的统计漏计了 `annotation_sync_receipts`（见 `models/annotation.py` L81）和 `conversation_events`（`models/conversation_event.py`）。原文档表列表仅 19 行（比 21 少 2）也是因为缺少这两个表。 |
| 模型文件对应 | `models/annotation.py` 中 3 个 `__tablename__`（conversation_annotations, conversation_notebooks, annotation_sync_receipts） |
| 证据路径 | `apps/api/app/models/*.py` 中 22 个 `__tablename__` 变量 |
| 最终修正 | 事实文档中写 **22 张业务表** / 数据库共 **23 张表**（含 alembic_version）。若写"表"仅指业务表应加备注。 |
| 影响的规划文档 | `PRODUCT_GOALS_AND_CONSTRAINTS.md`（已写 23 需改为 22 张业务表），`TECHNICAL_CHANGE_PLAN.md` |
| 是否影响产品方案 | 否 |
| 是否影响执行顺序 | 否 |

### FB-003 Migration Head
| 字段 | 内容 |
|------|------|
| 原文档 | `PROJECT_STATE.md` 写 `0013`（已标注过期），其余文档写 `20260724_0015` |
| 实际代码事实 | `alembic/versions/20260724_0015_annotation_types.py`：revision=`20260724_0015`，down_revision=`20260723_0014`。`grep down_revision.*0015` 无结果，确认无后续版本（最新 head）。 |
| 核验方法 | 读取 migration 文件 revision/down_revision；搜索后续引用；`DEPLOYMENT_AND_ENVIRONMENT.md` L48 确认"migration `0015 head`" |
| 证据路径 | `apps/api/alembic/versions/20260724_0015_annotation_types.py` |
| 最终修正 | 所有文档统一为 `20260724_0015 (head)` |
| 影响的规划文档 | 各文档已基本正确（仅 PROJECT_STATE.md 需维持其历史版本标注） |
| 是否影响产品方案 | 否 |
| 是否影响执行顺序 | 否 |

### FB-004 设计 Token 与 Tailwind
| 字段 | 内容 |
|------|------|
| 原文档 | 无明确描述；事实文档未覆盖 |
| 实际代码事实 | 全部设计 token 集中在 `apps/web/app/globals.css` 的 `:root` 和 `[data-theme="dark"]` 块中。`apps/web/tailwind.config.ts` 的 `theme.extend` 为空对象——无自定义 Tailwind token。 |
| 核验方法 | 读取 `globals.css`（53 个 CSS 变量 light + 53 dark），读取 `tailwind.config.ts`（空 extend） |
| 证据路径 | `apps/web/app/globals.css`, `apps/web/tailwind.config.ts` |
| 最终修正 | 在 `FRONTEND_ARCHITECTURE.md` 中补充 CSS 变量体系说明 |
| 影响的规划文档 | `DESIGN_SYSTEM_PLAN.md`（已正确描述此事实） |
| 是否影响产品方案 | 否 |
| 是否影响执行顺序 | 否 |

### FB-005 Reader CSS 布局路径
| 字段 | 内容 |
|------|------|
| 原文档 | 未明确描述 Reader 网格的 CSS 位置 |
| 实际代码事实 | Reader 布局由 `globals.css` 中的 `.reader-frame`（container-type）、`.reader-layout-grid`（grid）、`.reader-content-column`（居中+max-width）、`.reader-toc-column`（right sticky，≥62rem container）、`.reader-index-column`（left sticky，≥1280px）控制 |
| 核验方法 | 读取 `globals.css` L163-270 的 `.reader-*` 规则 |
| 证据路径 | `apps/web/app/globals.css` L163-270 |
| 最终修正 | 在 `FRONTEND_ARCHITECTURE.md` 中补充网格 CSS 位置 |
| 影响的规划文档 | `READER_REDESIGN_PLAN.md`（已正确引用）、`DESIGN_SYSTEM_PLAN.md`（已正确） |
| 是否影响产品方案 | 否 |

---

## 未发生变化的关键事实

- API 67 path templates / 79 operations（本地 OpenAPI 确认）
- 全量截图 21 张（docs/evidence/）
- Alembic 共 15 个版本（`0001`~`0015`）
- 部署结构不变（Docker Compose, Nginx -> Next loopback -> FastAPI）
- 离线 SW scope 保持 `/library`

## 仍无法确认的事实

因环境限制，本轮仍未以下事实做端到端验证，但已知不阻塞执行：
1. 有效 Share token 页面的访客视觉渲染（需合成或测试 token）
2. 真实离线冷启动（PWA）失败注入
3. 生产写操作（导入/编辑/删除/同步）的端到端 UX 反馈

这些已在 `KNOWN_ISSUES_AND_UNCERTAINTIES.md` 中正确标记。

## 文档更新清单

| 文档 | 需要更新 | 内容 |
|------|---------|------|
| `docs/system/DATA_AND_STORAGE.md` | 是 | §PostgreSQL：22 张业务表（非 21），补全 missing 表行 |
| `docs/system/SYSTEM_OVERVIEW.md` | 否 | 不涉及数量统计 |
| `docs/system/BACKEND_AND_API.md` | 是 | routes 目录路径 `apps/api/app/api/routes/` |
| `docs/system/FRONTEND_ARCHITECTURE.md` | 是 | 补设计 token 在 globals.css 的描述、Reader 网格 CSS 位置 |
| `PROJECT_STATE.md` | 否 | 已标注过期+指向 fact baseline，维持历史 |
| 各规划文档 | 见最终文档一致性检查 | 路径确保 `apps/api/app/api/routes/` |
