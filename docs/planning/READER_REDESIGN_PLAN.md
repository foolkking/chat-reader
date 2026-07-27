# Reader 改造规划 READER_REDESIGN_PLAN

**创建日期：** 2026-07-27
**依据：** DECISION_LOG D-011~D-015-A
**核心文件：** `apps/web/features/conversations/conversation-reader.tsx`（约 1500+ 行）、`message-item.tsx`、`assistant-message-renderer.tsx`、`features/toc/conversation-index.tsx`、`features/toc/conversation-toc.tsx`、`features/annotations/annotation-workspace.tsx`、`components/reader-header-action-rail.tsx`、`components/responsive-reader-frame.tsx`、`components/reader-sidebar-frame.tsx`、`app/globals.css`。

---

## 1. 布局架构（用户截图确认）

```
┌──────────────────────────────────────────────────────────────┐
│ Header: [返回] Project/标题  30/998 条消息        [一级动作][更多]│
├──────────┬───────────────────────────────────────────────────┤
│ 左侧      │                正文区域（reader-frame）             │
│ 导航栏    │  ┌──────┬─────────────────────┬──────────────┐    │
│（独立）   │  │对话  │                     │  章节 TOC    │    │
│          │  │TOC   │    消息正文          │ (正文一部分) │    │
│ Project  │  │(rail)│   (居中左对齐)      │  树状/rail   │    │
│ 树/对话  │  │彩条  │                     │              │    │
│ 列表     │  │U/A   │                     │              │    │
│          │  └──────┴─────────────────────┴──────────────┘    │
│          │        ▲ 批注浮窗可覆盖此正文区域                  │
└──────────┴───────────────────────────────────────────────────┘
   ▲ 批注"固定到左侧"时完全覆盖此左侧导航栏
```

**区域定义（不可混淆）：**
- **左侧导航栏**：独立区域，Project 树/对话列表/搜索/导入/设置（`project-sidebar.tsx` via `reader-sidebar-frame.tsx`）。
- **正文区域** `.reader-frame`：含三部分——
  - **对话 TOC**（左，`.reader-index-column`，彩条 + U/A 序号，rail/panel）
  - **消息正文**（中，`.reader-content-column`，居中左对齐）
  - **章节 TOC**（右，`.reader-toc-column`，树状，visible/rail）——**属于正文，非独立右侧栏**
- **批注工作区**：独立第四元素，默认浮窗覆盖正文；可固定到左侧导航栏（覆盖之）。

---

## 2. 渐进式显示模式（D-011）

| 模式 | 左侧导航栏 | 对话 TOC | 章节 TOC | 批注 | 顶栏动作 |
|------|-----------|---------|---------|------|---------|
| **默认阅读** | 可折叠 | rail（彩条） | visible | 关闭 | 一级+更多 |
| **专注模式** | 隐藏 | 隐藏 | 隐藏 | 关闭 | 最小（返回+退出专注） |
| **工作台模式** | 展开 | rail/panel | rail | 打开（浮窗或固定） | 全部 |
| **Share 访客** | 简化 | rail | visible | 无 | 受限（导出如允许） |
| **离线模式** | 离线库侧栏 | rail | visible | 只读/简化写 | canonical 禁用 |

- **专注模式：** 新增按钮/快捷键，`reader-frame` 加 `data-focus-mode="on"`，CSS 隐藏 `.reader-index-column`、`.reader-toc-column` 和顶栏辅助，正文居中最大化。
- 模式状态持久化（localStorage）。

---

## 3. 正文排版（D-012 统一左对齐）

- **移除 user 右对齐**，所有消息进入统一文档流，左对齐。
- **消息头：** 头像 + `User/Assistant · #序号` + hover 时间戳。
- **背景区分：** User 用 `--subtle` 卡片，Assistant 用 `--surface`/透明；可选 accent 左边条。
- **消息间距：** `--space-message`（32px）。
- **富内容（保留现有渲染管线）：** GFM、Shiki 代码高亮+复制、KaTeX、Mermaid、callout、reasoning `<details>`、表格、图片/附件 part、超长消息 `content-visibility:auto`（`.reader-message`）。
- **超长消息：** 保持 heavy block 懒加载；折叠规则保留。
- **复制/选区：** 保留 CSS Highlight API 与选区工具（批注入口）。

涉及：`message-item.tsx`, `assistant-message-renderer.tsx`, `markdown-renderer.tsx`, `block-renderer.tsx`, `globals.css`。

---

## 4. 双 TOC（D-013）

### 4.1 对话 TOC（`conversation-index.tsx`，`.reader-index-column`）
- **定位：** 跨消息导航（"看第 N 条"）。
- **命名：** UI 显示"消息列表"或"对话索引"。
- **视觉：** 彩条 rail（现有），hover 展开 panel（`.dialogue-index-panel`，clamp 17-21rem）。
- **优化：** U/A 序号 + 简短预览；active row 更清晰；跳号/分页保留。

### 4.2 章节 TOC（`conversation-toc.tsx`，`.reader-toc-column`）
- **定位：** 当前消息内 heading 导航。
- **命名：** UI 显示"章节目录"（截图已是"章节目录"）。
- **视觉：** 树状缩进、active marker、visible/rail 两态（`data-section-toc`）。
- **优化：** 层级缩进更清晰；加载中保留上一份数据（现有行为保留）。

### 4.3 区分度
- 两者视觉语言不同：对话 TOC = 彩条+序号列表；章节 TOC = 树状缩进。
- 命名明确区分，避免混淆。

