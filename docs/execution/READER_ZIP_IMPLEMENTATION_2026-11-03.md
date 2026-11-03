# Reader、富 Markdown 与 Adaptive ZIP 实施记录 — 2026-11-03

> 同日后续状态：[完成度复审](ux-audit-reader-zip-completion-2026-11-03.md)发现并修正
> 九类组合/失败恢复缺口，当前策略为 v13，最终 1,946 UX / 134 API 专项通过。
> 下述 v12、45/13/125 以及全量 API 首轮结果保留为本次复审前的历史证据，
> 不代表最终候选或完整计划已经验收。

## 状态与边界

本记录对应当前 `master` 工作区的未提交源码候选。它接续
[Reader、收藏与离线恢复设计](READER_FAVORITES_DESIGN_2026-11-02.md)、
[富内容设计](READER_RICH_CONTENT_DESIGN_2026-11-02.md)以及 11 月 2 日的
[完成度复审](ux-audit-plan-completion-2026-11-02.md)。

本轮完成源码与本机回归，但没有创建分支、提交、部署、派发 CI 或运行线上
测试。浏览器视觉、真实设备、Web build/PWA、CI、线上验收和部署由用户执行。
未修改用户导入资料，也没有把用户提供的 ZIP 写入应用存储；样本只做了临时
目录中的只读结构检查。

必须保持的不变量：

- `master` 工作区已有修改保留，不为本轮新建分支或重置无关文件；
- canonical 数据仍以 PostgreSQL、migration 和完整轮次语义为准；
- `.cr`、Share URL、Reader/Share/Offline 的附件访问合同、Dexie v2、
  离线包 v1/v2/v3 和既有 reading-list 内部 key/API 不变；
- 不把程序化补偿当作用户滚动，不用不稳定的虚拟行坐标写入阅读位置；
- ZIP 失败时原有导入会话和已完成数据可恢复，不能留下半个 canonical 导入。

## 已实施范围

### 1. Reader 收尾、收藏、帮助与正文体验

批准的 Reader 计划已经沿用现有组件和数据合同完成源码接续：

- 待读入口改成收藏语义，搜索右侧使用星形入口，旧路由/API/key 继续兼容；
- 收藏恢复、批注收件箱、离线失败复核、专注侧栏和帮助面板的状态/失败/
  恢复路径保留明确反馈，并移除合成示例入口；
- 帮助面板的关闭、三行滚动、首/末条记录导航及键盘异步退役边界已接入
  现有 Reader 导航，不抢占普通输入框、按钮和编辑控件；
- Reader 虚拟几何按真实可视区与挂载区间并集识别内部缺段，仅对确认缺口
  做有限重测；布局变化前捕获真实 DOM 行锚点，只有用户滚动/导航意图仍归属
  当前操作时才允许补偿；
- 图片、媒体、details、callout、HTML 卡片等迟到高度变化只触发合并后的
  布局核对，不清空测量缓存，也不把补偿写成新的用户阅读位置。

### 2. Obsidian 与混合富 Markdown

当前渲染链在保留 GFM、公式、Mermaid、脚注、任务列表和代码块的基础上，
增加了有界安全 HTML 与 Obsidian 常用表达：

- 原生 `<details>/<summary>` 折叠，并可在定位时展开匹配目标的折叠祖先；
- `NOTE/TIP/INFO/WARNING/IMPORTANT/CAUTION/DANGER/QUESTION/TODO` 等
  callout 及常见别名，支持 `+` 默认展开、`-` 默认收起；
- `==高亮==` 仅作用于普通文本节点，不穿透代码块、行内代码或跨节点内容；
- 相邻 HTML AST 分片可在同一父节点内安全合并，中间空白不会把一个卡片拆成
  多个错误块；普通 Markdown、代码块和不平衡/超预算 HTML 不跨界拼接；
- HTML 只允许有限文本、列表、表格、链接、图片、卡片布局和受控尺寸；
  脚本、事件属性、iframe、未知危险协议、外部媒体和任意 CSS 不进入 DOM
  执行面；未知/被排除的 ZIP 引用会降级为可见文本而不是当前 Reader 路由；
- 同源图片/音视频保留稳定替代内容和尺寸边界，ZIP 资源必须先绑定真实
  attachment occurrence 才能显示。

渲染器版本已从 `ai-rich-markdown-v11` 提升到 `ai-rich-markdown-v12`，避免
旧投影缓存继续使用不兼容的 AST 结果。

### 3. Adaptive Import ZIP

ZIP 是现有 Adaptive Import 的增量输入，不是新的备份格式。支持两种形状：

