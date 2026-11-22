# 只在本机运行的插件验收

需要桌面 Windows、Docker Desktop、Node 24、Python、Reader pnpm 依赖、Chrome for Testing 和 Edge。浏览器测试**创建全新 profile**，拒绝复用任务目录；DNS 阻断外网，以合成的 ChatGPT 来源驱动真实扩展。Reader、NGINX、PostgreSQL、worker、授权窗口和下载不模拟。仅在个人访问受限的临时目录执行。不要使用生产 `.env`、数据库、导入资料或已登录浏览器。

1. 检查 18383–18385 空闲，没有同名 Compose 项目。准备本机可信 API 依赖镜像（例如 `docker build -t chat-reader-extension-lab apps/api`），以及 Compose 中声明的两个基础镜像。没有镜像时不要把生产地址作为替代。
2. 准备独立、未使用的任务目录和一次性配置，代码不输出密码。例如从 Reader 仓库根目录：

   ```powershell
   $T='E:\chat-reader-temp\reader-browser-rehearsal-new'
   python scripts/extension-beta/init_lab.py $T chat-reader-extension-lab
   $env:TEMP=$T; $env:TMP=$T
   docker compose -p reader-ext-beta-1123 --env-file "$T/rehearsal.env" -f scripts/extension-beta/compose.yml up -d
   ```

3. 在独立的本地源码副本构建 Web（不拷贝生产配置/数据库）：`AUTH_ENABLED=true`、`API_INTERNAL_URL=http://127.0.0.1:18385`、`NEXT_TELEMETRY_DISABLED=1`；从 `apps/web` 用 `node node_modules/next/dist/bin/next build --webpack`，然后 `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 18384`。网关 `http://127.0.0.1:18383/login` 须返回 200。
4. 在配套 Fork 根目录执行 `node scripts/package-reader.cjs http://127.0.0.1:18383 "$T/extension-build"`。以下在 **Reader** 仓库执行；`$Chrome` / `$Edge` 指向已安装的实际可执行文件。不要回显密码，也不要记录 HTTP headers、授权回调或 profile。

   ```powershell
   $env:BETA_TEST_PASSWORD=((Get-Content -LiteralPath "$T/rehearsal.env" |
     Where-Object { $_ -like 'BETA_TEST_PASSWORD=*' }) -split '=',2)[1]
   node scripts/extension-beta/browser.cjs $Chrome "$T/extension-build" $T chrome-en-faults
   node scripts/extension-beta/browser.cjs $Edge   "$T/extension-build" $T edge-zh
   ```

   带 `faults` 的调用会短暂停止**这个隔离项目**的 worker；不得同时对同一实验室运行两组故障注入。它不会更改全局网络或填满本机磁盘，用专用 profile 的真实 OPFS quota 覆盖和测试扩展文档的回执丢失注入。源码无法验证是否全获授权、或浏览器没实际打开侧栏时，不把相应 gate 记为成功。每次用全新标签名，保留失败回执。
5. 从进程管理器正常结束的仅应是本批次的 Next 进程。`docker compose -p reader-ext-beta-1123 --env-file "$T/rehearsal.env" -f scripts/extension-beta/compose.yml down`（不用 `-v`）。只留脱敏 receipt 和合成截图；确认服务已关闭后丢弃本批次单独的临时凭据、浏览器 profile。两个 `.context.zip` 都应是**真实 ZIP**，不保存含真实用户内容的测试证据。