---

## 5. 顶栏分级（D-014）

### 一级（始终可见，桌面）
1. 当前对话搜索（`chat-reader:open-reader-search`）
2. 阅读导航（打开对话 TOC / 章节 TOC 面板）
3. 批注工作区（打开浮窗/固定面板，显示批注计数 badge）
4. 分享

### 二级（"更多"菜单，`reader-header-action-rail.tsx`）
- 导出
- 在线/离线切换（离线库/下载此对话）
- 展开全部块
- 刷新/同步
- 专注模式切换

### 编辑操作（条件显示）
- 合并消息（选中 2+）
- 拆分对话（选中消息）
- 对话自动清理

### 消息级（消息 hover 菜单，`conversation-action-menu.tsx`）
- 编辑消息、查看版本、添加书签、拆分此消息、复制

---

## 6. 批注工作区（D-015 / D-015-A）

**核心文件：** `features/annotations/annotation-workspace.tsx`（现有 localStorage key `chat-reader:annotation-workspace-panel`）。

### 6.1 形态（混合模式）
| 状态 | 行为 |
|------|------|
| **默认浮窗** | 首次打开为浮窗，覆盖正文区域；初始位置右中，尺寸约 380×560；可拖动、调整大小；位置/尺寸持久化 |
| **固定到左侧** | 用户选择"固定到左侧栏"→ **完全覆盖**左侧导航栏（Project 树/对话列表消失）；占满左栏宽度；提供"返回导航栏"入口 |
| **拆离/恢复浮窗** | 从固定态可拆离回浮窗 |
| **关闭** | 关闭后左侧导航栏恢复；不影响任何 TOC |

- **不取代任何 TOC**：批注是独立第四区域，与对话 TOC、章节 TOC 并存。
- **状态记忆：** 浮窗位置/尺寸、固定态偏好（localStorage）。

### 6.2 功能（保留现有 + 优化）
- 选区工具：highlight/underline/strikethrough/comment + 黄绿蓝粉（现有 CSS Highlight，globals.css L145-161）。
- 书签：整条消息 bookmark（`chat-reader:create-bookmark` 事件）。
- 列表管理：筛选、单项/批量、改类型/颜色/评论、加入笔记、删除、定位。
- 精选笔记：Markdown 段落 + annotation reference，dnd-kit 拖动排序。
- 锚点状态：active/relocated/stale + 降级提示。
- 定位：复用 Reader 目标导航事务。

---

## 7. 导航与定位（保持语义，D-024 允许改实现）

保持精确目标定位语义：
- 目标优先流程：取消旧 token → 准备 window/blocks/TOC → 一次替换 → quote/prefix/suffix → offset → block → message 回退。
- 阅读位置：debounce 保存 message/block/offset；刷新按 URL 目标或保存位置恢复。
- URL 定位：`messageId/blockIndex/characterOffset`。
- 跳转后高亮 + 回到原位置提示。
- 边缘加载反馈。

涉及：`conversation-reader.tsx`, `reader-navigation.ts`, `reader-window.ts`, `neighborhood-expansion.ts`。

---

## 8. 状态设计（全覆盖）

| 状态 | 表现 |
|------|------|
| Loading（初始/目标窗口） | Skeleton；保留上一份 TOC 数据 |
| Empty（无 heading） | 章节 TOC 空态文案 |
| Error（数据失败） | "对话暂时不可用" + 重试（现 STATE-005） |
| Invalid ID | 不可用页 + 返回列表 |
| Offline | 离线徽标；canonical 动作禁用提示 |
| Conflict（批注同步） | "保留冲突副本"说明 + 操作 |
| Stale 锚点 | 降级到 block/message + 提示 |
| 边缘加载 | 顶/底加载指示 |

---

## 9. 键盘与可访问性
- 保留方向键/J/K/PageUp-Down/Space/Home/End；输入聚焦时保护。
- 新增：专注模式快捷键、批注面板 Esc 关闭、焦点陷阱、Cmd+K 全局搜索。
- 可交互元素 focus ring（`--focus`）。

---

## 10. 移动端 Reader（详见 MOBILE_EXPERIENCE_PLAN）
- 顶栏极简（D-017）；TOC/搜索/批注进 Bottom Sheet（`mobile-reader-sheet.tsx`）。
- 批注支持简化创建（D-016）。

---

## 11. 涉及文件汇总

| 模块 | 文件 |
|------|------|
| Reader 主体 | `apps/web/features/conversations/conversation-reader.tsx` |
| 消息渲染 | `message-item.tsx`, `assistant-message-renderer.tsx`, `markdown-renderer.tsx`, `block-renderer.tsx` |
| 导航逻辑 | `reader-navigation.ts`, `reader-window.ts`, `neighborhood-expansion.ts` |
| 对话 TOC | `apps/web/features/toc/conversation-index.tsx` |
| 章节 TOC | `apps/web/features/toc/conversation-toc.tsx` |
| 顶栏动作 | `apps/web/components/reader-header-action-rail.tsx` |
| 批注 | `apps/web/features/annotations/annotation-workspace.tsx` |
| 布局框架 | `apps/web/components/responsive-reader-frame.tsx`, `reader-sidebar-frame.tsx`, `resizable-pane.tsx` |
| 左侧栏 | `apps/web/features/projects/project-sidebar.tsx` |
| 移动 | `apps/web/components/mobile-reader-sheet.tsx`, `use-mobile-header-auto-hide.ts` |
| 样式 | `apps/web/app/globals.css` |
