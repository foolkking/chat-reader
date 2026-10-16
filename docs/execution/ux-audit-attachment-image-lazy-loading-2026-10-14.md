# UX 审查与修复前证据：多图片附件缩略图未按需读取

日期：2026-10-14

## 范围与证据

本次审查覆盖统一附件查看器的多图片“全部图片”视图和底部缩略图栏。
证据来自当前源码；没有启动服务、登录、浏览器、测试或构建，因此没有
真实网络瀑布、解码耗时或设备内存采样。

已查看：

- `apps/web/features/attachments/attachment-viewer.tsx`
- `apps/web/lib/offline-db.ts`

## 发现

### PERF-ATTACHMENT-01 · 多图片查看会同时读取全部图片资源

| | |
|---|---|
| **Dimension** | Efficiency / Media preview |
| **Severity** | High |
| **Confidence** | Observed (code); resource pressure Inferred |
| **Effort** | S |
| **Location** | `apps/web/features/attachments/attachment-viewer.tsx:356–383` |

**Evidence.** 图片总览为每个 `session.items` 挂载 `ViewerOverviewImage`；
每个组件都立即调用 `useViewerAttachment`，因此会为所有图片启动附件读取。
底部 `ViewerThumbnail` 同样为每一项立即调用附件读取。离线附件读取可能
创建本地 Blob URL，在线则可能同时发起多个附件请求；之后只有当前可见或
用户即将查看的少量图片真正需要解码。

**Why it matters.** 一个包含许多大图的对话中，用户只是打开总览或当前图片，
却会触发整组下载／读取、Blob 保留和缩略图解码，造成网络突发、内存峰值和
移动设备卡顿；这与附件查看应按需使用资源的目标相反。

**Recommendation.** 总览使用 `IntersectionObserver`，只加载视口附近的图片；
底部缩略图只读取当前项，其他项保留编号占位，用户选择后再加载对应图片。
保留现有查询缓存、失败重试、离线资源释放和图片导航语义，不引入新的图片
处理库或常驻 worker。

## 修复契约

- 视口附近总览图片继续显示真实缩略图，尚未接近视口的项目不发起附件读取。
- 底部非当前缩略图不预取内容；点击后仍走原有附件查询和失败重试。
- 不改变在线／离线权限、Blob URL 释放、附件导航、图片缩放和原图下载。
- 本报告在源码编辑前写入；本批不启动服务，不登录，不运行测试／构建，不提交、
  不触发 CI，也不部署，运行时效果由用户后续验证。

## 已实施的源码修复

图片总览现在通过 `IntersectionObserver` 只为视口附近项目启用原有附件查询；
尚未接近视口的项目仅显示轻量编号占位。底部缩略图栏只为当前项启用查询，其他
项目保留编号或已有缓存内容，用户选中后再按原路径读取。在线／离线查询缓存、
失败重试、Blob URL 释放、导航、缩放和下载权限均未改变，也没有新增图像库或
常驻 worker。

本批仅做源码与文档修复，未启动服务、登录、运行测试／构建／静态验证，未提交、
未触发 CI，也未部署；运行时效果由用户后续验证。
