# 插件统一设计 v2：修复与提交前复核

2026-11-25，Asia/Shanghai。两仓沿用 `codex/reader-extension`，只使用原有两个子智能体。
本记录是 **未提交工作树的本地资格**，不是 CI、正式发布或生产回执。
Reader 基线 `c9cfb131d6704f2d2c095b93355629740e95cac5`；
插件基线 `be5e8dabd772809635db345a51c8c15c26b468ed`，冻结后的候选提交 `e18bb4cae7674af66a08fd3be50c113475f34e5a`（尚未推送）。
精确输入另见本目录 hash 清单，不能拿这两个旧 SHA 代替当前候选。

## 先审查、后修复

完整审查用户设计包五份文本、20 张效果图和两个交互原型。
[首次失败表](../../execution/ux-audit-extension-design-v2-2026-11-25.md)及
[第二次设计状态审查](design20-before.md)保持原样，不将失败改写成成功。
后续已批准的共用把手、浮层、短码、站外仅工具栏入口优先于旧原型的原生侧栏。

| 发现 | 修复及复核 |
|---|---|
| 导入入口指向不存在的页面 | 接通实际四步中心、独立网页与本地 ZIP 适配、逐条导入及真实收据；不另建数据管理系统 |
| 150 条列表无限增长，主操作位于视口外 4338px | 固定 50 行分页、独立滚动列表、可见主操作；320/375/1280px 实测；50 是页大小，不是总上限 |
| 无本页／整个已证明项目／已选核对 | 独立选择模型、跨页跨项目保留、移除隐藏选择、真实分组计数；不允许整个网页项目 |
| 冲突只能另存，不愿另存就困在计划中 | 可跳过本次且保留原件／原收据；旧 review 不能作用于新 receipt；不调用取消、删除或提交 |
| 新选择覆盖未完成计划、恢复不唤醒后台 | 保留原固定计划；恢复先唤醒 host、等原采集／原受理任务、再读原回执 |
| 跨窗口取消、取消与恢复、清理与封包竞态 | 当前计划逐项加锁领取；同包操作互斥；锁内重新读取实际账本；取消先发生则不再 POST，受理先发生则不取消 |
| 长正文分页缓存逐页保留大 buffer | 共享小窗口，大记录不缓存；12×3MiB 页原留存 37,750,096B，修复后 GC 检查无大缓存留存 |
| 仅首个搜索命中、附件不断堆 DOM、问题预览截断 | 每处真实 Range；搜索与附件固定 64 项/页；完整问题按需单条读取，失焦与取消释放，不常驻整库正文 |
| 项目首页入口／项目对话提示丢失 | 增加同一中心入口；只提示原 tab，经用户选页与 scope 验证后预定位；零预选、不自动发现 |
| 过期 Web 身份仍能发设备授权 | 共用签发路径重新锁定 user→principal→session；短码与旧 PKCE 均拒绝撤销／改密后的身份 |
| JSONL 整行分配早于 64MiB 工作区检查 | 64KiB 增量元数据读取与实时检查；96MiB 空白前缀原首次 RSS +101,785,600B，修复后测得 +77,824B |
| Context 设置与 Web 预设锁序倒置 | 共用 collection→preferences 顺序；真实 PostgreSQL 死锁回归通过 |

## 20 个设计状态：实际接通范围

以下“通过”均限于注明的合成数据／隔离浏览器范围；**不宣称真实 ChatGPT G0–G3 全部验收**。

| 图号 | 当前实现与证据 |
|---|---|
| 01 / 06 / 07 / 20 | 共用浮层、私有 frame、站外无注入、工具栏中心；正文宽度变化 0 CSS px。实际 Edge unpacked 7 项、导航 40 项通过 |
| 02 / 03 / 04 | 120 轮虚拟目标、111 处匹配（64+47）、第101处真实 Range、重复章节／附件消歧；完整问题与150附件分页另有42项边界检查 |
| 05 / 08 | 保存菜单、批量入口、导航与保存互斥；已有只追加模态与服务端目标保护保持。真实账号模态联动未验证，不以导航检查替代 |
| 09 / 10 / 19 | 项目首页一个导入按钮；项目对话 hint、原 tab 确认、合法项目预定位、零预选和返回全部；失效归属不猜测 |
| 11 / 18 | 未连接也可选本机来源；选择网页必须明确 scope，无 tab／范围不明有恢复提示及本机 ZIP 入口 |
| 12 / 13 | 零初选、本页／筛选／已证明本地项目、跨页保留、已选核对／移除、实际时间与分组；150 行真实 Edge 检查 |
| 14 | 默认逐来源分组；来源和目标分开，记住映射可选；主动绑定只查已选 ID，不声称内容相同；删除目标禁止回落，换账号拒绝旧响应 |
| 15 / 16 / 17 | 固定计划、逐条回执、实际目标／完整性、暂停恢复／失败重试、状态筛选、50行分页、冲突另存或跳过；真实服务端落库与独立内容读回 |

选择界面实测：[改前375px](selection-before-375.png) /
[改后375px](selection-after-375.png) /
[改后桌面](selection-after-1280.png)。
冲突路径：[改前](conflict-before.png) / [改后](conflict-after.png)。
这些是实际扩展界面截图，内容全部合成，不是设计效果图或个人资料。

## 验证台账

