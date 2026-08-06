# 第二轮执行决策锁 EXECUTION_LOCK

**封板日期：** 2026-07-27
**事实基线 commit：** e752e9ddf25595c3f373977a1803956354ca71b0
**优先级：** 本文件为最高优先级约束。与其他文档冲突时以本文件为准。

> **最终覆盖（2026-07-28）：** 用户在本锁之后明确批准完整轮次 Reader、单层侧栏和离线 conversation 增量更新。因此 D-007 的互斥标签、旧 Reader lazy window，以及下文 offline package“不改”不再是当前执行约束。数据库、Dexie schema、`.cr` 与 Share token 锁仍有效；离线包写 v2、读 v1/v2。

---

## 1. 文件优先级（冲突时）

1. **EXECUTION_LOCK.md**（本文件）— 最高优先级执行约束
2. **DECISION_LOG.md** — 25 项决策的权威记录
3. **MASTER_REDESIGN_PLAN.md** — 改造总方案
4. **EXECUTION_MANIFEST.md** — 文件级执行清单
5. **专项规划文档**（READER_REDESIGN_PLAN / DESIGN_SYSTEM_PLAN 等）
6. **事实文档**（docs/system/）
7. **旧产品文档**（PROJECT_STATE.md / docs/product.md — 已标注过期的以事实基线为准）

**事实与规划冲突处理：** 以代码和实际可访问的线上页面为准，更新事实文档。

---

## 2. 最终产品定位（D-001, D-023）

Chat Reader 是 **ChatGPT 导出资料的阅读与管理工具**，保持工具型定位：
- 不加注册/登录/账号系统
- 不加在线 AI 对话功能
- 不加多用户/权限/团队协作
- 不加标签/日历/时间线视图
- 不加图片/附件上传（只渲染导入内容中已有的）
- 不加音视频播放器
- 不加 HTML/PDF 导出（保持 Markdown/JSON/.cr）
- 不加全局批注/笔记中心（独立于 Reader）
- 不删除任何现有核心功能（编辑/版本/合并/拆分/Share/Export/离线）

---

## 3. 最终目标用户

- **主角色：** 本地资料拥有者，`local:default` 主体，无登录，使用全部管理能力。
- **次角色：** Share 访客，持有效 token URL，只读，受 scope/options 约束。

---

## 4. 最终信息架构（D-005~D-009）

- 页面树见 INFORMATION_ARCHITECTURE_PLAN §1
- 首页 = 资料总览中心（D-006）
- 导航 = 嵌套层级：对话/项目标签 + 侧栏顶部"最近"快速入口 + 已归档入口（D-007）
- `/recent` 正式加入导航（D-007）
- `/library` 不入主导航，通过情景化引导进入（D-005）
- 搜索保持侧栏入口 + Cmd/Ctrl+K（D-008）
- 三条进入 Reader 的路径均优化（D-009）

---

## 5. 最终首页结构

- 左侧导航栏：导入/搜索(Cmd+K)/最近/归档/对话-项目标签切换/设置
- 主区：活跃对话列表（展示进度/时间/摘要）
- 空态：引导导入第一个对话
- 移动端：首屏继续阅读卡片（1-3 个横向）+ 下方标签列表

---

## 6. 最终 Reader 结构（D-011~D-015-A）

### 布局（用户截图确认）
```
左侧导航栏（独立区域：Project 树/对话/搜索/导入/设置）
  + 正文区域（.reader-frame）:
      - 对话 TOC rail（.reader-index-column，左 sticky，≥1280px）
      - 消息正文（.reader-content-column，居中）
      - 章节 TOC（.reader-toc-column，右 sticky，≥62rem container）
  + 批注工作区（独立第四区域，不取代任何 TOC）
```
**注意：两 TOC 均属正文区域，不是独立右侧栏。**

