# 只在本机运行的插件验收

<a id="source-lookup"></a>
### 来源识别：分开验证界面和真实保存

两个脚本都先对已指定的 `READER_TEST_EXTENSION_SHA256`、ZIP 的每个成员和实际安装目录做核验，都用新的临时 profile。按下方准备 `$T`、`$Chrome`、`$Edge` 及绑定 `http://127.0.0.1:18383` 的扩展。每次换一个新的结果目录名；以下两组串行运行：

```powershell
$env:TEMP=$T; $env:TMP=$T; $env:READER_TEST_LAB='beta'
node scripts/extension-beta/source-state-browser.cjs $Chrome "$T/extension-build" $T chrome-zh-lookup-01
node scripts/extension-beta/source-state-browser.cjs $Edge   "$T/extension-build" $T edge-en-lookup-02
node scripts/extension-beta/source-receipt-api.cjs $Chrome "$T/extension-build" $T chrome-zh-api-receipt-01
node scripts/extension-beta/source-receipt-api.cjs $Edge   "$T/extension-build" $T edge-en-api-receipt-02
```

第一组不需要 Reader 服务，验证默认不查询、手动查找、同一文档换账号和允许／关闭自动识别的真实控件；只使用合成的 Reader 响应。第二组需要下方 **beta 专用**网关、API、PostgreSQL 和 worker，不需要 Web 前端：通过正常 API 授权两名一次性普通用户，用真实插件保存合成来源，并核对原始 ZIP、派生文本、最终消息、附件字节及所属账号；切换账号时保持原来源标签不变。完成后撤销本次创建的设备授权。回执不记录正文、用户标识、Cookie 或令牌。这两组不能代替含 Web 授权页、侧栏、选内容并追加以及 Context 下载的整轮 `browser.cjs`。

<a id="project-export"></a>
### 单独验证 Reader 项目批量导出

这条路径**不需要安装插件或登录 ChatGPT**。沿用下方一次性配置生成器和 Compose 模板，在独立任务目录使用新副本，固定项目名 `reader-scope-1123`；不能连已有开发或生产数据。先检查 18483–18485 空闲。模板内 `PUBLIC_WEB_BASE_URL`、gateway 端口改为 `http://127.0.0.1:18483` / `127.0.0.1:18483:80`；API 只绑定 `127.0.0.1:18485:8000`。让 Nginx 副本转发到 `host.docker.internal:18484`，使用当前 Reader 的 API 与 Alembic 绝对路径只读挂载，其他卷只指向新任务生成的 `BETA_DATA`，PG 保持 tmpfs。主机 Web 从同一源码副本启动在 `127.0.0.1:18484`，`API_INTERNAL_URL=http://127.0.0.1:18485`。不要输出生成的 `.env`。原 18383 内测项目独立，不替换它的文件或端口。

仓库根目录运行 `node scripts/extension-beta/project-export.cjs chromium` 及 `node scripts/extension-beta/project-export.cjs edge`。脚本在固定实例、实验库名与临时存储同时匹配才创建合成数据；浏览器只接触该本机源。保留各次输出子目录，不把失败回执替换成成功回执。

### 设备授权达到上限的恢复路径

该场景只允许在 `reader-scope-1123` 隔离实例使用。按下方完整浏览器流程启动 `browser.cjs` 时，标签包含 `device-limit`（例如 `edge-zh-faults-excerpt-only-device-limit-30`），脚本才会运行 `device_limit_fixture.py`：它再次核对精确 loopback 来源、专用测试扩展 ID 和合成账户，并只创建固定的 32 条待交换授权记录。浏览器随后实际提交授权请求并观察服务端 `409`、本地化错误提示、恢复链接及 375px 布局；之后 fixture 仅按测试账户、扩展 ID、32 个确定的测试哈希及无 access/refresh 凭据条件清除这批记录，复查无剩余后才继续正常授权。任何 scope 或行数不符都会拒绝清理。

每轮开始也经该隔离测试账户的正常、已认证设备 API 撤销遗留授权，并验证列表为空；回执只记撤销数量和响应码，不输出设备 ID。不要把此 fixture 指向 beta 外的其它实例，不要为使测试通过而提高正式设备上限；保留失败目录与截图。

**同一末尾的并发写入（仅 scope PostgreSQL）：**在 Reader 根目录设 `$env:READER_TEST_LAB='scope'`，运行以下命令。它新建两个合成原始消息；第一事务写入未提交的第三条，另一连接仍持有旧版本，第三连接确认实际锁等待才让第一事务提交。后写者必须得到业务冲突 `409` 且只有 3 条消息；不把数据库异常当作正常拒绝。独立的 `test_selective_append.py` 另用真实追加 worker 覆盖编辑请求已加载旧目标的路径。

```powershell
node -e "const l=require('./scripts/extension-beta/lab-target.cjs'); if(l.project!=='reader-scope-1123')throw Error('scope only'); require('node:child_process').execFileSync('docker',l.fixtureArgs(),{input:require('node:fs').readFileSync('scripts/extension-beta/verify_tail_writers.py'),stdio:['pipe','inherit','inherit']})"
```

需要桌面 Windows、Docker Desktop、Node 24、Python、Reader pnpm 依赖、Chrome for Testing 和 Edge。浏览器测试**创建全新 profile**，拒绝复用任务目录；DNS 阻断外网，以合成的 ChatGPT 来源驱动真实扩展。Reader、NGINX、PostgreSQL、worker、授权窗口和下载不模拟。仅在个人访问受限的临时目录执行。不要使用生产 `.env`、数据库、导入资料或已登录浏览器。

