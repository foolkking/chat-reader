# 设计系统规划 DESIGN_SYSTEM_PLAN

**创建日期：** 2026-07-27
**依据：** DECISION_LOG D-003, D-019, D-020, D-021, D-022
**基础文件：** 全部设计 token 位于 `apps/web/app/globals.css`（CSS 变量），`apps/web/tailwind.config.ts` 为空 extend（不迁移到 Tailwind theme，继续用 CSS 变量 + `.bg-*/.text-*` 工具类）。

---

## 1. 设计原则

现代阅读器气质（D-019）：舒适温暖、柔和、结构清晰、强调阅读。参考 Readwise Reader / Matter / Pocket。

- 温暖背景，柔和阴影替代硬边框。
- 圆角适度（8px 基准）。
- 正文宽松，侧栏紧凑。
- 绿色主色微调更温暖。

---

## 2. 色彩 Token（globals.css `:root` 与 `[data-theme="dark"]`）

### 2.1 需要修改的 token（D-020）

| 变量 | 现值（light） | 改为（light） | 现值（dark） | 改为（dark） | 说明 |
|------|--------------|--------------|--------------|--------------|------|
| `--accent` | `#0f8f70` | `#10a37f` | `#55c9a6` | `#5fd0ad` | 主色更温暖 |
| `--accent-soft` | `#e8f5f0` | `#f0fdfa` | `#173d32` | `#16473a` | 更浅 teal |
| `--focus` | `#10a37f` | `#10a37f`（保持） | `#67d4b2` | `#67d4b2`（保持） | 与 accent 协调 |

### 2.2 需要微调的中性色（更温暖）

| 变量 | 现值（light） | 建议（light） | 说明 |
|------|--------------|--------------|------|
| `--page` | `#f7f7f5` | `#faf9f6` | 更暖的米白 |
| `--sidebar` | `#f4f4f2` | `#f5f3ef` | 暖灰 |
| `--subtle` | `#efefec` | `#f0ede8` | 暖调 |
| `--border` | `#deded9` | `#e6e2da` | 柔和暖边 |

Dark 模式保持现有暖绿灰体系（`#171817` 等），仅同步 accent。

### 2.3 保持不变的 token
markdown-*、callout-*、link-*、table-*、mark-*、code-bg、danger、overlay 等保持现有语义，仅在对比度不足时微调。

---

## 3. 新增 Token（需在 globals.css 补充）

### 3.1 阴影三级（D-022）
```css
--shadow-subtle: 0 1px 2px rgb(0 0 0 / 0.04);
--shadow-soft: 0 2px 8px rgb(0 0 0 / 0.08), 0 1px 2px rgb(0 0 0 / 0.04);
--shadow-medium: 0 4px 16px rgb(0 0 0 / 0.12), 0 2px 4px rgb(0 0 0 / 0.06);
/* dark 模式对应加深 */
```

### 3.2 圆角
```css
--radius-sm: 6px;   /* 输入框、代码块 */
--radius-md: 8px;   /* 容器、卡片、按钮 */
--radius-lg: 12px;  /* 对话框、Bottom Sheet 顶部 */
--radius-pill: 999px; /* pill 按钮、标签 */
```

### 3.3 间距语义（D-021）
```css
--space-message: 2rem;      /* 32px 消息间距（正文宽松） */
--space-list-tight: 4px;    /* 侧栏对话行 */
--space-list: 8px;          /* Project 间距 */
--space-toc-rail: 2px;      /* 对话 TOC 极紧凑 */
```

---

## 4. 排版（D-012, D-021）

| 元素 | 规范 |
|------|------|
| 正文字号 | 桌面 1.0625rem（现有），移动 1rem |
| 正文行高 | 1.75（现有 `.reader-content-inner`） |
| 正文最大宽度 | compact 54rem / standard 64rem / wide 76rem（现有三档保留） |
| 段落最大行宽 | 88ch（现有 `.reader-prose`） |
| 消息间距 | **32px**（新 `--space-message`，替换现 space-y-6） |
| 标题层级 | h1 > h2 > h3 清晰梯度；user 消息标题已有压缩规则（保留） |
| 字体 | 正文 sans-serif 系统栈；可选标题字体后续在组件确定，不强制 serif |

---

## 5. 正文消息区分（D-012 统一左对齐）

所有消息统一左对齐，通过以下区分 user/assistant：

| 元素 | User | Assistant |
|------|------|-----------|
| 头像 | 小圆头像/首字母，暖色 | 小圆头像/CR 标记 |
| 标签 | `User · #序号` | `Assistant · #序号` |
| 背景 | 浅背景 `--subtle` 卡片 | 透明/`--surface` |
| 左边标识 | 可选左边色条 | 可选左边色条（accent） |
| 时间戳 | hover 显示 | hover 显示 |

