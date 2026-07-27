# 产品目标与约束 PRODUCT_GOALS_AND_CONSTRAINTS

**创建日期：** 2026-07-27
**依据：** DECISION_LOG D-001~D-005, D-023, D-024

---

## 1. 产品目标

改造完成后，Chat Reader 是一个**气质温暖、阅读舒适、结构清晰的 ChatGPT 导出资料长期阅读与管理工具**。

具体达成：

1. **阅读体验升级**：Reader 采用统一左对齐的文档式排版、舒适宽松的信息密度、渐进式显示的辅助面板，长时间阅读不疲劳。
2. **信息架构清晰**：首页作为资料总览中心，`/recent` 正式进入导航，搜索触手可及（Cmd/Ctrl+K），三条进入 Reader 的路径（列表/搜索/继续阅读）都顺滑。
3. **视觉语言统一**：现代阅读器气质，柔和温暖的圆角阴影，温暖绿主色，全站设计 token 统一。
4. **功能完整保留**：导入、编辑、版本、合并、拆分、批注、精选笔记、Share、Export、离线全部保留并优化。
5. **移动端可用**：桌面优先，移动端聚焦阅读 + 轻量管理（可创建简化批注、分享、导出）。

---

## 2. 产品边界（做什么 / 不做什么）

### 2.1 做什么

| 类别 | 内容 |
|------|------|
| 阅读 | 长对话窗口阅读、双 TOC、精确目标定位、阅读位置恢复、专注模式 |
| 管理 | 对话/Project 组织、归档、排序、置顶、拖动、批量、合并/拆分 |
| 内容编辑 | 消息编辑、不可变版本、恢复、自动清理 |
| 标注 | 批注（highlight/underline/strikethrough/comment/bookmark）、精选笔记 |
| 检索 | 全局搜索、当前对话搜索、离线搜索、最近、继续阅读 |
| 输出 | Share（受限只读）、Export（Markdown/JSON/.cr） |
| 离线 | `/library` PWA、下载/删除、离线阅读、离线批注同步 |

### 2.2 不做什么（D-023 明确不做）

- ❌ 注册 / 登录 / 账号 / 多用户 / 权限 / 团队协作
- ❌ 在线 AI 对话（发送消息、生成、模型选择）
- ❌ 全局批注/笔记中心（独立于 Reader 的知识库）
- ❌ 标签系统、日历/时间线视图
- ❌ 图片/附件**上传**（只渲染导入内容中已有的图片/附件）
- ❌ 音视频播放器
- ❌ HTML / PDF 导出（仅 Markdown / JSON / .cr）
- ❌ 真正的虚拟滚动（保持现有窗口加载机制）
- ❌ 微前端 / 多应用架构、技术栈更换、Reader SSR

---

## 3. 允许改 / 不允许改

| 维度 | 允许 | 不允许 |
|------|------|--------|
| 前端 | UI/UX、组件结构、样式、状态管理局部重构 | 更换 Next.js/React/TanStack Query |
| 后端 | route/service 修改与新增、schema 调整 | 引入 auth 中间件、SSE/WebSocket、AI client |
| 数据库 | 表结构修改、新增表、Alembic migration | — |
| 协议 | `.cr`/offline package/Dexie schema 自由升级 | — |
| 流程 | 优化交互与反馈 | 改导入 preview→commit 两阶段基本流程 |
| 功能 | 优化/重构/补齐/新增（已确认项） | 删除任何现有核心功能 |

---

## 4. 兼容性策略（D-024：不需要向后兼容）

**总原则：怎么方便设计怎么来，优先设计质量，不受旧版本约束。**

| 对象 | 策略 |
|------|------|
| PostgreSQL 数据 | 允许破坏性 migration；如需要可要求重新导入 |
| `.cr` 格式 | 可定义新版本，**无需**读旧 v1/v2 |
| offline package | 可定义新版本，**无需**读旧 v1 |
| Dexie schema | 可升级版本号并重置本地库；要求用户重新下载离线包 |
| Service Worker | 可完全重写，要求用户重新准备离线壳 |
| Share token | 可改 token 规则；已生成的旧链接**不保证**继续有效 |
| localStorage 偏好 | 可改 key 结构 |

**执行约束：** 任何会清除/失效用户本地离线数据或旧 Share 链接的破坏性变更，**必须在 UI 明确提示**（例如离线库首次进入时提示"数据格式已更新，请重新下载"）。这是体验要求，不是兼容要求。

---

## 5. 必须保持的语义（即使不向后兼容，产品语义不变）

即便数据格式可以自由升级，以下**产品语义**在改造后必须保持一致：

1. **导入两阶段**：preview 不落 canonical，显式 commit 才写入。
2. **版本不可变**：MessageVersion 一旦创建不可修改，编辑生成新版本。
3. **精确目标定位**：quote/prefix/suffix → offset → block → message 的回退链。
4. **阅读位置恢复**：刷新按 URL 目标或保存位置恢复。
5. **批注锚点降级**：active / relocated / stale 三态与降级提示。
6. **Share 隐私默认关闭**：description / annotations / notebook 默认不进入 Share 和 Export。
7. **离线只写批注/笔记**：canonical 管理在离线禁用；本地较新阅读位置不被服务器包覆盖。

---

## 6. 关键事实修正（相对旧事实文档）

代码核对发现以下与 `docs/system/` 的差异，本规划以核对结果为准：

| 项 | 事实文档 | 核对结果 |
|----|----------|----------|
| 后端 routes 路径 | `apps/api/app/routes/` | `apps/api/app/api/routes/` |
| 业务表数量 | 21 张 | 23 张（含 annotation_sync_receipts、conversation_events、source_message_refs 等） |
| migration head | 20260724_0015 | 确认 `20260724_0015_annotation_types.py` |
| Tailwind 主题 | — | `tailwind.config.ts` 为空 extend，设计 token 全在 `app/globals.css` CSS 变量 |