### 模式（D-011）
- **默认阅读：** 正文 + 对话 TOC rail + 章节 TOC visible + 顶栏一级动作
- **专注模式：** 隐藏两 TOC + 顶栏辅助，正文最大化（`data-focus-mode` CSS 控制）
- **工作台模式：** 按需展开面板 + 批注
- **Share 访客模式：** 简化 TOC + 可选导出
- **离线模式：** 离线库侧栏 + 简化写

### 正文（D-012）
- 所有消息统一左对齐（文档风格）
- 区分方式：头像 + `User/Assistant · #序号` + `--subtle`/`--surface` 背景 + 可选 accent 左边条
- 消息间距 32px（`--space-message`）
- 阅读宽度三档可选

### 双 TOC（D-013）
- 对话 TOC：跨消息导航，UI名"消息列表"，彩条 rail，hover 展开 panel
- 章节 TOC：消息内导航，UI名"章节目录"，树状缩进，visible/rail 两态
- 命名与视觉明确区分，不合并

### 顶栏（D-014）
- 一级（始终可见）：当前对话搜索 / 阅读导航 / 批注 / 分享
- 二级（更多菜单）：导出 / 在线离线切换 / 展开全部 / 刷新同步
- 编辑操作（条件显示）：合并消息 / 拆分对话 / 自动清理
- 消息级（hover 菜单）：编辑消息 / 查看版本 / 书签 / 复制

### 批注工作区（D-015 / D-015-A）
- **默认浮窗：** 覆盖正文，可拖动+调整大小+记忆位置（初始约 380×560）
- **固定到左侧导航栏：** 完全覆盖左侧栏内容（Project 树/对话列表消失），提供返回导航栏入口
- **拆离/浮窗：** 可从固定态拆回浮窗
- **关闭：** 恢复左侧导航栏
- **不取代任何 TOC**，是独立第四区域

---

## 7. 最终搜索方案（D-008, D-010 封板确认）

- 全局搜索入口：侧栏 + Cmd/Ctrl+K
- 搜索范围：对话内容 + **批注内容**（2026-07-27 封板确认新增）
  - 全局搜索分类展示：对话结果 / 批注结果分别分组
  - 当前对话搜索：批注部分只搜本对话批注
- 离线搜索：同步索引批注内容
- 结果定位：精确定位到 block/offset
- 返回保留查询

---

## 8. 最终批注与笔记方案

- 5 类型（highlight/underline/strikethrough/comment/bookmark）4 颜色
- 锚点三态（active/relocated/stale）
- 批量管理、精选笔记（dnd 排序）
- 离线 outbox + 冲突副本
- 批注内容进入搜索索引（见 §7）
- 所有私有内容默认不出现在 Share/Export

---

## 9. 最终 Share 与 Export 方案

- Share：full/selected scope + 有效期 + options（description/annotations/notebook 默认关闭）+ allow_export
- Export：Markdown / JSON / `.cr` 三种格式（不加 HTML/PDF）
- 访客页：受限只读 Reader + 可选导出

---

## 10. 最终离线与 PWA 方案

- `/library` 不入主导航，情景引导（Reader 更多菜单 / 一次性提示卡 / 设置面板）
- SW scope 保持 `/library`
- 下载/删除/空间/更新/冷启动
- 离线只写批注/笔记（outbox），canonical 管理禁用
- 本地较新阅读位置不被包覆盖
- 数据格式升级：UI 明确提示后清空旧库重新下载（D-024 边界限定）

---

## 11. 最终移动端能力范围

| 能力 | 移动端 |
|------|--------|
| 阅读/TOC/搜索/继续阅读 | ✅ 完整 |
| 创建批注 | ✅ 简化（highlight/underline/comment，简化选色）|
| 精选笔记 | 只读 |
| 分享 | ✅ 基础（生成链接）|
| 导出 | ✅ 基础（MD/.cr）|
| Project 单个移动 | ✅ |
| 编辑消息/版本 | ❌ |
| 合并/拆分/批量 | ❌ |
| 导入 | ❌（提示桌面） |
| 复杂 Project 管理 | ❌ |

