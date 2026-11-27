# 按来源项目选择或新建 Reader 项目

2026-11-26，本机候选，未部署。私有可加载目录位于 `E:\chat-reader-temp\extension-project-mapping-20261126\delivery-r2\private\extension`，同级 `chat-reader-0.3.0.zip` 的 SHA-256 为 `07b771c41d3ccc264d889e7af044fc45974836822e743bde6d9df309c04a946f`。保留原来版本号与扩展 ID；两个独立构建一致，每包 59 个文件。未改已安装的桌面插件或浏览器配置。

## 怎样使用

1. 勾选要导入的对话，进入「确认 Reader 保存位置」→「按来源项目分别选择」。
2. 在每行的下拉框选已有 Reader 项目。确有同名活动项目时也可以点「选用同名项目」。没有时点「新建同名项目…」；已知的项目名预填，可修改。只有来源编号时，行中提供一条已选对话供辨认；填真实项目名，不必照抄编号。归属未知不等于未归类。
3. 在 Reader 核对账号和名称，点「确认并返回导入」。同名已存在时复用，不重复创建；新项目也出现在其他行的下拉框中，但不改它们已选的目标。旧 Reader 没有这个确认页：打开 Reader 侧栏新建，在原导入页点「刷新项目」即可回填。
4. 核对各行后再点「确认导入」。创建项目本身不会导入对话；取消导入也不会删除已在 Reader 确认创建的项目。已有绑定不因映射被移到另一项目。提交任务的实际位置可在结果中核对。

## 范围和证据

用户截图暴露的障碍是目标行只有下拉框，又只显示来源编号。原实现仅列出活动项目；全局「管理项目」不携带行、名称或返回目标。本次不新开设备写权限：已配对设备读取目录，显式创建属于已登录 Reader 会话。活动项目按账号、精确名称和稳定 ID 核实；重名归档不自动恢复，传输只接受已确认 ID 或未归类，不接受名称占位符。

本机测试根目录为 `E:\chat-reader-temp\extension-project-mapping-20261126`。同日早一版的[整体整改验收](README.md)和[原始回执](verification.json)均保留。个人账号、生产实例及独立的远端 CI 不在本轮验证范围。

| 实际使用的边界 | 验证了什么 |
| --- | --- |
| 安装包 → Edge 原生确认窗口 → Next → 真实 API/PostgreSQL/640 MiB worker | 用合成官方格式导出文件执行三行映射。第一行选用已有同名项目，第二行在 Reader 确认新建，第三行只有编号，先核对空白名称栏，再选刚创建的项目。开启确认页不产生写入，返回仅回填发起行。真实收据的保存与当前项目一致；Web 再逐项目读回 1＋2 条对话、6 条消息的角色和完整正文。 |
| 两个并发 Web 确认与重复来源 | 同账号同名返回同一个 ID；旧来源再次提交到不同目标也保留原项目。归档、默认项目重名均不恢复／新增；设备令牌本身不能创建。真实实例确认收到 409、403 和 422，分别对应这些冲突、权限与无效输入。 |
| 本机交互和旧版本 | 定向 63/63，含精准回填、放弃创建、旧 Reader 手动新建后刷新、账号/来源切换、过期回执、来源标题冲突，以及旧网址别名的记忆映射。只有一个一致的旧目标时保留，包括明确的「未归类」；相互冲突时不猜测。旧版本分支使用模拟能力，不是线上实测。中英文确认页校验账号不符不展示目标名或确认按钮；写入结果未知时回到导入页刷新目录，不把再次写入称为“核对”。 |
| 尺寸与键盘 | 安装版本在 930 / 375 / 320 px 均检查各目标控件范围；编辑期间最终导入不可用。已检查[桌面实际截图](mapping-930.png)、[紧凑截图](mapping-320.png)和[Reader 确认窗口](reader-confirmation.png)。未进行读屏器或个人账号可用性测试。 |

可复现的浏览器门禁在 Reader 仓库 `scripts/extension-beta/installed-projects-gate.py`，调用 Fork 的 `scripts/reader-project-mapping-check.cjs`。使用新建的获准临时子目录、已有本地依赖、一份工作树构建的 Next 快照和用同一参考摘要核验过的 loopback 安装包。最终浏览器门禁使用 `127.0.0.1:28080`（Next）及 `127.0.0.1:18872`（API）。仅在这两个端口空闲时运行；不接管其他进程。测试后撤销合成设备，移除本次服务；没有修改其他容器或个人浏览器配置。

在本机复验同一组合（不覆盖原证据）：

```powershell
$evidence = 'E:\chat-reader-temp\extension-project-mapping-20261126'
$run = Join-Path 'E:\chat-reader-temp' ('project-mapping-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $run | Out-Null
$env:TEMP = $run; $env:TMP = $run; $env:PYTHONDONTWRITEBYTECODE = '1'
$env:PATH = 'C:\Users\86182\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
Set-Location -LiteralPath 'E:\1project\chat-reader'
& E:\anaconda\python.exe -B scripts/extension-beta/installed-projects-gate.py `
  --parent $run --fork 'E:\1project\chat-intelligent-ui-exporter' --web-build "$evidence\web-02" `
  --install "$evidence\delivery-r2\loopback-28080\extension" --port 28080 `
  --parser-fixture "$evidence\delivery-r2\fixture\installed-image-partial.expected.json"
if ($LASTEXITCODE) { throw '保留本次目录，检查 receipt.json；不要改用现网重试。' }
```

[本轮脱敏运行索引](project-mapping-verification.json)记录两仓基础 SHA、未提交工作树的源码清单摘要、安装包摘要、测试命令、运行标识、时间、退出码及保留的失败。旧 CI 或上一版安装包不作为此包的远端资格。

最终组合：`reader-g1-194aa673c73b` 完成 12 项安装版浏览器检查、20 项 PostgreSQL 回归与独立正文读回；`reader-g1-871c4daafba8` 完成 36 项 PostgreSQL 回归、1,001 条范围和安装包生成的 251 条追加，重复提交跳过全部 251 条。两次均退出 0。Reader 最终 Web 快照通过 lint、typecheck、build 及中英文 Playwright 8/8；schema 仍为 `20261125_0065`。两处临时环境均已退出。

## 保留的失败和未验证项

- 添加映射操作前，四个目标行行为回归因没有对应按钮而失败。早一版全量插件测试的 HTML 卡片耗时为 5.12 ms，未达到原有 `< 5 ms` 门槛；保留失败，未改产品无关代码、并发策略或断言。最终候选按原策略执行 457 项，394 通过、63 个既有私有样本跳过、0 失败。
- 第一次尝试的隔离 Web 端口 `18483` 无法绑定（复核 errno 10048）；未停止占用者，改用 `28080` 并重建 loopback 包。首次浏览器夹具在首个业务断言前退出，未算作浏览器通过；显式等待异步文件目录完成后重新执行。未采用预置 DOM 或模拟回调替代真实安装版确认窗口。
- 第一次追加 PostgreSQL 回归中，业务断言预期尾部变化已产生失败收据，实际当时是 `queued / waiting_resources`（35 通过、1 失败）。保留这次证据；没有得知是哪一项资源检查触发，不能据此断定内存不足。原断言、调度策略及 640 MiB worker 限额不变，后续各门禁串行重跑。
- 本次安装包只能证明在本机隔离实例上的行为，不代表用户当前服务器已提供新 Web 确认页或用户已更新插件。个人账号的真实来源项目名、长对话和附件仍由用户验收。
