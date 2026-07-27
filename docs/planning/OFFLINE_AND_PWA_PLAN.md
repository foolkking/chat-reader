# 离线与 PWA 规划 OFFLINE_AND_PWA_PLAN

**创建日期：** 2026-07-27
**依据：** DECISION_LOG D-005, D-016, D-024
**核心文件：** `apps/web/features/offline/library-shell.tsx`、`apps/web/app/library/page.tsx` + `layout.tsx`、`apps/web/lib/offline-db.ts` + `offline-shell.ts` + `offline-search.ts` + `offline-search.worker.ts`、`apps/web/public/library-sw.js` + `sw.js` + `library/manifest.webmanifest`、`components/service-worker-registration.tsx`、后端 `apps/api/app/api/routes/offline.py` + `services/offline_packages.py` + `models/offline_package_artifact.py`。

---

## 1. `/library` 地位（D-005 情景化引导）
- 不入主导航。
- 情景引导入口：Reader"更多"菜单、一次性提示卡、设置面板。
- SW scope 提示：`/library` 独立 scope，不误导为全站离线。

---

## 2. 壳准备与 PWA
- Manifest `start_url`/`scope` = `/library`。
- `library-sw.js`：拦截 library navigation + 允许的静态壳资源；`/`、管理页、API 不 fallback。
- staging cache 完整校验后原子激活；失败保留旧 revision。
- `sw.js`：注销旧 root-scope worker + 清理 legacy cache。
- 首次必须成功联网准备一次。

---

## 3. Catalog / 下载 / 删除
- catalog：conversation/project/all，revision、可下载对象、估算（`GET /api/offline/catalog`）。
- 下载：scope 选择 → 后台生成包 → 下载 → Dexie 事务导入（`POST /api/offline/packages` + `/download`）。
- 删除本地副本：不删服务器数据。
- 更新：检测 revision 变化。

---

## 4. 本地存储与空间
- StorageManager persist/estimate、占用、警告、重试。
- quota / 持久化许可 / staging failure 状态。
- 浏览器清站点数据风险提示。

---

## 5. 离线 Reader 与互跳
- 离线 Reader 复用 `ReaderDataSource`（offline 读 Dexie）。
- 在线→离线：传 conversation/message/block/offset。
- 离线→在线：联网返回 `/conversations/[id]` 同定位。
- 本地阅读位置较新时不被服务器包覆盖。

---

## 6. 离线批注同步
- 写 outbox → 联网 `POST /api/annotations/sync` → receipt/冲突副本。
- 见 ANNOTATION_AND_NOTES_PLAN §6。

---

## 7. 数据格式升级（D-024 不兼容）
- Dexie schema / offline package 可自由升级版本。
- **破坏性变更 UI 提示：** 首次进入 `/library` 检测版本不符时，提示"离线数据格式已更新，请重新下载"，并清理旧库。
- Service Worker 可完全重写，要求重新准备壳。

---

## 8. Dexie stores（现有）
conversations/messages/blocks/headings/searchDocuments/annotations/notebooks/readingPositions/packages/outbox/settings（`offline-db.ts`）。升级时统一 bump 版本。

---

## 9. 状态设计
| 状态 | 表现 |
|------|------|
| unsupported | 浏览器不支持提示 |
| preparing | 壳准备进度 |
| ready | 就绪 |
| error / staging failure | 错误 + 重试，保留旧壳 |
| quota 不足 | 空间警告 + 清理建议 |
| 未下载 | 引导下载 |
| 版本升级 | 重新下载提示（D-024） |
| 离线冷启动 | 从 active shell 启动 |

---

## 10. 涉及文件
| 变更 | 文件 |
|------|------|
| Library 壳 | `apps/web/features/offline/library-shell.tsx`, `app/library/page.tsx`, `layout.tsx` |
| 离线 DB/壳/搜索 | `apps/web/lib/offline-db.ts`, `offline-shell.ts`, `offline-search.ts`, `offline-search.worker.ts` |
| SW/manifest | `apps/web/public/library-sw.js`, `sw.js`, `library/manifest.webmanifest`, `components/service-worker-registration.tsx` |
| 情景引导 | `apps/web/features/conversations/conversation-reader.tsx`, `components/preferences-panel.tsx` |
| 后端 | `apps/api/app/api/routes/offline.py`, `services/offline_packages.py`, `models/offline_package_artifact.py`, `schemas/offline.py` |
