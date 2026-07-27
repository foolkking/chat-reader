# 分享与导出规划 SHARE_AND_EXPORT_PLAN

**创建日期：** 2026-07-27
**依据：** DECISION_LOG D-013(Share 隐私), D-016, D-023, D-024
**核心文件：** `apps/web/features/sharing/`（share-panel/share-button/share-readonly-reader）、`apps/web/features/exporting/`（export-panel/export-button）、`apps/web/lib/bulk-export.ts`、后端 `apps/api/app/api/routes/shares.py` + `services/sharing/share_service.py`、`routes/exports.py` + `archive_exports.py` + `services/exporting/`（cr_archive/export_service）、模型 `models/share.py` + `export_artifact.py`。

---

## 1. 概念区分
| | Share | Export |
|---|-------|--------|
| 目的 | 生成受限只读链接给访客 | 生成文件备份/迁移 |
| 输出 | token URL | Markdown / JSON / .cr 文件 |
| 隐私 | scope + include flags | include flags |
| 撤销 | 可撤销/延期/重生 | 一次性文件 |

---

## 2. Share
### 2.1 创建/管理（`share-panel.tsx`）
- scope：full / selected。
- 有效期、主题/语言、复制链接、延期、重生、撤销（保留）。
- include flags：description / annotations / notebook **默认关闭**（隐私）。
- allow_export：控制访客能否导出。

### 2.2 内容预览
- 创建前预览分享范围与包含的私有内容（明确提示哪些会被访客看到）。

### 2.3 访客页（`/share/[token]`, `share-readonly-reader.tsx`）
- 只读 Reader，token 限制内容 + TOC + 局部阅读位置（`chat-reader:share-position:<hash>`）。
- 可选导出（若 allow_export）。
- 品牌与隐私提示：明确这是只读分享。
- 访客导航简化（无 canonical 管理）。

### 2.4 token 规则（D-024 可改）
- 可改 token 规则；旧链接不保证有效（破坏性变更需知悉）。
- 后端：token hash/prefix/expiry/revoke/scope/options（`share_service.py`）。

---

## 3. Export
### 3.1 格式（D-023 仅三种）
- Markdown / Canonical JSON / `.cr`（**不加 HTML/PDF**）。

### 3.2 范围与选项
- selected / full；metadata / toc / versions / private（description/annotations/notebook）flags，私有默认关闭。

### 3.3 任务与反馈
- 直接导出或后台 archive job（`background_jobs` + `export_artifacts`）。
- 进度、成功、失败、重试；下载记录。
- `.cr` 可自由升级版本（D-024，无需兼容旧 v1/v2）。

### 3.4 下载
- `GET /api/exports/{artifact_id}/download`（保留）。

---

## 4. 移动端（D-016）
- Share：基础创建（生成链接，基础选项）。
- Export：Markdown / .cr 基础导出，不支持复杂配置。

---

## 5. 状态设计
| 状态 | 表现 |
|------|------|
| Share 列表 | 状态徽标（有效/过期/撤销） |
| 过期/撤销访问 | 不可读提示页 |
| Export 进行中 | 进度 |
| Export 失败 | 错误 + 重试 |
| 隐私预览 | 明确包含/不包含私有内容 |

---

## 6. 涉及文件
| 变更 | 文件 |
|------|------|
| Share 面板 | `apps/web/features/sharing/share-panel.tsx`, `share-button.tsx` |
| 访客页 | `apps/web/features/sharing/share-readonly-reader.tsx`, `apps/web/app/share/[token]/page.tsx` |
| Export 面板 | `apps/web/features/exporting/export-panel.tsx`, `export-button.tsx`, `lib/bulk-export.ts` |
| 后端 Share | `apps/api/app/api/routes/shares.py`, `services/sharing/share_service.py`, `models/share.py`, `schemas/share.py` |
| 后端 Export | `apps/api/app/api/routes/exports.py`, `archive_exports.py`, `services/exporting/export_service.py`, `cr_archive.py`, `models/export_artifact.py`, `schemas/export.py` |
