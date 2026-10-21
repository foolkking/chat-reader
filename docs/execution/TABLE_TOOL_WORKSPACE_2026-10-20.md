# 表格工具真实源码工作区续验 — 2026-10-20

## 本轮边界

接续[第一轮表格双向编辑](TABLE_TOOL_EDITING_2026-10-20.md)，保持原目标与
无预算、仅本地、不推送/CI/部署的约束。本轮不以原 13 个独立对话框场景或
纯 CodeMirror history 测试，冒充真实源码工具栏、表单及弹层集成已经通过。

新增浏览器路径直接运行实际 `SourceEditorWorkspace`、`FloatingWorkspacePanel`、
`EditMessageForm`、命令工具栏、`@uiw/react-codemirror`、CodeMirror state/view/
commands、表格面板及共享 Markdown 链。React Query 也为实际组件。

只有边界外内容使用明确适配：

- API 读取返回合成空附件；编辑 API 捕获客户端 payload 并返回合成新版本。
  未预期的其他 API 调用会抛错，不连接真实 API 或账户。
- Next 的 client-only dynamic loader 用实际 React lazy/Suspense 适配，不模拟
  CodeMirror。临时 bundle 将动态导入内联，不声称验证了 Next 路由/分块加载。
- 无关噪声清理弹层、assistant-ui/Shiki/Mermaid/preferences 为惰性或受控适配。
  不是认证、权限、服务器持久化、附件上传或噪声流程验收。

所有生成内容仍在本任务 `wkkk` 子目录，进程级 TEMP/TMP 隔离；没有新依赖、
API、migration、用户资料或生产配置变化。原有工作树和前一轮文档改动保留。

## 从真实失败得到的三项修复

### 1. 顶部撤销/重做按钮原来没有执行命令

旧代码把模拟 `keydown` 派发到 CodeMirror 的外层 `view.dom`，而键盘处理器位于
内部编辑内容节点；事件不向子节点传播。实际顶部 Undo 点击后，修改后的表格仍在。

基线：原 13 个对话框场景通过，新的真实工作区 Undo 场景失败。不是忽略历史字段，
也不是撤销时长不足。改为调用已经直接依赖的 `@codemirror/commands` 的
`undo(view)` / `redo(view)`，不新增依赖、不再制造平台相关假键盘事件。

修复后，实际工具栏单次 Undo 恢复包括周围正文在内的精确原文、保存按钮恢复未改
状态；Redo 重新得到完整变更。表格 Apply 仍只修改草稿，不写服务器。

这也修复同一顶部按钮对普通源码编辑的共享执行路径，不改变保存/消息版本语义。

### 2. 表格弹层会被底层快捷键抢焦点

Undo 修复后，下一条场景复现：单元格输入 `Ctrl+Alt+C` 打开了底层命令面板，
把焦点移到 Bold，输入框因 blur 退出编辑。不是输入框丢失身份。

工作区快捷键现在拒绝已被处理的事件，以及来源于任意 `aria-modal="true"` 对话框
的事件。表格和附件选择等嵌套表面持有焦点时，不在其背后打开命令面板。工作区内
正常源码输入位置仍可使用原快捷键。

### 3. 入口名称与单一规范表格工作流不一致

真实入口仍显示“插入表格 / Insert table”，但面板已按用户要求移除创建模式。
浏览器无障碍名称断言复现不一致，改为“表格工具 / Table tool”；tooltip 与
accessible name 沿用同一项标签，中英文一起验证。

## 验证

浏览器专项最终 **20/20**，保留前轮 13 个场景，新增 7 个真实工作区场景：

1. 通过真实命令面板打开工具，Apply 写入 CodeMirror；顶部 Undo/Redo 精确往返，
   从未调用编辑 API。
2. 表格输入框的快捷键不打开底层工具、不移走焦点。
3. 中英文工具入口名称与面板一致。
4. 单元格 Enter、真实表单 `requestSubmit()` 均不越过工具保存；
   Escape 只关闭对应层，底层源码预览保留，焦点回到实际编辑器。
5. 迟到 CodeMirror 更改使原表格草稿失效；草稿保留，明确重新预览后应用保留迟到
   正文，不能覆盖新内容。
6. Apply 不保存；用户点击真实 Create 后只产生一个规范化客户端 payload，
   保持 `baseVersionId`、`create_version` 和前后正文；合成响应建立新的未改基线。
7. 375×812、真实 `hasTouch` 的 Chrome context 能从实际移动源码面板打开表格，
   修改单元格并应用；页面不横向溢出，没有编辑 API 调用。

页面异常与 console error 均为 **0**。实际截图已查看：

- [375px 真实工作区中的表格编辑](../evidence/table-tool-workspace-2026-10-20/workspace-mobile-light.png)
- [实际源码应用与合成保存响应后的桌面工作区](../evidence/table-tool-workspace-2026-10-20/workspace-desktop-light.png)

本轮三项修复后，完整 service-free UX 按顺序重跑 **67 文件 / 1,450 通过 /
0 失败 / 0 跳过**，Web lint、非增量 typecheck 和单 worker build 全部 exit 0。
退出码、时间、源码绑定与精确结果由
[独立证据](../evidence/table-tool-workspace-2026-10-20.json)记录。前轮的同数
检查点单独保留，不当成本轮重跑。

浏览器脚本现在在开始时把结果标为 `not_completed`，场景失败记 `failed`，
只有全部完成且页面/控制台错误为空才记 `passed`，避免失败重跑继续留下旧成功 JSON。
失败日志保存在任务临时目录；仓库证据只保留合成场景名称和必要结果。

## 仍未验收

- 未运行完整认证 Reader 页面、真实 HTTP/服务器保存、权限/冲突/版本并发、
  附件上传、IndexedDB、PWA 或 Share/Offline 全流程。
- 未验证 Next 实际路由分块、Safari/Firefox、OS 软键盘、完整 WCAG/读屏。
- 未做服务器 RSS/cgroup/OOM、Linux PID 1 或 60 分钟低内存测试。
- 第一轮纯转换/SSR 的 **42/42** 和独立面板 **13/13** 证据仍保留原范围；它们
  不能反过来证明旧顶部 Undo 原来可用。本轮以新复现/修复证据补上这一空白。
- 未推送、未启动 CI、未部署。持续优化目标仍活动且无预算上限。