1. 专用 conversation export：根目录或单层包装目录内的
   `conversation.md` 与有效 `manifest.json`；Markdown 负责消息边界，
   manifest 负责候选消息/资源元数据，计数不一致只产生警告；
2. 通用 Markdown ZIP：一个或多个 `.md/.markdown` 文档进入既有 profile/
   mapping/review 流程，其他成员默认排除，文档实际引用的本地资源才进入
   附件候选。

实现位于 `apps/api/app/services/adaptive_import/archive_sources.py` 及现有
Adaptive Import route/service/profile。关键行为：

- 检查绝对路径、遍历、重复规范化、反斜杠、盘符/冒号、NUL、超深路径、
  加密项、符号链接/特殊文件、entry/object/展开大小、压缩比、CRC 和解码；
- catalog 使用会话内版本化 sidecar，成员分页读取，分类更新带
  `expected_version`，过期写入拒绝并可回滚；替换/删除只清理成功提交后
  归属该会话的文件；
- Markdown 中的本地 `src`/`href`/图片引用在派生来源中改写为稳定
  `cr-asset://<member UUID>`；被排除或非附件引用改写为惰性的
  `cr-archive-member://<member UUID>`，不会意外命中当前 Reader 路由；
- canonical commit 通过既有 `AssetObject`、`Attachment` 和
  `MessageVersionAttachment` 合同，以有界 staging、MIME/策略扫描、内容
  hash+size 去重和 occurrence 关联持久化真实附件；
- manifest 中不安全或无法规范化的 asset path 产生阻塞
  `MANIFEST_ASSET_PATH_INVALID`，不会被静默忽略；缺失资源、CRC/解码/
  archive 错误都安全失败。

没有新增 migration、canonical 列、Share URL、离线包版本或 Dexie 版本。
用户提供的 ZIP 仅在临时目录做了聚合结构检查，未导入、未改写原文件，也未将
正文、真实 ID 或凭据写入仓库文档。

## 本机验证

命令均在 `C:\Users\86182\Desktop\wkkk\zip-reader-implementation` 下设置
任务专用 `TEMP`/`TMP`；仓库之外的临时文件不属于交付内容。

| 检查 | 结果 |
| --- | --- |
| `corepack pnpm exec pytest apps/api/tests/test_adaptive_import_api.py -q` | **45 passed** |
| `corepack pnpm exec pytest apps/api/tests/test_import_responsiveness.py -q` | **13 passed** |
| `node --test scripts/ux/chatgpt-rich-text.test.mjs scripts/ux/reader-virtual-geometry.test.mjs scripts/ux/reader-keyboard-navigation.test.mjs scripts/ux/reader-navigation-alignment.test.mjs` | **125 passed** |
| `corepack pnpm run lint` | **passed** |
| `corepack pnpm --filter web exec tsc --noEmit --incremental false` | **passed** |
| API Python `py_compile` | **passed** |
| `git diff --check` | **passed** |

### 全量 API 的真实结果

`corepack pnpm run test:api` 使用正确的仓库配置完成了第一轮全量运行：
**5,772 passed, 197 skipped, 2 failed, 2 warnings，耗时约 1:20:32**。
两个失败均为：

- `tests/test_import_responsiveness.py::test_import_analysis_leaves_event_loop_available[blocked-io-adaptive-replace]`
- `tests/test_import_responsiveness.py::test_import_analysis_leaves_event_loop_available[python-cpu-adaptive-replace]`

原因不是 ZIP 内容处理，而是新增 replace 路由在调用被测试替身替换的
`replace_session_artifact` 之前直接读取了最小 `SimpleNamespace` 替身没有提供的
`source_type`/`byte_size` 字段。已将这两个字段恢复到与既有兼容路径一致的可选读取；
随后响应性专项 **13/13** 通过。由于全量 suite 没有在这个窄修后重跑，不能把
第一轮的全量结果写成全量通过，仍需用户决定是否在 CI 或本机重跑全量。

## 待用户完成的门禁

下面这些不是本机源码回归可以替代的内容：

1. Web production build、Playwright/PWA 和 Reader/Share/Offline 浏览器矩阵；
2. 360/375/768/1440px 下图片迟到、快速上下滚动、details/callout/HTML 卡片和
   收藏/帮助/批注收件箱的真实视觉与触屏/IME 行为；
3. ZIP 上传、成员分页/分类、专用导出附件显示、通用 Markdown ZIP 的排除引用、
   重试/替换/回滚和旧数据兼容的线上或 CI 验证；
4. CI、制品、部署、线上健康检查和用户实际 ZIP 端到端导入。

本记录不表示本批已提交或已发布。若后续门禁发现问题，应新增日期执行记录或
更新本记录的状态，而不要把本机测试结果覆盖成生产事实。