- 移除 user 右对齐布局，统一走文档流。
- 保留 `.message-user` 的 markdown 压缩规则（globals.css L303-325）。

---

## 6. 组件规范

### 6.1 按钮
| 类型 | 样式 |
|------|------|
| Primary | `--accent` 背景，白字，8px 圆角，`--shadow-subtle` |
| Secondary | `--surface` 背景，`--border` 边，8px 圆角 |
| Ghost | 透明，hover `--subtle` |
| Icon | 方形/圆形，hover `--subtle`，focus ring `--focus` |
| Pill（标签切换） | pill 圆角，选中 `--accent-soft` 背景 + `--accent` 字 |
| Danger | `--danger` 字/边，hover `--danger-soft` 背景 |

### 6.2 输入框
- 圆角 6px，`--border` 边，focus 时 `--focus` 边 + 2px ring。

### 6.3 卡片/容器
- 圆角 8px，背景 `--surface`，`--shadow-soft`，优先阴影少用边框。

### 6.4 菜单/下拉
- 圆角 8px，`--surface-raised`，`--shadow-medium`，项 hover `--subtle`。

### 6.5 对话框（Modal）
- 圆角 12px，遮罩 `--overlay`，`--shadow-medium`，焦点陷阱 + Esc 关闭。

### 6.6 Bottom Sheet（移动）
- 顶部圆角 12px，Vaul 实现（现有依赖），拖动手柄，安全区 padding。

### 6.7 状态元素
| 元素 | 规范 |
|------|------|
| Badge | pill，小字，`--accent-soft`/语义色 |
| Tooltip | 深色小卡，`--shadow-soft`，延迟显示 |
| Toast | 右下/顶部，`--surface-raised`，`--shadow-medium`，自动消失 + 可操作 |
| Skeleton | `--subtle` 渐变动画，尊重 reduced-motion |
| Empty | 图标 + 标题 + 说明 + 主操作按钮 |
| Error | `--danger` 图标 + 说明 + 重试按钮 |
| Offline | 离线徽标 + 说明，`--accent-soft` 或中性 |
| Conflict | 警示色 + "保留副本"说明 + 操作 |
| Focus ring | `--focus` 2px，所有可交互元素 |
| Selected | `--accent-soft` 背景 + `--accent` 左条 |

---

## 7. 图标
- 继续用 Lucide React（现有依赖），统一线宽和尺寸（16/20/24）。

---

## 8. 深色模式
- 三主题 light/dark/system 保留（`PreferencesProvider`）。
- 所有新增 token 需提供 dark 值。
- 保持现有 `html[data-theme="dark"]` 覆盖规则（globals.css L125-140），并逐步用变量替换硬编码颜色覆盖。

---

## 9. Reader 布局 CSS（关键，D-011/D-015-A）

现有布局全部在 globals.css `.reader-frame` / `.reader-layout-grid` / `.reader-content-column` / `.reader-toc-column` / `.reader-index-column`：

- **对话 TOC** = `.reader-index-column`（左，≥1280px 显示，sticky，彩条 rail）。
- **章节 TOC** = `.reader-toc-column`（右，≥62rem container，visible/rail 两态）。
- **正文** = `.reader-content-column`（居中，随章节 TOC 态调整边距）。

改造要点：
1. 保持三区域网格模型（对话 TOC + 正文 + 章节 TOC 均属正文区域）。
2. 消息间距改用 `--space-message`。
3. 章节 TOC visible/rail 视觉重做（柔和卡片、树状缩进）。
4. 对话 TOC 彩条 rail 视觉优化（更清晰的 active 标记）。
5. 专注模式：新增 `data-focus-mode` 属性，隐藏两个 TOC 列和顶栏辅助。
6. 批注浮窗/固定：见 READER_REDESIGN_PLAN，浮窗覆盖 `.reader-frame`，固定时覆盖左侧导航栏（非 reader-frame 内）。

---

## 10. 涉及文件

| 变更 | 文件 |
|------|------|
| 全部 token（改/新增） | `apps/web/app/globals.css` |
| Reader 布局网格 | `apps/web/app/globals.css`（`.reader-*`） |
| 组件样式（按钮/卡片/菜单等） | 各组件 tsx 内 className；必要时在 globals.css 增工具类 |
| 消息区分 | `apps/web/features/conversations/message-item.tsx`, `assistant-message-renderer.tsx` |
| 主题变量提供 | `apps/web/components/preferences-provider.tsx`（如需读取新偏好） |