插件验收默认使用 `18383` 的 beta 实例。另一个同样隔离的 `reader-scope-1123` 实例要显式设进程环境 `READER_TEST_LAB=scope` 并把插件构建到准确的 `http://127.0.0.1:18483`；只能使用上述两组固定端口及容器，脚本不接受任意 URL。真实上传、中断、恢复的整轮测试不使用 `-excerpt-only`。带该标记的运行**仅用于定位选择性追加故障**，不代替整轮。两个浏览器按顺序运行，因为配置预设和故障注入涉及同一实验账号、同一个 worker。

1. 检查 18383–18385 空闲，没有同名 Compose 项目。准备本机可信 API 依赖镜像（例如 `docker build -t chat-reader-extension-lab apps/api`），以及 Compose 中声明的两个基础镜像。没有镜像时不要把生产地址作为替代。
2. 准备独立、未使用的任务目录和一次性配置，代码不输出密码。例如从 Reader 仓库根目录：

   ```powershell
   $T='E:\chat-reader-temp\reader-browser-rehearsal-new'
   python scripts/extension-beta/init_lab.py $T chat-reader-extension-lab
   $env:TEMP=$T; $env:TMP=$T
   docker compose -p reader-ext-beta-1123 --env-file "$T/rehearsal.env" -f scripts/extension-beta/compose.yml up -d
   ```

3. 在独立的本地源码副本构建 Web（不拷贝生产配置/数据库）：`AUTH_ENABLED=true`、`API_INTERNAL_URL=http://127.0.0.1:18385`、`NEXT_TELEMETRY_DISABLED=1`；从 `apps/web` 用 `node node_modules/next/dist/bin/next build --webpack`，然后 `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 18384`。网关 `http://127.0.0.1:18383/login` 须返回 200。
4. 在配套 Fork 的待验源码执行 `node scripts/package-reader.cjs http://127.0.0.1:18383 "$T/extension-build" --zip`（新目录，旁边不能有同版本旧包）。记下此次构建输出的 SHA-256。以下在 **Reader** 仓库执行；`$Chrome` / `$Edge` 指向已安装的实际可执行文件。不要回显密码，也不要记录 HTTP headers、授权回调或 profile。

   ```powershell
   $env:BETA_TEST_PASSWORD=((Get-Content -LiteralPath "$T/rehearsal.env" |
     Where-Object { $_ -like 'BETA_TEST_PASSWORD=*' }) -split '=',2)[1]
   $env:READER_TEST_EXTENSION_SHA256='<填入已选定的本次候选包的 64 位小写 SHA-256>'
   node scripts/extension-beta/browser.cjs $Chrome "$T/extension-build" $T chrome-en-faults
   node scripts/extension-beta/browser.cjs $Edge   "$T/extension-build" $T edge-zh
   ```

   浏览器启动前先检查指定摘要、同版本 ZIP 的全部文件与将要加载的目录逐字节相等、实例地址匹配，再把实际摘要、大小与文件数写入回执。不要临时从一个不确定的目录计算摘要来绕过候选校验。完整脚本启动后先匿名检查网关的 API 以及从同一入口实际打开的登录页（邮件框、密码框、提交按钮）。两项均通过才开始登录和准备测试数据。API `200` 但登录 `502` 时，回执明确记录 `lab-readiness`，不撤销测试设备、不创建测试项目，不将此项记录成浏览器整轮通过。

   选择性追加验收（含 `-excerpt-only`）会短暂停止**这个隔离项目**的 worker，以便在真实 `202` 后重新打开任务。分别检查插件所选目标、网页固定目标、排队时另一个登录会话改动末尾，以及重新确认前不会重复写入。每次只停止通过 Compose 项目及角色标签双重核对的测试容器，并在 `finally` 中启动。带 `faults` 的整轮另测来源关闭、浏览器重启等故障；同一实验室不得并行跑两组。它不会更改全局网络或填满本机磁盘，用专用 profile 的真实 OPFS quota 覆盖和测试扩展文档的回执丢失注入。源码无法验证是否全获授权、或浏览器没实际打开侧栏时，不把相应 gate 记为成功。每次用全新标签名，保留失败回执。
   带 `zh` 的运行使用中文，其他使用英文。测试在本次专用项目内创建合成对话；比较 320／375／480 CSS px、两种主题及单独的 200% CSS 放大；坐标来自扩展文档，原生侧栏实际打开另验。带 `faults` 的路径还验证整浏览器退出、使用同一测试 profile 重新启动及查询原收据，不能代替真账号或物理输入设备验收。
   `panel-navigation.cjs` 由同一流程调用：以单次失败读取检查侧栏恢复，再用真实项目及未归类对话走通「保留关键词扩大搜索 → 打开 → 返回」。额外暂扣一次本机置顶操作的实际成功回执，并在另一次操作注入 503，分开检查等待、失败和成功的界面；不让故障影响其他浏览器或实验室外流量。
5. 从进程管理器正常结束的仅应是本批次的 Next 进程。`docker compose -p reader-ext-beta-1123 --env-file "$T/rehearsal.env" -f scripts/extension-beta/compose.yml down`（不用 `-v`）。只留脱敏 receipt 和合成截图；确认服务已关闭后丢弃本批次单独的临时凭据、浏览器 profile。两个 `.context.zip` 都应是**真实 ZIP**，不保存含真实用户内容的测试证据。
