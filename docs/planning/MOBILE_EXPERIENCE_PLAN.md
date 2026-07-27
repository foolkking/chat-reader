# 移动端体验规划 MOBILE_EXPERIENCE_PLAN

**创建日期：** 2026-07-27
**依据：** DECISION_LOG D-004, D-016, D-017, D-018
**核心文件：** `apps/web/components/mobile-reader-sheet.tsx`、`use-mobile-header-auto-hide.ts`、`features/projects/project-sidebar.tsx`（移动 sheet 态）、`features/reading/recent-items.tsx`、各 feature 组件的移动分支。基线视口 390×844。

---

## 1. 总原则（D-004 桌面优先）
移动端不是桌面缩小版，独立方案，聚焦阅读 + 轻量管理（D-016）。

---

## 2. 移动端首页（D-018）
```
┌─────────────────────┐
│ [CR]        [🔍][⚙] │  Header
├─────────────────────┤
│ 继续阅读            │
│ ┌────┐┌────┐┌────┐ │  横向滑动 1-3 卡片
│ │卡1 ││卡2 ││卡3 │ │  标题+进度条+继续
│ └────┘└────┘└────┘ │
├─────────────────────┤
│  对话  │  项目       │  标签切换
├─────────────────────┤
│ 对话列表            │
└─────────────────────┘
```
- 继续阅读卡片：标题 + 进度条 + "继续"；最多 3；无最近阅读时**不显示**该区。
- 下方保持对话/项目标签列表。
- 数据：`/api/recent-items` + 阅读位置。

---

## 3. 移动端侧栏
- Bottom Sheet / 抽屉承载 Project 树、对话列表、搜索、导入入口（导入不支持，隐藏或提示桌面）、设置。
- 无 desktop rail/separator。

---

## 4. 移动端 Reader
### 顶栏（D-017 极简）
```
[返回]  对话标题（截断）        [阅读导航][更多]
```
- 左：返回；中：标题单行截断（点击看完整）；右：阅读导航 + 更多菜单。
- 自动隐藏：`use-mobile-header-auto-hide.ts`（滚动时）。

### 更多菜单（Sheet）
当前对话搜索、批注、分享、导出、在线/离线切换、刷新、（选中时）消息操作。

### 导航（Bottom Sheet）
- 对话 TOC / 章节 TOC 标签切换，默认章节。
- 搜索结果、批注定位复用目标导航。

---

## 5. 移动端批注（D-016 简化创建）
- 支持创建 highlight / underline / comment（简化选色）。
- 精选笔记只读。
- 不支持批量管理；提示桌面端。

---

## 6. 移动端分享/导出（D-016 基础）
- 分享：基础创建生成链接。
- 导出：Markdown / .cr 基础。

---

## 7. 保留 / 简化 / 不支持清单
| 能力 | 移动端 |
|------|--------|
| 阅读、TOC、搜索、继续阅读 | ✅ 完整 |
| 创建批注 | ✅ 简化（3 类型简化选色） |
| 精选笔记 | 只读 |
| 分享 | 基础 |
| 导出 | 基础（MD/.cr） |
| Project 单个移动 | ✅ |
| 编辑消息/版本 | ❌ |
| 合并/拆分/批量 | ❌ |
| 导入 | ❌（提示桌面） |
| 复杂 Project 管理 | ❌ |

---

## 8. 移动端细节
- Bottom Sheet 层级：主 sheet / 嵌套 sheet 清晰返回。
- 系统返回键 / 浏览器返回：关闭当前 sheet 而非直接离开页面。
- 触摸选区：长按选文本触发批注工具。
- 输入法：搜索/评论输入避免被键盘遮挡。
- 安全区：`env(safe-area-inset-*)` padding。
- 横屏：正文与 sheet 适配。
- 超长标题：截断 + 点击展开。
- 小屏（<375）：顶栏保持极简不溢出。
- 加载/失败：skeleton + 重试。

---

## 9. 状态设计
Loading / Empty（无最近则无卡片区）/ Error（重试）/ Offline / Conflict（同步）/ 只读提示（批注管理/编辑）。

---

## 10. 涉及文件
| 变更 | 文件 |
|------|------|
| 移动 Reader sheet | `apps/web/components/mobile-reader-sheet.tsx` |
| 顶栏自动隐藏 | `apps/web/features/conversations/use-mobile-header-auto-hide.ts` |
| 移动侧栏 | `apps/web/features/projects/project-sidebar.tsx` |
| 继续阅读卡 | `apps/web/features/reading/recent-items.tsx`, `apps/web/app/page.tsx` |
| 移动批注创建 | `apps/web/features/annotations/annotation-workspace.tsx`, `conversation-reader.tsx` |
| 顶栏动作 | `apps/web/components/reader-header-action-rail.tsx` |
| 样式（安全区/断点） | `apps/web/app/globals.css` |