| 命令／测试 | 实际结果与证据 |
|---|---|
| Node24 `node --test --test-force-exit tests/*.test.cjs`（Fork） | **270 收集，207 通过、0失败、63 原有私有夹具跳过**；`extension-node-final.log`。跳过不是通过 |
| host／计划／票据／缓存专项 | 49/49、0 skip；`host-final-green.log`、[独立复核](host-final-review.md)；模拟锁／OPFS／HTTP，不是强杀或断电认证 |
| 当前 Edge 实际 unpacked + FastAPI/PG17/worker | 16/16；`center-real-final.json`。两个所选本机包对话及两个合成网页来源逐条走真实服务端；本轮重放返回 `unchanged`，不新增副本 |
| 独立 canonical 与附件读回 | 11/11；`canonical-integrity.json`。正文、角色、目标、20B CSV 字节及关联、未选来源不上传、重复无副本 |
| 选择与恢复界面 | 16/16；`selection-after.json`，150条合成目录／收据，固定DOM、窄屏主操作、review跳过 |
| 导航与新增边界 | Edge 40/40 + 42/42；`navigation-final.json`、`navigation-boundaries-final.json`。两个集合不是同一测试重复相加 |
| 名称搜索：1万对话、10万正文索引 | PostgreSQL 查询 P95 11.8ms，浏览器20次输入结束到首屏 P95 **239ms**；项目29/29、正文独有0、精确标题1；`names-postgres.json`、`names-browser.json` |
| Web lint / typecheck / production build | 退出0；`web-lint.log`、`web-typecheck.log`、`web-build.log` |
| Web 授权浏览器 | 6/6；`web-devices.log`。中英文短码核对、变更账号拒绝、设备上限恢复、撤销 |
| 后端元数据／长消息 | 102/102；`backend-metadata-green.log` |
| 后端相关现有测试 | 129通过、2原有Windows symlink跳过；`backend-focused-green.log`，Linux 原生门禁仍需完整CI |
| 实际 PostgreSQL 授权／重试／续传／迁移 | 21/21；`backend-pg-green.log`。单head0065，0065→0064→0065保留旧设备；SQL往返不证明worker草稿可降级 |
| 完整扩展重试专项 | 18/18；`backend-retry-green.log`，失权、并发、旧批准清除、原始来源、两种传输 |
| CI 覆盖清单与调度保护 | 实际完整收集7267；完整CI必须7264通过＋原3跳过。只追加151项覆盖，原调度／跳过／14个Web门禁保持；短码6例另以原生JSON要求全通过 |

本地全 API 未分片尝试已中断，不计通过，见 `api-full-local-interrupted.json`。
专项之间可能重叠，不能把各行数字相加伪装全仓覆盖。
Windows／本机冷热性能不替代640MiB Linux worker门禁或生产网络计时。

## 保留的失败与修复归因

- `backend-*-red.log`、`host-races-*.log`、`center-plan-red.log` 是真实缺陷或回归的红证据。五竞态复现脚本“退出0”意味着成功复现缺陷，不是安全检查通过。
- `names-browser-expired-grant.log` 是测试设备10分钟授权过期；仅旋转隔离凭据后重跑，未改401或请求断言。
- `canonical-fixture-red.log` 是期望文本遗漏真实 canonical 附件标记；修正明确预期，仍逐字比较正文、关联及文件字节。
- `chrome-unpacked-not-passed.log` 是普通 Chrome binary 的解压扩展 service worker 等待超时，**未通过**。`chrome-navigation.json` 的合成页面40项不代替安装验证。
- `ci-inventory-initial-failure.log` 是新增151项之后旧固定计数仍为7116。提高到实收7267并逐文件绑定，未删除旧例。一次本地 SHA 使用CRLF而校验器要求LF的错误亦已纠正。
- CI调度检查曾拒绝将新JSON塞入原冻结制品清单；修复为独立附加制品，原清单与断言不改。原失败另存 `ci-scheduling-initial-failure.log`。
- 完整问题预览 Escape 曾重入 remove；修复先释放 ownership 后删除。原浏览器失败保留 `navigation-preview-red.json`。

## 仍需真实环境证据

1. 没有读取个人 ChatGPT 数据。真实登录来源、工作区字段、分支／媒体DOM、官方导出包项目与文件覆盖尚未验证。网页目录只承诺已发现项；scope不明则拒绝，不默认全量可用。
2. Chrome真实解压加载、浏览器强杀／磁盘故障和iOS/Android真机未认证。Edge实际扩展与桌面视口不冒充这些环境。
3. 只有精确新提交的完整CI、签名发布与容量／恢复门槛通过后才能上线。Reader API/worker/Web先升级0065，插件0.3.0随后更新；同ID不变。
4. 0065与长正文内部草稿影响兼容，走完整维护，不能承诺15秒，不自动降库，也不删除唯一验证恢复点。

## 复现入口

先按仓库 `AGENTS.md` 将 TEMP/TMP 设置为获准独立任务子目录，再运行：

```text
# Fork，Node24，Edge或显式 READER_BROWSER
node --test --test-force-exit tests/*.test.cjs
node scripts/reader-center-layout-check.cjs
node scripts/reader-navigation-check.cjs <task-evidence-root>
node scripts/reader-navigation-boundaries-check.cjs
node scripts/reader-navigation-memory-check.cjs <task-evidence-root>

# 中心真实服务端验证只允许隔离回环地址与合成设备
READER_TEST_ORIGIN=<disposable-loopback> READER_TEST_DEVICE_FILE=<private-fixture-json>
node scripts/reader-center-check.cjs

# Reader
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm --filter web build
```

真实服务端夹具只在任务临时目录；凭据不归档、不提交、不打印。复现配对／收据时使用独立账号及数据库，不在 `king` 演练。后端精确命令和范围见 [backend-review.md](backend-review.md)。

归档文本统一LF并去除行尾空白；原始输出仍保留于任务目录，未修改结果、断言或失败内容。
