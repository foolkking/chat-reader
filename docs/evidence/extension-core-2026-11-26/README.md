# Chat Reader 0.3.0 核心整改候选与人工验收

**后续候选：** 如需「选择／新建同名 Reader 项目」，请使用[项目映射补充包和验证记录](project-mapping.md)。下表保留补充改动前的精确包和证据，不适用于验证新增功能。

2026-11-26，Asia/Shanghai。两仓工作树在 `codex/reader-extension`。本地交付根目录为 `E:\chat-reader-temp\extension-resume-20261126\delivery-final`。本轮使用相同版本号与扩展 ID；请用 ZIP 摘要区分原安装版和候选版。

| 用途 | 交付根目录内的文件 | SHA-256 |
| --- | --- | --- |
| 绑定现有 Reader 地址的私有候选 | `private/chat-reader-0.3.0.zip`，可直接加载的目录为 `private/extension` | `eb5b31061f2f325581faccab6bbef4dc98530bef9671ce6f1e2120472c69be67` |
| 在自有隔离实例上做全链路验收 | `loopback-18383/chat-reader-0.3.0.zip`，目录为 `loopback-18383/extension`，固定连接 `http://127.0.0.1:18383` | `642dc54f631780cbe241adfdcaef2e690d3ec50a1fe78b4fc1c6e70371ac5eb0` |
| 两包的本机代码参考 | `reference/chat-reader-0.3.0.zip.sha256` | `236f50cbd0c112ac9416917d9cd5c9eec156773a83f723276a451a137c525ec4` |

每包 58 个文件。私有包在两个新目录独立构建后完全相同，两个安装包均经过逐成员回读、固定地址和本地参考摘要核验。旧桌面安装目录、浏览器数据和生产服务由用户保留。中性参考来自本次本地构建；正式签名和远端 CI 资格仍需独立取得。用于自动验收的临时数据库和服务已随各次回归退出，18383 是为人工验收预留的配置。

## 人工验收从哪里开始

在专用测试浏览器配置中使用「加载已解压的扩展程序」选上表对应目录，刷新测试来源页。当前部署记录是 Reader v0.1.10。核对新版范围追加、失败恢复和设备结果明细时，需要同一候选的 Reader API、worker 和 Web，schema 仍为 `20261125_0065`。用测试对话和测试目标可以直接检查以下结果。

| 操作 | 可据以验收的结果 |
| --- | --- |
| 保存含图片或附件的对话，在 Reader 打开最终记录 | 先核对消息角色、顺序、正文，下载可用文件对比内容。来源确有缺件时，核对缺件记录、部分内容及同意动作。 |
| 保存时观察一次弱网或中断，然后回到同一任务 | 实测来源量、附件和包字节可分别查看。续传从服务端确认的偏移开始；核对原收据后只生成一份数据。系统完整性错误显示停止阶段及可复制诊断。 |
| 在长对话从末尾跳到较早的轮次、重复标题、搜索命中和附件 | 核对最终可见的原文及所属回答；滚轮或触摸取消后不被拉回。未找到确切附件时显示定位到所属消息。再试一次分支切换和延迟挂载。 |
| 将超过 250 条的跨页选择追加到测试目标，再交同一来源 | 页面显示实际选中总数；Reader 核对目标、当前末尾及范围后才确认。比对旧首尾、新增量和第二次跳过量。老 Reader 会明确提示超限。 |
| 从三横线进入三个视图，在窄幅及展开状态选择项目并切回 | 外部保存条收起，同一个保存控件在工作区内可用。勾选、来源和任务保持对应；刷新来源后新增项目不会自行勾选。换账号后不显示上一账号的进度。 |

真实长对话、真实附件交付、真实网络中断、最终候选在个人账号上的布局与导航由用户验收。原任务已在指定 Chromium 的一条真实短对话完成来源对照和定向导航观察；当时的安装包、窗口状态和局限详见改前审查。[真实页面记录与九图对照](../../execution/ux-audit-extension-core-2026-11-26.md)

## 三轮复审

