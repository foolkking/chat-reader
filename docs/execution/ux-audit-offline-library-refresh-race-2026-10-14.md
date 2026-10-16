# UX 审查与修复前证据：离线资料库刷新竞态

日期：2026-10-14

## 范围与证据

本次审查覆盖 `/library` 的初次加载、离线下载完成后的刷新、自动更新、
删除本地副本和搜索索引重试。证据来自当前源码；没有启动服务、浏览器、
测试或构建，因此没有真实 IndexedDB 时序或 Worker 性能采样。

已查看：

- `apps/web/features/offline/library-shell.tsx`
- `apps/web/lib/offline-search.ts`

## 发现

### PERF-OFFLINE-03 · 多个本地刷新可以并发重建搜索索引并写回旧快照

| | |
|---|---|
| **Dimension** | Efficiency / Consistency |
| **Severity** | Medium |
| **Confidence** | Observed (code); stale UI and duplicate work Inferred |
| **Effort** | M |
| **Location** | `apps/web/features/offline/library-shell.tsx:107–196, 245–315, 405–409` |

**Evidence.** `reloadLocal` 同时负责读取 conversations/messages、批注、笔记和
搜索文档，调用 `initializeOfflineSearch`，再写回列表、索引版本和 storage
estimate。它被首次 effect、下载完成订阅、自动更新、删除完成和搜索重试直接
调用，但没有请求代次或串行队列。`initializeOfflineSearch` 使用同一个模块级
Worker；并发刷新取得的 IndexedDB 快照不保证按新旧顺序完成。

**Why it matters.** 连续完成多个下载、在写入结束时点击搜索重试，或删除与自动
更新相近发生时，页面会重复读取整库并重复初始化 Worker。较早快照可能在较新快照
之后设置列表或索引状态，造成短暂旧内容、搜索结果跳回或无谓的内存/CPU 峰值。

## 修复契约

- 刷新任务按顺序进入同一个本地队列，搜索 Worker 的初始化不并发。
- 排队期间只保留最新请求；已经开始的请求完成后，最新请求仍会再次读取当前
  IndexedDB 并成为最终可见索引。
- 旧请求不能写回 conversations、search 状态或 storage estimate。
- 不改变离线包 v1/v2/v3 读取、删除保护、下载状态、选择、搜索内容和 Worker
 运行时合同。
- 本报告在源码编辑前写入；本批不启动服务，不运行浏览器、测试／构建，不提交、
  不触发 CI，也不部署，运行时效果由用户后续验证。

## 已实施的源码修复

`reloadLocal` 现在通过组件内队列串行执行，并为每次调用分配递增代次。
排队期间已被更新请求取代的任务会跳过整套读取；已经开始的任务不会向已卸载
页面写状态，且在关键异步边界检查自己是否仍是最新任务。搜索 Worker 初始化、
conversation 列表、搜索失败/版本和 storage estimate 只由当前代次提交。
下载完成、自动更新、删除和显式搜索重试入口保持不变，离线包格式及选择语义
未改变。

本批仅做源码与文档修复，未启动服务、运行浏览器、测试／构建／静态验证，未提交、
未触发 CI，也未部署；运行时效果由用户后续验证。
