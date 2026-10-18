# Chat Reader 表格、阅读返回、噪声与批注实施记录

日期：2026-10-18（本地回归检查点，未完成全部验收）
范围：当前本地工作树；未提交、未推送、未启动 CI、未部署。

## 已实现的源码范围

- 源码编辑器表格工具：主动预览、GFM 不规则表格规范化、空表创建、增加
  行列、一次 CodeMirror transaction、草稿版本失效保护、边界与不可靠结构
  拒绝猜测。
- Owner/Offline/Share Reader：首次目录跳转前真实 DOM 锚点、右上角/移动端
  返回入口、用户滚动取消、失败保留检查点、重试和定位原消息降级入口。
- 噪声审阅：固定规则与匹配设置展示、保护原因和内置检测说明、跨页批量
  保护确认、服务端令牌绑定、重扫范围保留、旧/新扫描比较、逐条正文消费。
- 批注导出：在线全部已保存批注 Markdown 下载、Context 1.1 根
  `annotations.md`、CanJSON/离线入口同步、manifest 文件哈希/字节数/计数、
  1.0 读取兼容和 Current/Index 回传边界。
- Skill：两个可编辑运行时同步协议；固定默认 ZIP 未替换；reviewed 构建单独
  处理，不冒充默认分发。

## 验证记录

以下结果仅代表当前本地工作树；未执行项目保留为未验收，不用源码检查
或部分测试替代真实环境验收。

| 项目 | 结果 |
|---|---|
| Web typecheck | 通过；`corepack pnpm run typecheck` |
| Web lint | 通过；`corepack pnpm run lint` |
| Web build | 通过；`corepack pnpm --filter web build` |
| 全部 `scripts/ux` Node 回归 | 通过；`1426 passed / 0 failed / 0 skipped` |
| Playwright 浏览器合同子集 | 通过；本机 Chrome 执行 `10 passed / 0 failed / 0 skipped`，覆盖源码工具栏与 Reader TOC/导航合同 |
| 相关 API 回归 | 通过；目标专项 `161/161`，重扫比较专项 `11/11`；随后完整 `corepack pnpm run test:api` 为 `1298 passed, 173 skipped, 2 warnings` |
| Alembic 单 head | 通过；`20261017_0052 (head)` |
| Skill runtime/bundle | 通过；`38 passed, 1 skipped`；reviewed ZIP 已在任务临时目录生成；固定默认 ZIP 未替换 |
| Linux worker 停止 | Windows 环境，pending/未验收 |
| 约 2 GiB Linux 60 分钟资源测试 | 未验收 |
| 完整 880 项 PWA/浏览器门禁 | 未通过；构建通过，但本次全量使用了缺失的 Playwright Chromium，且未启动 API，结果 `88 passed / 56 failed / 736 skipped`；失败不能解释为产品回归 |

## 兼容边界

- 旧 Context 1.0 无 `annotations.md` 仍可读取。
- `current.md`、`index.json`、`.cr`、Share URL、Dexie v2 及离线包
  v1/v2/v3 读取合同未改变。
- `annotations.md` 是可读投影，不参与批注回传；回传仍只处理 Current/Index。
- 0052 是本地新 migration；生产仍是既有 schema，不能用本地迁移结果替代
  PostgreSQL/部署验收。

## 未解决风险

- 2026-10-18 10:31:45（北京时间）只读内核证据确认再次发生主机级
  OOM，API 被杀后重启，worker 未重启；这不证明噪声检查是唯一或直接原因。
  多文件导入与噪声资源修复及最新验证边界另见
  [本地稳定性续作](IMPORT_STABILITY_2026-10-18.md)，不属于已部署结果。
- 当前 Windows 环境不能证明 POSIX PID 1、Docker grace period、SIGTERM 领取恢复
  和长期低内存平台行为。
- 本机 Docker CLI 可用，但 Docker Desktop Linux daemon 不可用，WSL
  `docker-desktop` 处于停止状态；因此没有把 Windows worker 测试或本机命令
  伪装成 Linux 验收。
- 尚未在真实 375px/平板/桌面、键盘/读屏、亮暗主题和 Share/Offline 浏览器中
  验收交互。
- 本机 Chrome 已能执行 10 项浏览器合同测试；完整 PWA 仍需要可用的浏览器
  运行时以及隔离 API/worker，不能用合同测试替代完整交互验收。
- 固定默认 Skill ZIP 保持旧版本；只有 editable/reviewed 运行时具备 1.1
  批注文档识别能力。
- 表格 Markdown 解析器只覆盖明确可判定的 GFM 范围，不处理合并单元格或
  不可靠的跨物理行猜测。