| 复审 | 发现并修复 | 核验方式 |
| --- | --- | --- |
| 数据与写入 | 图片警告的备用正文没有进入原始封包；追加超过 250 条时能力没有传到真正写包的后台。保留缺件、严格字节索引及旧合同门槛。设备收据只返回实测结果。 | 从安装目录读取 16 个实际程序模块，模拟来源 DOM/会话/OPFS，生成两个 ZIP，逐字节交给真实 loopback API、PG 和 640 MiB worker。补验完整两个附件、4 MiB 分块断线续传、重复来源、损坏索引拒绝及设备隔离。 |
| 界面与操作效率 | 同源页不同任务曾串用累计量，来源页追加没有保存自己的尝试，回到页面还会停留在「待确认」。轮次折叠/定位、任务停止阶段和负滚动坐标分别修复。紧凑与展开批量视图共用选择与任务。 | 进度、后台及选择定向 57/57；包含反向滚动在内的导航 61/61；批量选择与生命周期 48/48。测试含跨页、角色、整轮、Shift、完整预览、旧能力、3,007 个来源项目、切换账号；个人浏览器的最终渲染留给人工。 |
| 权限、稳定性与安装 | 私有 frame、来源文档、任务和账号分别校验；客户端提交不能替代已登录 Web 的追加确认。出现目标末尾变化时保留勾选、清除旧同意；未知结果先读取原收据。快照门禁补入未跟踪的 Python 模块并校验原件和副本。 | 安装包定点权限、源码清单和离线重建核验；正确设备读回结果、设备确认得到 409、其他设备读取受保护的收据得到 404；重复提交、坏包零写入和隔离清理分别检查。 |

## 范围和证据

- **G0 / G1**　同一真实短对话此前由原导出器、已安装 Reader 和候选解析器对照得到 4 条消息、12,484 字节 UTF-8 正文。最终包的合成缺图 ZIP 经过实际服务端并读回两条消息，完整性为 `partial`。另一个完整样本的附件逐字节读回。损坏索引拒绝后 canonical 写入为零。
- **G2**　读取、页、节点、正文、附件、未解析资源、包、已确认上传量及服务端状态各自保留。「耗时」取自扩展的本地记录；设备收据不提供用户在 Web 确认耗时或精确的服务端执行时长。来源页和私有资料库使用同一组可公开字段；旧追加收据缺少结果时显示「无结果明细」。系统完整性错误不能通过重交同一包解决。
- **G3 / G4**　新版源码身份、可见正文和稳定 DOM 锚点支撑目录、搜索与附件跳转。真实短对话的四次正常窗口跳转和最小化窗口失败分别保留。最终包的 251 条选择从真实后台封包路径生成；隔离 Web 确认后逐行核对角色及正文 SHA，第二次跳过全部。另跑 1,001 条范围追加、末页读取和旧数组的 250/251 边界。
- **G5**　折叠态保留三横线、保存和更多，展开后工作区只有一个保存控件。导航、资料库、导入复用现有私有页面。批量的来源刷新区分删除、归属变化和新增，不假报「未导入」。较早的隔离浏览器测试已观察到两个私有 frame 保活，当前源码的布局和操作逻辑另有定向测试。
- **G6**　插件全量执行 449 项，386 通过、63 个已有私有样本跳过、0 失败，输入前后无漂移。两仓均为未提交工作树。Reader 的 69 项 API、18 项 Web 选择/恢复、3 项快照、资格自检 Python 6 项及 JS 3 项均通过；另有隔离 PostgreSQL 回归。586 个源码与配置输入的独立 Web 快照完成 `lint`、`typecheck` 和 `next build --webpack`。CI 的 7,495 是预期收集数。具体运行、命令、时间、输入清单摘要及退出码见本机证据索引。[脱敏运行索引](verification.json)

### 复现安装包到数据库的两条链路

以下命令只使用已知的本机 loopback 地址、已有依赖和新的测试目录。实测使用 Node v24.22.3、`E:\anaconda\python.exe` 与本机 Docker Desktop。两次 HTTP 门禁串行运行，每次使用独立的临时 PostgreSQL、API 和 worker。命令遇到非零退出码时应保留本次目录。