---

## 12. 最终视觉系统（D-019~D-022）

| 维度 | 结论 |
|------|------|
| 气质 | 现代阅读器（舒适温暖），参考 Readwise Reader/Matter |
| 主色 | #10a37f（绿色，微调更温暖），accent-soft #f0fdfa |
| 中性色 | 暖调（page #faf9f6, sidebar #f5f3ef, border #e6e2da）|
| 密度 | 正文宽松（32px 消息间距），侧栏紧凑 |
| 圆角 | 容器/按钮 8px，输入框 6px，对话框 12px |
| 阴影 | 三级（subtle/soft/medium）|
| 边框 | 主要用于输入框和分隔，容器优先用阴影 |
| 系统 | 全部 token 在 globals.css CSS 变量，tailwind 不扩展 |

---

## 13. 最终功能变化（FUNCTION_CHANGE_MATRIX 汇总）

**保留：** 导入 preview→commit 流程、Project 管理/拖动/置顶、消息编辑/版本/合并/拆分、精确目标导航、锚点重定位、离线同步协议、在线离线互跳、Markdown/KaTeX/Mermaid/callout 渲染、图片/附件渲染（不加上传）、键盘导航、自动清理

**优化：** 对话列表进度/时间/摘要、归档页视觉、搜索结果分组+上下文+高亮、顶栏分级、Share/Export 面板视觉、Library 壳视觉

**重构：** 正文从左对齐重构为统一左对齐、对话 TOC 视觉、章节 TOC 视觉、批注工作区混合形态（浮窗/固定/拆离）

**补齐：** `/recent` 入口（KI-003）、Cmd/Ctrl+K 快捷搜索、搜索索引含批注内容、统一状态组件（empty/error/offline/conflict）

**新增（均已确认）：** 专注模式、移动端简化批注创建、离线情景引导、设计 token（三级阴影/圆角/间距语义）、移动继续阅读卡片

**隐藏/降级：** 无

**删除：** 无

**明确不做（D-023）：** §2 所列全部

---

## 14. 技术锁定

| 层 | 结论 | 说明 |
|----|------|------|
| **前端** | **必须修改** | 全部页面和组件改动 |
| **后端** | **小量修改** | 扩展搜索 API 返回批注结果；search_indexer 同步批注内容 |
| **API** | **扩展返回字段** | `GET /api/search` 返回结果增加 `annotation_id`、`annotation_type` 等字段；新增 `document_type='annotation'` |
| **数据库** | **不改** | 利用现有 SearchDocument 表，document_type 新增 'annotation' 值，不改表结构 |
| **Alembic** | **不创建** | 无 schema 变更 |
| **Dexie** | **不改** | 保持现有 stores；离线批注搜索通过现有离线 searchDocuments 延伸 |
| **Service Worker** | **调整** | `library-sw.js` 更新缓存资源列表；scope 保持 `/library`；不重写 |
| **.cr** | **不改** | 格式与导出逻辑不变 |
| **offline package** | **不改** | 包格式不变 |
| **Share** | **不改** | token 规则/API/隐私 flags 不变 |
| **Nginx** | **不改** | 配置不变 |
| **生产部署** | **需要重建** | 前端重建 + SW 更新（revision bump）；无容器重建/migration 需求 |

### 搜索含批注的具体技术方案

- **在线搜索：** 在 `apps/api/app/models/annotation.py` 的 `ConversationAnnotation` 中扩展搜索索引逻辑。当创建/更新/删除批注时，同步 upsert/delete `SearchDocument` 行（`document_type='annotation'`）。搜索 API 查询时包含 `document_type='annotation'` 行到结果。扩展 `SearchResultItem` schema 增加可选的 `annotation_id`、`annotation_type`、`annotation_color` 字段。
- **离线搜索：** 离线包下载时包含批注的 SearchDocument 行；FlexSearch worker 无需改动。
- **当前对话搜索：** 前端传 `conversation_id` 过滤——已支持的 API 参数。
- **前端分类：** 搜索结果按 `document_type` 分组展示。
- **索引策略：** 不全文索引批注颜色/类型等，只索引 `comment` 文本。

