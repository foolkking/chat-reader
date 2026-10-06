# source-map-js 依赖修复 — 2026-10-06

状态：已升级并通过本机依赖回归、官方审计、lint/typecheck 和生产构建；最终 CI/发布尚待完成。
生产仍是 `6b4ee0a` / `20261006_0048`，不得把本机升级算作上线。

## 依据与变更

在验证 CI 产物重试时，运行 `37409815492` 的 Web gate 被官方 npm 审计阻止。
公告 [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
于 2026-10-05 23:31 UTC 更新：`source-map-js >=1.0.0 <1.2.2` 的 indexed source map
section offset 可导致同步事件循环阻塞。上游修复版为 **1.2.2**。
这比已部署源码的成功 CI 审计时间晚；没有绕过当前失败门禁。

实际依赖路径是 Next/PostCSS 和 Tailwind/Autoprefixer/PostCSS。根 pnpm override
将 `<1.2.2` 统一锁定到 **1.2.2**，lockfile 使用官方 registry integrity。
未改 Next/PostCSS 版本，未新增审计例外。pnpm 9 重算时删掉的 25 处无关 libc
平台声明已逐块与原 lockfile 对照并保留；所有这些包的版本与 integrity 均未改变。

上游修复同时限制 section offset（包含累计嵌套偏移）、避免生成代码末尾之后的
空行膨胀、减少嵌套 sources 重复遍历。本系统未据此宣称生产已发生攻击；
这是已命中的依赖门禁修复。

## 本机验证

临时目录：`C:/Users/86182/Desktop/wkkk/chat-reader-ci-artifact-retry-20261006/`。

- frozen 安装成功；Next 和直接 PostCSS 均解析到 1.2.2。
- `source-map-offsets.test.mjs` 五项覆盖真实依赖解析、异常/累计 offset、合法大 offset、
  40 层嵌套及正常源码映射与 source content；危险输入使用限时、128 MiB 堆上限子进程。
- 与已有 braces 回归一同运行，**9 passed**；加入 Web CI 的依赖回归步骤。
- 官方 npm 审计：3 条公告、1 条已补丁处理的原 braces 高危例外，**0 未批准阻断项**。
  其余非阻断公告保留在审计报告，不把“门禁通过”描述成“零公告”。
- `corepack pnpm run lint`、`corepack pnpm run typecheck`、`corepack pnpm --filter web build` 通过。

首轮测试 **8 passed / 1 failed**：新增嵌套映射测试假设 indexed section 的 column=0
可定位。实测 1.2.1 与 1.2.2 都在该边界返回未映射，column=1 都返回原始位置。
测试改用段内位置并保留完整位置/内容断言；普通非 indexed 映射仍验证 column=0。
没有修改上游库行为来满足这个测试假设。

## 剩余验证

完成最终源码完整 CI 和 CI 消费者单独重试，再使用 CI 镜像验证部署。
保留两份已验证备份和精确旧镜像清理边界；不在本机或服务器构建镜像，不新增异地副本。
