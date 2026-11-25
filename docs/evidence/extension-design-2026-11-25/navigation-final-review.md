# Extension 专项冻结交接 · 2026-11-25

冻结点：2026-11-25 **18:15:34 +08:00**。仓库 `<EXTENSION_REPO>`，现有 `codex/reader-extension`，基准 HEAD `be5e8dabd772809635db345a51c8c15c26b468ed` 加共享 dirty 候选。未分支、未 commit/push/CI/发布，无新 agent。

精确文件 SHA-256 与证据清单：`<TASK_EVIDENCE>\extension\navigator-selection-frozen-20261125.json`。以下均为本地候选，不认证生产状态。

## 本次完成

- **SEL-01 / HTML 接口**：独立 `ReaderCenterSelection` 固定 50 条分页、跨页选择、筛选全选、已选清单移除、分组计数。整个项目仅限身份与完整性明确的本地导出包；私有网页来源永远 partial，即使传入 `complete:true` 也拒绝整个项目。目录变更使旧确认失效，不猜归属。18 项模型回归。
- `center.html` 已提供全部约定 ID：`select-page/select-visible/select-project/selection-view/source-prev/source-more/source-page-status`、`check-bindings/bindings-status`、`task-filter/task-prev/task-next/task-page-status`；CSS 将列表滚动区与主操作、分页分开。**未编辑 center.js**，该集成由 main 完成。
- **NAV-ENTRY**：`routes.js` 区分项目首页和项目对话；`source-control.js` 项目首页显示一个“导入到 Reader”入口，不执行 capture、Reader 查询或目录发现；`openCenter` 仍仅传 `?tab` 提示，不扩大权限。
- `workspace.js` 仅在明确请求后发现目录；项目对话保留 URL 中可验证的项目提示/自身归属，不把聊天标题当项目名，不将正文链接算目录。互相冲突的项目归属保持 unknown，不会被之后重复的单方声明重新认领。原有 `user.id + account.id` 范围门槛保留，缺失仍阻止网页批量读取。
- **NAV-BOUND**：附件固定 **64 条/页**，150 条依次 64/64/22，翻页替换而不累计 DOM；不是采集或搜索业务上限。完整提问悬停/键盘聚焦才调用现有 `loadBody`，只保留一条完整预览，支持键盘滚动和 Escape 返回原问题；失焦、换页、来源变更清掉正文与旧回调。>2 MiB 完整问题逐字相等断言保留。
- **发行包**：`package-reader.cjs` **0.3.0**，加入 `center-selection.js`，保留 center/workspace/batch-worker、绿色 cr 多尺寸图标、原扩展 ID `gihbiofiiflkckcmomddkkjkoifkddfi`，无 `side_panel/sidePanel`，不打包旧 local-picker/local-source。LF/CRLF 独立构建字节一致断言未降低，fixture 复制图标原始字节。

## 当前精确验证