---

## 15. 兼容性锁定

| 对象 | 策略 |
|------|------|
| PostgreSQL 数据 | **完全保留**。不删除、不破坏任何已有数据 |
| `.cr` 格式 | **不变**。已导出 .cr 文件继续可导入 |
| 已有 Share URL | **继续有效**。token 规则和 API 不改 |
| 离线数据（Dexie） | **不向后兼容仅适用于 CSS token**。需升级时 UI 提示后清空 |
| 离线包格式 | **不变**。已下载离线包继续可用 |
| 批注/笔记数据 | **保留**。锚点/颜色/类型语义不变 |
| 阅读位置 | **保留**。localStorage key 不变 |
| localStorage 偏好 | **旧 key 保留**，仅新增 key（专注模式/批注位置）|
| CSS token 名 | **色值可微调**，不破坏布局语义 |

---

## 16. 安全和隐私锁定

- Share/Export 的 description/annotations/notebook 默认关闭（与现状一致）
- 搜索含批注仅对本地资料拥有者可搜索，Share 访客不搜批注（token 限制 scope）
- 不引入认证/Token/API Key/私钥逻辑
- 不记录或暴露用户聊天正文到文档

---

## 17. 执行智能体允许自行决定的事项

以下属于实现自由项，执行智能体可按实际情况调整：

1. 新组件是否拆独立文件 vs. 在现有文件中扩展
2. hook/函数/变量命名（遵循现有命名约定）
3. `globals.css` 中新增类的命名（遵循现有 `.bg-*`/`.reader-*` 模式）
4. 测试夹具的具体结构
5. 不改变产品语义的前端内部代码组织
6. 表单验证/错误提示的具体实现细节
7. 动画/过渡的具体参数（200ms vs 150ms 等微调）

---

## 18. 执行智能体禁止自行改变的事项

以下**不得**在执行中修改：

1. 已确认的 25 项决策（D-001~D-025）的核心结论
2. 产品定位（工具型，不加在线 AI/账号/多用户）
3. 信息架构（页面树/导航结构/首页职责）
4. Reader 布局模型（左侧导航栏 + 正文区含双 TOC + 批注独立第四区域）
5. 正文统一左对齐的布局原则
6. 批注工作区浮窗/固定（覆盖式取代左侧栏）的核心交互
7. 移动端能力范围（完整/简化/不支持的三级分类）
8. 视觉系统核心 token（accent 色 #10a37f、圆角 8/6/12px）
9. 不删除任何现有核心功能
10. 不加任何"明确不做"列表中的功能（D-023）
11. Dexie/SW/.cr/offline package/Share 的不改约束
12. 兼容性边界（§15）和安全隐私锁定（§16）

---

## 19. 触发用户提问的唯一条件

执行中只有以下情况需要向用户提问：

1. **发现规划中的错误或不可执行项**：如引用的文件不存在、API 不支持、架构无法实现
2. **外部依赖失效**：如 KaTeX/Mermaid/Shiki 版本不兼容
3. **破坏性变更超出兼容边界**：需要删除 PostgreSQL 数据 / 让已有 Share URL 失效 / 丢失批注笔记
4. **明显超出规划范围的需求**

---

## 20. 回退原则

- 前端/样式/组件：Git 回退
- DB：无 migration 则无需回退；如有条件性修改，提供 downgrade
- SW：切换回旧 revision（保留旧 revision 的 staging）
- Dexie：版本降级 + UI 提示

---

## 21. 完成标准

见 `ACCEPTANCE_AND_TEST_PLAN.md` 全部 A/S 验收 + 测试计划的执行完成。无遗留"待定"项。
