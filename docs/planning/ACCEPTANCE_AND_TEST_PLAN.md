# 验收与测试计划 ACCEPTANCE_AND_TEST_PLAN

**创建日期：** 2026-07-27
**原则：** 每项验收可测，不写"体验更好"。

---

## 1. 页面级验收标准

| 编号 | 页面/模块 | 验收标准（可测） |
|------|-----------|------------------|
| A-01 | 首页 | 左侧栏含"最近"入口且点击进入 `/recent`；项目树与未归类对话在同一层同时可见且可互相拖放；列表项显示时间；空态显示导入引导；Cmd/Ctrl+K 聚焦搜索 |
| A-02 | 归档 | 归档对话/Project 可恢复/删除；空态正确 |
| A-03 | 最近 | 显示最近 Conversation/Project/Message，点击恢复到保存的 message/block/offset |
| A-04 | 搜索 | 关键词返回结果含上下文与高亮；点击结果进入 Reader 并定位到 block/offset；返回保留查询；无结果空态 |
| A-05 | Project 详情 | 列表/批量/拖动排序正常 |
| A-06 | Reader 布局 | 桌面显示左侧导航栏 + 对话 TOC(rail) + 正文 + 章节 TOC；三者独立可辨 |
| A-07 | Reader 正文 | 所有消息左对齐；user/assistant 通过头像/标签/背景区分；消息间距 32px |
| A-08 | 专注模式 | 切换后隐藏两个 TOC 与顶栏辅助；再切换恢复；状态持久化 |
| A-09 | 双 TOC | 对话 TOC 跳到第 N 条；章节 TOC 跳到 heading；命名区分 |
| A-10 | 顶栏分级 | 一级动作(搜索/导航/批注/分享)可见；其余在更多菜单；选中消息显示合并/拆分 |
| A-11 | 批注浮窗 | 首开为浮窗，可拖动/调整/记忆位置 |
| A-12 | 批注固定 | 固定到左侧后完全覆盖 Project 树/对话列表；有返回入口；可拆回浮窗；不影响任何 TOC |
| A-13 | Share | 创建 full/selected；private flags 默认关；预览显示包含内容；访客页只读 |
| A-14 | Export | 导出 MD/JSON/.cr；private 默认关；进度/失败/重试 |
| A-15 | Library | 情景引导入口存在；下载/删除/空间；格式升级提示 |
| A-16 | Offline 页 | 重试可用 |
| A-17 | 移动首页 | 有最近时显示继续阅读卡（进度条）；无则不显示；下方标签列表 |
| A-18 | 移动 Reader | 顶栏=返回+标题+导航+更多；更多菜单含其余动作 |
| A-19 | 移动批注 | 可创建 highlight/underline/comment；笔记只读；批量提示桌面 |

---

## 2. 功能语义回归（必须不破坏）
| 编号 | 验收 |
|------|------|
| S-01 | 导入 preview 不落 canonical，commit 后可打开 |
| S-02 | 编辑生成新版本，旧版本可恢复（不可变） |
| S-03 | 目标定位 quote→offset→block→message 回退有效 |
| S-04 | 刷新按 URL/保存位置恢复阅读位置 |
| S-05 | 批注 stale 降级到 block/message |
| S-06 | Share private 内容默认不出现在访客/导出 |
| S-07 | 离线只写批注/笔记；canonical 管理离线禁用 |
| S-08 | 离线本地较新阅读位置不被服务器包覆盖 |

---

## 3. 测试类型

### 3.1 单元测试（前端）
- 消息渲染左对齐/区分逻辑；批注形态切换；专注模式状态；快捷键派发；继续阅读卡显隐。

### 3.2 API 测试（后端）
- search（含批注索引如实现）；recent（进度如实现）；preferences；shares scope/options；exports flags；annotations sync/conflict。

### 3.3 集成测试
- 导入→Reader；搜索→定位；批注创建→同步；Share 创建→访客访问。

### 3.4 Playwright / E2E
- 更新 `apps/web/e2e/library-offline.spec.ts`（SW/Dexie 重写后）。
- 新增：Reader 阅读+双 TOC+批注浮窗/固定；搜索定位；专注模式；移动首页卡片。

### 3.5 视觉/截图检查
- 桌面 1440×900：首页/Reader/搜索/批注浮窗/批注固定/专注模式。
- 移动 390×844：首页卡片/Reader 顶栏/Bottom Sheet/简化批注。

### 3.6 响应式
- 断点：<375 / 390 / 768 / 1280 / 62rem container；横屏；超长标题；正文无横向溢出。

### 3.7 键盘与可访问性
- Tab 焦点顺序；焦点陷阱（对话框/浮窗）；Esc 关闭；Cmd+K；方向键/J/K 阅读；focus ring 可见；对比度 AA；颜色非唯一信息；reduced-motion；aria 标签；屏幕阅读器基本可用。

### 3.8 长对话
- 100+ 消息：完整轮次 reader-turn、稳定 DOM 最多 3 轮、远距离批注、边缘替换、双 TOC、阅读位置刷新恢复和富内容渲染。
- 任一挂载消息必须满足完整 block 数量；可见区不得出现长内容占位或“立即展开”。

### 3.9 离线
- 冷启动从 active shell；离线搜索；离线阅读；批注 outbox 同步；冲突副本；quota/staging failure；格式升级提示。

### 3.10 Share
- 有效/过期/撤销 token；scope 限制；private flags；allow_export。

### 3.11 导入
- 多格式检测/preview/warnings/commit/任务状态/失败重试。

### 3.12 批注同步
- 离线创建→联网同步→receipt；并发冲突→保留副本。

### 3.13 错误/失败态
- 数据失败/无效 ID/网络断开/保存失败/导出失败，均有提示与恢复。

---

## 4. 完成标准（Definition of Done）
- 全部 A-01~A-19、S-01~S-08 通过。
- 3.4 E2E 通过；3.5 桌面+移动截图人工核对。
- 无 console 错误；ESLint 通过；构建成功。
- 破坏性数据变更有 UI 提示（D-024）。
- 无遗留"待定"实现。
