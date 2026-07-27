# 信息架构规划 INFORMATION_ARCHITECTURE_PLAN

**创建日期：** 2026-07-27
**依据：** DECISION_LOG D-005, D-006, D-007, D-008, D-009

---

## 1. 目标页面树

```text
Chat Reader
├── / 首页（资料总览中心）D-006
│   ├── 左侧导航栏
│   │   ├── 顶部品牌区
│   │   ├── 导入数据按钮
│   │   ├── 搜索框/按钮（Cmd+K）D-008
│   │   ├── 最近入口（→ /recent）D-007 新增
│   │   ├── 已归档入口（→ /archived）
│   │   ├── 标签切换：对话 | 项目 D-007
│   │   │   ├── 对话标签：未分类活跃对话列表
│   │   │   └── 项目标签：Project 树
│   │   └── 底部：外观与语言设置
│   └── 主内容区：活跃对话列表（当前列表视图）
├── /recent 最近（正式纳入导航）D-007
├── /archived 归档
├── /search 全局搜索（也可 Cmd+K 唤起）
├── /projects/[projectId] Project 详情
├── /conversations/[conversationId] Reader（见 READER_REDESIGN_PLAN）
├── /share/[token] 只读分享
├── /library 离线资料库（情景化引导进入，不入主导航）D-005
└── /offline 连接失败页
```

---

## 2. 一级 / 二级导航

### 左侧导航栏结构（桌面）

```
┌─────────────────────────┐
│ [CR] Chat Reader    [⇤] │  品牌 + 折叠
├─────────────────────────┤
│ [⤓] 导入数据            │  主操作
│ [🔍] 搜索标题和消息内容  │  搜索框（点击/Cmd+K）
├─────────────────────────┤
│ [🕐] 最近      [📦] 归档 │  快速入口（新增"最近"）
├─────────────────────────┤
│  对话  │  项目            │  标签切换
├─────────────────────────┤
│ 全部对话              1  │  分组标题 + 计数
│  · typescript      刚刚  │  对话行
│  · ...                   │
├─────────────────────────┤
│ [⚙] 外观与语言          │  底部设置
└─────────────────────────┘
```

**导航层级：**
- **一级（始终可见）：** 导入、搜索、最近、归档、对话/项目标签、设置。
- **二级（标签内容）：** 对话列表 或 Project 树。
- **三级（行内菜单）：** 单项操作（置顶/移动/描述/归档/删除）。

### 与旧结构的差异
| 项 | 现状 | 改造后 |
|----|------|--------|
| 最近入口 | 侧栏无（KI-003） | **正式加入**顶部快速入口 |
| 搜索 | 侧栏搜索框 | 保留 + 支持 Cmd/Ctrl+K 全局唤起 |
| 归档 | 侧栏"已归档" | 保留，与"最近"并列为快速入口 |
| 离线库 | Reader 内入口 | 保持情景化，不入主导航（D-005） |

---

## 3. `/recent` 正式化（D-007）

- **现状：** 页面存在（`apps/web/app/recent/page.tsx` + `features/reading/recent-items.tsx`），侧栏无入口。
- **改造：**
  1. 在左侧导航栏顶部快速入口区增加"最近"链接。
  2. 完善 `/recent` 页面：分组展示最近打开的 Conversation / Project / Message，每项显示阅读进度、访问时间，点击进入 Reader 并恢复位置。
  3. 空状态：引导"打开一个对话开始阅读"。
- **数据来源：** `/api/recent-items`（后端 `apps/api/app/api/routes/reading.py`，模型 `recent_items` 表）。

---

## 4. `/library` 情景化引导（D-005）

- **不做：** 不加入主导航。
- **引导入口（情景化）：**
  1. Reader 顶栏"更多"菜单中的"离线资料库/下载此对话"。
  2. 首次满足条件时（如用户多次访问同一对话），在 Reader 顶部出现一次性提示卡"下载后可离线阅读"（可关闭，记忆已关闭）。
  3. 设置面板中提供"离线资料库"入口。
- **SW scope 提示：** 保持 `/library` 独立 SW scope，不误导为全站离线。

---

## 5. 全局搜索唤起（D-008）

- **入口：**
  1. 侧栏搜索框（点击聚焦）。
  2. **全局快捷键 Cmd/Ctrl+K**（新增，通过 `shortcut-manager.tsx` 派发 `chat-reader:focus-global-search`）。
- **行为：** 唤起后聚焦搜索，输入跳转 `/search` 或就地展开结果（保持当前 `/search` 页面为主）。
- **Reader 内：** 保留"当前对话搜索"（`chat-reader:open-reader-search` 事件），与全局搜索区分。

---

## 6. 跳转关系

```text
列表/Project/最近/搜索结果 ──► /conversations/[id]（带 messageId/blockIndex/characterOffset）
在线 Reader ──"下载/离线库"──► /library?conversationId=...&message=...&block=...&offset=...
离线 Reader ──联网──► /conversations/[id]（同一定位上下文）
Reader Share 面板 ──创建──► /share/[token]
搜索结果 ◄──返回──► Reader（保留查询与滚动位置）
Cmd/Ctrl+K ──► 聚焦全局搜索
```

---

## 7. 当前位置表达与返回路径

- **面包屑/标题：** Reader 顶栏显示 `Project 名 / 对话名`（有 Project 时）或对话名。
- **返回：** Reader 顶栏左侧返回按钮回到来源列表；浏览器返回保持一致。
- **高亮当前项：** 侧栏中当前打开的对话/Project 高亮。

---

## 8. 涉及文件（信息架构层）

| 变更 | 文件 |
|------|------|
| 左侧导航栏结构 + 最近/搜索入口 | `apps/web/features/projects/project-sidebar.tsx` |
| 应用壳 | `apps/web/components/app-shell.tsx` |
| 最近页面 | `apps/web/app/recent/page.tsx`, `apps/web/features/reading/recent-items.tsx` |
| 搜索唤起快捷键 | `apps/web/components/shortcut-manager.tsx`, `apps/web/features/search/sidebar-search.tsx`, `search-box.tsx` |
| 离线情景引导 | `apps/web/features/conversations/conversation-reader.tsx`, `apps/web/components/preferences-panel.tsx` |
| 首页 | `apps/web/app/page.tsx` |