全部日志/报告前缀为 `<TASK_EVIDENCE>\extension\`。

| 门禁 | 结果 | 证据 |
|---|---|---|
| Node 专项（11 个测试文件，含最新 capture/source-file） | **74/74；0 fail、0 skip；exit 0** | `navigation-boundaries-final.log` |
| 原导航真实 Edge（1440/375/320、中英、深浅） | **40/40** | `edge-navigation-Dyn5jt/results.json` |
| 新边界真实 Edge（1440×900 en/light、375×800 zh/light、320×568 en/dark） | **42/42**，运行前后 6 个源码 hash 相同 | `nav-bound-entry-HTBptH/report.json` |
| 实际 0.3.0 unpacked Edge + mock Reader | **7/7**，动态 WAR 稳定 ID / frameId / 父文档 / 单次票据、扩展内短码、父页不含短码、center 可打开 | `surface-release-221704d5/surface-final-runtime-a.json` |
| Git whitespace check | exit 0；现有 Git Windows LF→CRLF 提示保留 | 本次命令输出 |

可复现 Node 命令（先设置 TEMP/TMP 为上述任务目录，使用已配置 Node 24）：

```powershell
node --test tests/reader-center-selection.test.cjs tests/reader-navigation-boundaries.test.cjs tests/reader-navigation.test.cjs tests/reader-navigation-source.test.cjs tests/reader-batch.test.cjs tests/reader-capture.test.cjs tests/reader-stream.test.cjs tests/reader-transfer.test.cjs tests/reader-contract.test.cjs tests/reader-surface-package.test.cjs tests/reader-distribution.test.cjs
```

浏览器入口：仓库 `scripts/reader-navigation-check.cjs`；任务目录 `nav-bound-entry-check.cjs`；实际扩展包的 `surface-release-221704d5/check.cjs` 与 `package.log`。后一构建固定 loopback 测试源，**不是用户安装包**。

最新合法流式大包可跨仓复用：

`<TASK_EVIDENCE>\extension\reader-transfer-2tXVdb\import.zip`

- ZIP **121,218,852 B**；单附件 **105,906,195 B**；单正文 **3,456,033 B**；**50,001 条**。
- 首条正文有真实 `assets/synthetic.bin` 引用，声明资源与正文一致。
- SHA-256 `e71501690246fe4228843ddaf087a2efe0c9752a456f36407fca8567553795b6`。
- 同轮验证响应丢失先查 receipt、同 key/offset 续传、无重复分块、错误 digest/binding 停止、阶段切换先 flush 最后计数、虚拟历史挂载不抹读取反馈。

### 截图（已亲自查看）

- `nav-bound-entry-HTBptH/1440-en-US-light-full-question.png`
- `nav-bound-entry-HTBptH/320-en-US-dark-full-question.png`
- `nav-bound-entry-HTBptH/375-zh-CN-light-files-fixed-page.png`
- `nav-bound-entry-HTBptH/375-zh-CN-light-project-entry.png`

三个视口都实测正文宽度变化 **0 CSS px**，浮层不越视口、不盖输入框；没有以桌面模拟代替手机真机验收。

main 的 `main/center-layout-J8tOY4/report.json` 16 项为其独立证据：150 条选择、固定 50 DOM、320/375 主操作、冲突 skip。本人核对其报告，HTML/CSS/selection 当前 hash 与该记录相同；不冒称由我运行。

## 失败及真实缺陷保留

1. `navigation-boundaries-a.log`：28 项断言虽通过，但 JSDOM 关闭后 MutationObserver 抛错，因此不当作干净通过。修复新 fixture：清理前 disconnect，运行异常显式断言为 0。未删除旧日志。
2. `nav-bound-entry-85JzNJ/report.json` / `nav-bound-entry-browser-a.log`：真实 Chromium 预览内 Escape 触发同步 focusout，重复 remove 抛 `NotFoundError`。修复 `overlay.js:132`，先解除 ownership 再删 DOM；保留焦点返回、防重入回归。绿色为 HTBptH，未放宽原断言。
3. 更早动态 WAR、center 选择/冲突死路、附件累计 DOM、CI fixture ZIP 竞态失败均继续保留。

## 尚未闭合 / 不越权的发布边界

**本专项没有剩余已知可复现代码阻塞。整体发布资格仍 pending：**

- 主进程须对两仓冻结候选做完整测试/CI；这里 74 项不是全仓 suite，更不认证之后的改动。
- **真实 ChatGPT 登录页、账号/工作区标识是否可提供、真实目录、真实分支/媒体 DOM、平台路径适用性没有验收。** 本轮浏览器数据全为合成；不能宣传真实网页批量导入已验收。缺少明确 scope 继续拒绝网页批量，不降低门槛，ZIP 路径不是网页来源验收的替代。
- **真实 Chrome unpacked 加载超时仍非通过**（main 已报告普通 Chrome binary CLI 加载能力缺失）；main 的 Chrome 合成导航 40 pass 不等同真实扩展安装。Edge actual unpacked 已验证。
- 已批准的完整设计不能仅因本专项完成而宣布 20 个状态全达标。新增缺口已关闭的依据见上；其他系统/API/队列/授权与文档由 main 冻结复核。

## 事实面与冻结边界

| 面 | 状态 |
|---|---|
| 本专项代码与测试 | changed-and-verified；已冻结 |
| 真实 Edge 合成运行态 | verified-current；非真实账号/非生产 |
| 两仓全测、CI、Release、部署 | pending，由 main 负责 |
| 主线文档、规则、全局/生成记忆 | out-of-scope，未写 |
| 工作区 | 有意保留 dirty 集成改动与全部证据；未清理、未删备份或产物 |

后续不再改这些文件，除非 main 明确回派阻塞修复。