```powershell
$taskRoot = Join-Path 'E:\chat-reader-temp' ('core-check-' + [guid]::NewGuid().ToString('N'))
$forkRoot = 'E:\1project\chat-intelligent-ui-exporter'
$readerRoot = 'E:\1project\chat-reader'
$node = 'C:\Users\86182\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$python = 'E:\anaconda\python.exe'
New-Item -ItemType Directory -Path $taskRoot | Out-Null
$env:TEMP = $taskRoot
$env:TMP = $taskRoot
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PATH = (Split-Path $node) + ';' + $env:PATH
foreach ($dir in 'install','capture','http-save','http-append') {
  New-Item -ItemType Directory -Path (Join-Path $taskRoot $dir) | Out-Null
}
Set-Location -LiteralPath $forkRoot
& $node scripts/package-reader.cjs http://127.0.0.1:18383 "$taskRoot\install\extension" --zip
if ($LASTEXITCODE) { throw 'package failed' }
& $node scripts/reader-wire-fixture.cjs "$taskRoot\install\extension" "$taskRoot\capture\fixture"
if ($LASTEXITCODE) { throw 'capture failed' }
Set-Location -LiteralPath $readerRoot
& $python -B scripts/extension-beta/backend-gate.py --parent "$taskRoot\http-save" --fork $forkRoot --diagnostics --parser-fixture "$taskRoot\capture\fixture\installed-image-partial.expected.json"
if ($LASTEXITCODE) { throw 'save gate failed' }
& $python -B scripts/extension-beta/installed-append-gate.py --parent "$taskRoot\http-append" --fork $forkRoot --evidence "$taskRoot\capture\fixture\installed-append-251.expected.json"
if ($LASTEXITCODE) { throw 'append gate failed' }
```

## 已保留的失败

本机原始证据根目录为 `E:\chat-reader-temp`。`extension-handoff-20261126\core\host-append-red.log` 保留后台拒绝第 251 条的失败；`extension-resume-20261126\progress-tree-red.log` 保留串用计数及未绑定追加任务的两个失败。`reverse-red.log` 保留反向容器中已挂载及虚拟跳转的两个失败。首次插件全量 381 通过、1 失败、63 跳过，HTML 卡片耗时为 6.26 ms，断言仍为严格小于 5 ms；最终全量按相同并发策略通过，单次复测无法确定首次超时原因。

`lab-save` 第一次缺少测试证据的 `inputs` 字段，门禁退出 1；修复生成器后保留了两次输出。`lab-append` 第一次构造单消息目标，真实 API 按原本的两消息创建合同拒绝并返回 422；回归改用合法的一问一答目标，并核对原始两条记录都未被改写。旧浏览器的最小化失败、之前 30 秒超时和错选嵌套控件的记录均留在原审查。没有通过降低阈值、删断言或增添跳过取得绿灯。

## 外部定位实现的本地源码核对

按先前规格中给出的仓库名，以配置好的 Git SSH 只读取固定源码。没有使用搜索引擎、GitHub 网页或其他认证方式；没有运行或引入第三方代码。

| 仓库及固定提交 | 核对的文件与机制 | 本项目的取舍 |
| --- | --- | --- |
| `ICermanRan/ChatGPT-Mini-Map`　`b935e3fae2c9fa28ac230ceb0ad13712dc291296` | `LICENSE` 为 MIT。`navigation.js` 比较候选滚动容器、已挂载角色和可达坐标；检查连续观察中的容器偏移与锚点位置，支持负 `scrollTop`。 | 给本项目增加正向/反向坐标换算的两个实测回归；沿用现有消息身份及可见正文检查。 |
| `bujue3709/GPT-Conversation-Toolkit`　`4037e77f46ab1ffc9f8e1e4a49912b8a4ce70cdd` | `LICENSE` 为 MIT。`features/virtualized-jump.js` 使用身份候选、挂载窗口及反向坐标；`features/virtualizer-bridge-page.js` 探测页面虚拟列表的跳转方法。 | Reader 使用实际 DOM 和现有来源绑定，不加入页面内部对象桥接或新的页面权限。 |
| `boabab/conversation-overview`　`445a0e2d53fcfcf57b6297efc56346b2a773213a` | `conversation-overview.user.js` 从角色节点构建轮次并读回答标题；该提交的文件树无独立 LICENSE，脚本头也未声明授权。 | 只比较层级行为，未复制代码或界面资源。 |
