# 小机器优化目标：收尾总览与剩余路线

更新时间：**2026-11-14，Asia/Shanghai**。本页是本目标的状态入口；
详细方案、历次失败和实验记录保留在原账本，不再把每个检查点重复当作“当前状态”。

## 新授权：可靠性整块治理（发布准备中，用户负责验收）

用户在收尾后批准实施“系统可靠性与精简体验”方案。以下为唯一当前台账；
下方旧目标停止说明是前一检查点，不再阻止本次实施。生产版本尚未改变。
11月13日用户明确接手剩余验收，授权本任务选择性提交/推送、等待完整精确
源码CI，成功后备份/迁移/部署。保留原自动门禁及技术安全检查，不重放用户
资料、不清理生产、不建立自动安排；未验收项不能因委托用户而改标通过。
11月12日的一次本地检查点与随后本地工作限制保留为历史，不覆盖最新授权。

### 11月14日最新：整次CI仅Web失败，严格发布合同修正本地通过

用户反馈整次失败后，正式attempt1确认3d8f77f/43604634535为completed/failure。
API6751通过/3显式跳过/5 warnings，17监督及真实PG poll1/poll20均通过；
Settings job57分59秒，470矩阵全部通过（timing3287.74秒）并独立restore1
通过（43.44秒）；候选阅读比较9通过。历史baseline的9失败是原比较记录，
不当成候选失败或改写为通过。Web唯一失败step/用例仍是旧安全工作流字面断言，
专项44通过/1失败；正式Web14门禁只有3 PASS/1 FAIL/10 NOT_VERIFIED。
镜像及独立消费者skip，Docker/内存/ORM未执行，无可部署制品。
[独立最终失败](../evidence/reliability-2026-11-14/ci-full-quality-final-failure.json)
保存四正式日志和三官方size/SHA/CRC/路径验证诊断ZIP。首次本地Web ZIP读取
失败且未保留错误类型，后续同一制品正式GET成功/原digest一致；不冒充CI-token
或传输根因已修。旧派发及当时仍运行的Web快照原字节保留。

仅修改`release-security-baseline.spec.ts`：原用例名称及其他七原用例全文保留，
过时builder条件和reading job头断言按现行空/非空selector严格校正；空input
仍必须四项新质量成功，非空只通往原固定来源/全Git链证明，不能任意复用。
生产者证明必须无条件先于任何Docker build，原内存/检查/包装/上传顺序保留；
消费者必须绑定实际source/head/producer attempt，先证明后load。
新增33项实际变更且必须被拒绝的负对照，包括逐项质量/dependency/branch、
缺取消栅栏、可选/缺失证明、提前build/load、缺/可选内存、缺诊断和错误包装顺序。
没有删除失败断言、增加skip、放宽worker/PG/浏览器/逐帧/内存或资源时限。

原失败用例先独立复现；最终源码专项36（原三个纯源码用例+新增33）、
现有Python100、CI Node77、lint/typecheck通过，均零新增skip。五个原runtime
用例未本地启动站点重测，仍完整保留交新CI；不是本地浏览器/PWA/build或PG验收。
首轮临时编辑语法错误和Windows Node20不展开Bash glob的命令错误原日志保留，
没有掩盖成测试通过。typecheck增量文件放任务TEMP，用户tsbuildinfo不变。
1409输入只此测试变化，其余1408、58历史回执及13无关文件实际哈希不变。
[本地验证](../evidence/reliability-2026-11-14/ci-release-contract-verification.json) /
[输入冻结](../evidence/reliability-2026-11-14/ci-release-contract-inputs.json)。

按既定普通完整CI路线选择性提交/正常推送，只派发一次原工作流，quality source
为空；不运行image-only preflight、扩parent/白名单或继承旧质量/内存结果。
新独立`ci-release-contract-dispatch.json`登记实际candidate/run；确认即暂停，
不等待/轮询/取消/安排/部署，回执出现后不得重复提交。项目job/step总限时仍无，
GitHub六小时平台上限和全部原生门禁保留。生产未复查/操作，旧3564cbf/schema0060
仍只是先前验证指针；唯一备份、配置/volume及用户来源不动，剩余验收仍归用户。

### 前一23:12检查点（历史）：本次导入定点停止完成，Web断言当时待修

用户另行要求终止当前卡住的导入。新执行仍在旧3564cbf/schema0060上：
persisting/progress10，核验时已81分钟；canonical等待应用、进度等canonical、
心跳再等进度。只作一次绑定当前执行/源集合/连接代次/容器的辅助进度语句取消，
原worker自行回滚为FAILED/IMPORT_COMMIT_FAILED；没有手写任务终态或终止
canonical连接，也没有重启、清队列、删除来源或自动重放。
实际canonical来源是4文件/4,894,923字节，不用preview的2文件计数代替；
前后及独立复核均逐文件核对真实SHA。23:12 +08:00活动/排队任务、租约及
锁等待均0，worker空闲；原两项排队后台工作正常继续，未被取消或删除。
11容器身份/启动/重启/镜像/配置/挂载、生产checkout/config/volume及备份
目录集合不变。未重新验收备份内容；初次重型只读快照失败，轻量快照保留原
5秒SQL预算但不统计全表，故不宣称canonical全表数量差为0。
[独立事件回执](../evidence/reliability-2026-11-14/production-stall-recovery-followup.json)
不覆盖前两次事件，也不表示候选修复已经部署。

用户先前报告普通完整CI3d8f77f/43604634535的Web失败。正式日志确认唯一
失败step为Focused online browser and security checks，44通过/1失败：
release-security-baseline.spec.ts:149的首个断言仍匹配旧build-images字面条件。
当前空quality source的路径仍要求四项新质量成功；后续修正必须同时核对全部
工作流断言及完整/受保护复用的拒绝语义，不能删除断言或放宽实际发布门禁。
[Web失败回执](../evidence/reliability-2026-11-14/ci-full-web-failure.json)只记录当时
API/Settings仍在运行的快照和未下载的诊断制品元数据，不宣称整次完成或制品
内容验收。此次优先处理生产停止，尚未修测试或重新提交/派发/取消/等待/部署。

### 11月14日普通完整CI授权：唯一派发已完成，不再扩展仅镜像来源链

用户在报告再次失败后明确允许直接提交普通CI，让同一次运行自行完成构建。
本轮选择性提交/正常推送并只派发一次原`build-release-images.yml`，
`quality_source_run_id`为空。四项质量、镜像与独立制品检查全部重新执行；
不增加另一个parent/白名单，不复用43578495558或任何旧质量/内存结果。
确认唯一run身份后立即暂停，由用户反馈；不等待/轮询/创建安排/取消/部署。
随后独立`ci-full-quality-dispatch.json`记录实际提交/run；它出现后禁止重复派发。

正式[CI43599055418](https://github.com/foolkking/chat-reader/actions/runs/43599055418)
为精确b84ac1d、attempt1、workflow_dispatch、completed/failure。builder在
13:18:05Z–13:18:21Z运行16秒，唯一失败step为来源证明，下载
`source-api-quality.log`时GET失败。原37、selector34及Node77全部通过；
四质量job按前一已批准模式明确skip，消费者skip，正式制品0。Docker/base、
五例真实内存、ORM、镜像/包装均未执行，不是导入业务或资源验收失败的证明。
[独立失败回执](../evidence/reliability-2026-11-14/ci-image-only-selector-failure.json)
保存六次正式GET、原builder日志/注解指纹及未执行边界，旧派发字节不改。

runner正式日志已有Actions/Contents read，不能先归为缺少权限。旧代码把
CLI错误全部压成通用失败，HTTP状态与具体原因未保留，无法追溯证明是403、
限流或传输瞬断。13:36:21.823360Z的新本地原API日志GET成功，1421531字节、
SHA256与前次相同，6751/3/5 warnings、17监督及真实PG poll1/poll20仍完整。
本机凭据不是当时CI token；该成功只证明当前可读，不证明原失败根因消失。

本地只修改`image-only-quality-reuse.py`的GET适配器并新增29项控制：
HTTP408/429/500/502/503/504及明确的reset/EOF/传输timeout最多三次同GET，
1/2秒backoff与请求共享原180秒总预算；401/403/404、其他/歧义/未知错误、
证书错误立即拒绝。超时、错误正文/凭据/签名URL不输出或持久化；失败/部分
响应和旧缓存不替代证据，JSON/ZIP/来源/用例/manifest的原校验不放宽。
最初26控制红测保留；加入三个完整模式控制后Python100、Node77通过。
full-exact生产者及独立消费者CLI控制要求新run四质量通过，只取新run/attempt
元数据，不读取原日志/ZIP或调用旧Git来源链。新29只属本地控制，原工作流
未修改；不冒充新Linux、真实PG、完整质量、镜像/内存或生产验收。
[本地验证](../evidence/reliability-2026-11-14/ci-evidence-transport-verification.json) /
[1409输入冻结](../evidence/reliability-2026-11-14/ci-evidence-transport-inputs.json)。

原37/34控制、两份SHA工作流补丁、selector/ORM/helper、四质量job body和
所有五例320/640MiB无swap、64MiB增量、原生/平台期限均未改。新修复不符合
固定74f的直系候选限制，不能将单测通过当成新的image-only准入；本轮明确
走普通完整CI，不改或绕过那条规则。仍无项目job/step总限时，GitHub每job
六小时平台上限保留。生产只沿用旧3564cbf/schema0060，不复查或操作配置、
资料、volume、唯一备份或长期5432 PostgreSQL；剩余产品/设备/灾备验收归用户。

### 前一精确selector修正授权（历史，唯一派发已失败）

用户最新“可以”单独批准上一诊断提出的精确范围：selector夹具修正、必要的
来源策略/检出证明、选择性提交并正常推送、只派发一次仅镜像CI。不是复用
前次已经用完的授权。确认唯一派发后立即暂停，由用户告知结果；不读取结果、
不等待/轮询/取消/创建安排/部署，不扩大到全仓治理或其他业务优化。

当前策略固定质量来源
`4481fa37c355a296ce878c214525d3273a8bfe20 / 43578495558 / attempt1`，
先核验已提交修复
`74f4636e9d29098fb9a30bb42bdb7ada696373f8`的单一4481 parent、
完整4618文件mode/blob树及原严格helper/workflow证明。原策略37项、原
SHA补丁、ORM7和helper原字节均保留；原18个策略函数、全部旧常量及main
AST不变，仅Git准入入口调用追加的新链核验。不是给原parent/白名单追加
另一任意来源，也不删除失败测试或制造CI脏目录。

新候选必须是固定74f的**唯一单一直系非merge子提交**。唯一旧测试例外是
`scripts/ci/changed-area-selector.test.mjs`的已审批Git/LF SHA256
`8bb1a861309ebb92bae29ea36c29e92a38b56d25d416ba09cab4d712daf1ffdd`；
selector实现仍为原`8cd2cb8c…`。其余旧API/Web/Reader/Settings用例、fixture、
应用/依赖/migration/资源和原新增ORM控制不得变。明确列出的九份现有文档、
四份历史诊断/派发字节和两份新独立验证回执属于本轮证据范围；四份旧回执
的原SHA被策略固定，不能重写成新授权或CI通过。

新增第二份SHA绑定workflow补丁只从精确74f工作流导出：生产者及消费者的
`fetch-depth:2→3`，原negative-control步骤追加独立34项新链控制。原补丁/
37项命令、Node命令、全部四质量job body、六job/default空input、唯一
opt-in43578495558、全部内存/ORM/构建/包装/独立消费者命令和顺序保持。
五例真实320/640MiB无swap、64MiB增长及镜像/制品门禁全部在新镜像上新跑；
ORM7仍在所有资源测量之后，不预热worker，不改变任何原生/平台期限。

本地原37/新增34、package7、Node77通过；独立三层浅克隆中的37/34以及
干净/合成脏Node77均通过，重复运行不叠加覆盖。真实Git确认新链准入，
拒绝原直系4481规则下的新child、depth2缺祖先、错误selector字节、工作流
深度变更、业务变更、额外提交和tracked/index/untracked漂移，十项实际拒绝。
Actionlint1.7.12及两workflow的78段Bash只解析通过；未执行CI shell。
这些是本机控制证明，不冒充新完整质量、真实PG/Linux/cgroup/镜像或生产验收。
[新独立验证](../evidence/reliability-2026-11-14/ci-image-only-selector-lineage-verification.json) /
[新输入冻结](../evidence/reliability-2026-11-14/ci-image-only-selector-lineage-inputs.json)。

提交后用实际CLI `--preflight`重新核验官方attempt、三个immutable质量ZIP、
API监督/真实PG日志和已提交全Git链；过期/缺失/变attempt必须拒绝，不用
旧缓存代替。正常推送后核对远端精确HEAD，去重后仅派发一次原工作流的
`quality_source_run_id=43578495558`。实际candidate/run由随后独立
`ci-image-only-selector-dispatch.json`登记；回执一旦存在即保持暂停，不沿用
这里的“准备”重复提交/派发，不追加等待器或读取结果。

基线1406输入与九文档已核对；仅策略入口/工作流改变，两新增控制输入另列，
14保护文件及12目录739/13目录208旧文件保全，原三份诊断证据不改写。
生产仅沿用先前3564cbf/schema0060记录，未复查/操作配置、资料、volume、
唯一备份或长期5432 PostgreSQL。实体设备/产品/灾备剩余验收仍由用户完成。

### 前一诊断：镜像补跑失败与独立Git夹具修正（历史，当时未获新授权）

用户反馈“失败”后才读取[74f4636/CI43591310367](https://github.com/foolkking/chat-reader/actions/runs/43591310367)
的正式attempt1；六job完整集合与精确SHA已核对。build-images在11:42:41Z–
11:42:50Z的九秒job中失败，唯一失败step为新增的negative controls。
Python策略37通过，Node72中71通过/1失败；四质量job按已批准模式明确skip，
消费者skip。来源证明、Docker/base/build、五例真实内存、ORM和包装均未执行，
正式制品列表0；不将本次失败归为null/OOM/超时或业务导入回归。
[独立失败回执](../evidence/reliability-2026-11-14/ci-image-only-failure.json)
保存六次正式GET、原日志/注解指纹和未执行边界；原派发字节不重写。

失败是`changed-area-selector.test.mjs`将本机未提交docs/tooling当作必备数据。
此前本机脏改动掩盖了新增镜像命令中的该问题。精确74f的干净隔离检出复现
Node71/1；合成脏目录则使原两项通过。不是删除断言或制造CI脏目录来规避。
本地仅改这一个测试：独立显式TEMP中的Git夹具、保留原两场景及分类/去重/
完整门禁断言，再追加clean/staged/range/all-area/invalid-revision五项。
夹具不继承用户Git配置/签名/hooks；清理仅限本测试直系目录并先核对绝对路径/
链接边界。selector、应用/依赖、其他旧测试、workflow/helper/资源门禁未改。
新隔离提交只属于临时克隆，不是本仓提交；干净/合成脏检出Node均77通过，
原策略37通过。未运行新API/Web/PWA/PG/Linux资源或产品/生产验收。
[本地核验](../evidence/reliability-2026-11-14/ci-image-only-selector-verification.json) /
[输入冻结](../evidence/reliability-2026-11-14/ci-image-only-selector-inputs.json)。
本轮1406＝旧1404（全部不变）＋此前未列入清单的两现有selector文件；
不是新增两业务文件或全仓清单。初版清单假设错误在写回执前拒绝，方法/日志保留。

原一次提交/派发授权已经使用；本轮没有再次commit/push/dispatch、等待器/
安排/取消/部署。当前策略仍要求单一直系4481子提交且旧测试不变，真实调用
明确拒绝新的74f子提交，即使37个策略单测通过也不构成新源码准入。
若继续仅镜像路径，须先单独审核/获准精确测试修正、固定74f→新候选链和
对4481原质量输入的证明（包含可取到两级祖先的checkout），不能简单放宽
parent/白名单、改质量来源或自动改跑全套。生产仍只沿用旧3564cbf/schema0060。

### 前一验证脚本修正与受保护镜像补跑（历史，唯一派发已失败）

用户报告[4481fa3/43578495558](https://github.com/foolkking/chat-reader/actions/runs/43578495558)
的build-images失败，随后明确批准避免重跑全套质量矩阵：
只修控制平面脚本、校验应用/依赖未变、复用已通过质量结果，全部资源与
制品门禁保留。这一授权覆盖前一“再派发完整CI”的本轮选择；默认完整路径不改。
本轮确认派发后仍立即暂停，由用户反馈，不轮询/等待器/安排/取消/部署。

正式attempt1：API/Web/Settings/阅读比较success，build-images failure，
inspect-release-artifact skipped。Settings job3153秒（52分33秒）；
矩阵470通过、2988344ms，独立restore1通过、39184ms。
API6751通过/3跳过/5 warnings、2176.23秒，原17监督控制和真实PG poll1/poll20
逐项核对；Web14门禁、Reader候选9完整通过。它们仅属于4481fa3的质量来源。
五正式job日志/四正式诊断ZIP已核验大小、SHA/CRC，无可部署镜像。
[独立失败回执](../evidence/reliability-2026-11-14/ci-build-images-failure.json)
保留失败步骤、实际时钟与原始证据指纹，不伪称新的3000秒等待。

失败是`verify_small_zip_memory.py`状态读取对`failure:null`调用`.get()`；
真实worker尚未通过整个门禁，不能由该异常推断OOM不存在或资源已验收。
仅改此一行，与原bounded helper空失败语义一致；原fixture、业务、预览、
canonical数量/hash、worker和所有期限/资源界限均不改。
新增运行时依赖即可执行的7项真实内存SQLite控制，覆盖正常空失败、
实际失败码/终态、两个helper一致、坏非空结构、消失任务和环境/数据库拒绝；
子场景不另加为用例数。首轮新fixture误用dataclass、随后真实null红测均保留。

仍使用原六job工作流：输入空值执行全部原质量job；只有指定43578495558
才进入一次性补跑。候选必须是4481fa3的单一直接修复子提交；
整棵Git tree拒绝应用/依赖/原测试/资源/migration/其他配置变更，仅允许
精确helper表达式、SHA绑定的14处workflow添加、四个新增控制文件及本轮
明确列出的文档/证据。不是通用“跳过CI”开关。
生产者在buildx/镜像构建之前核对四成功job、三完整质量ZIP与API原监督日志；
独立消费者再核对同一官方来源/Git输入以及manifest中的质量证明。
OCI仍绑定新候选，manifest v2新增独立`quality-verification.json`的完整证明；
旧质量commit/run/attempt单独记账，旧镜像/资源结果不复用。
全部五例真实320/640MiB无swap、原64MiB增量、镜像及精确制品检查继续新跑。
新增ORM控制安排在原五例资源测量之后，不以额外ORM测试预热worker的门禁。

本地专项、输入冻结、失败方法和保全统一见
[本轮验证](../evidence/reliability-2026-11-14/ci-image-only-verification.json) /
[精确输入](../evidence/reliability-2026-11-14/ci-image-only-inputs.json)。
最终发布策略37项、真实ORM7项、原API专项80通过/2项Windows符号链接跳过、
CI脚本72、lint/typecheck和单head0061通过。Actionlint1.7.12与两workflow的
78段Bash语法检查通过，未执行这些shell或新Linux资源门禁。
冻结1404输入＝前1399＋此前清单未含的原状态helper＋四个新增控制；
整棵Git tree等价验证另保护所有其余tracked输入，不把清单误称全仓文件数。
不冒充新Web/PWA构建、真实PG、Linux内存或生产验收。
十三无关文件、10目录2103/11目录2580旧文件及原派发字节保留；
无本机PG/服务栈重启、生产复查、配置/资料/唯一备份操作。
新实际提交及唯一run由随后`ci-image-only-dispatch.json`登记；
它出现后保持暂停，未取得新镜像/资源/制品结果前不称本轮可发布。

### 前一离线子进程依赖修复（历史）

用户报告4a943ea的[完整CI43566365014](https://github.com/foolkking/chat-reader/actions/runs/43566365014)
失败后，才读取正式结果；首次请求07:42:43.997097Z、收到07:42:46.863100Z。
没有新等待器或3000秒monotonic等待声明，也未发取消请求。
Settings job06:26:47Z–07:30:19Z，**3812秒/63分32秒**；原470矩阵完整结束，
**469通过、1失败、0跳过/用例总超时/中断**。矩阵计时3653.93秒、
max RSS632044KB、exit1；独立restore未执行，两个发布job跳过，没有可部署镜像。
API6716通过/3跳过/5 warnings、1730.26秒，Web/阅读比较成功仅属于该失败run。
原19项核对、15项冷导入、8项维护预算、17项监督主循环及真实PG poll1/poll20
均已逐项核对正式日志，不继承为本轮验收。
[独立失败回执](../evidence/reliability-2026-11-14/ci-offline-optional-failure.json)保留四日志/
三正式ZIP的digest/大小/CRC核验；原始日志和trace留在本任务临时目录。

唯一失败是`settings-offline-recovery.spec.ts:543`的最后一页副本移除用例，
尚未进入分页断言，准备21份真实离线副本时原60秒expect仍为`generating`。
Trace有20次202准入、19次200下载和19次committed状态观察，最后观察processing；
worker保留日志最终有20次对应提交，包含浏览器结束后的提交，没有对应业务失败。
19个claim→commit样本中位1.531901秒，20个admission→claim样本中位0.733437秒，
19个commit→下一次状态观察样本中位0.534633秒。下载次数不是独立Dexie行验证。
原case180秒/expect60秒不增加，Web源码/e2e/两个workflow均未修改。

最小修复只涉及五个应用文件：observability/ownership直接用FastAPI原本
reexport的同一个Starlette Request；subject_account/export_retention延后实际
HTTP操作所需的真实FastAPI HTTPException；remote scanner仅在配置有效并实际
scan时加载HTTPX。401/账户边界、扫描策略/timeout/错误及import预算、后台成功
提交前原finalize、生命周期/lease/清理均保留；剔除import语句后的业务AST相同。
不改memory_budget/uploads、并发、后台业务调度或资源/逐帧/原生限时。

新增29项护栏：十个被动导入、两个Request身份、AUTH_DISABLED与缺remote URL、
六个实际账户权限/异常控制，以及scope3×asset_mode3的真实内存SQLite
queue→claim→process→reconcile→ZIP校验。包保留owned正文、source metadata、
project context、批注/笔记、foreign隔离、幂等、hash/CRC/终态；无真实附件，
不能冒充附件资源或PG/21-child浏览器整链。原scanner六项保留，并追加六项错误/
策略控制，继续用实际HTTPX适配器并断言原配置timeout。
初始20失败/2通过、随后late-retention及新v3夹具字段失败均保留；
仅把新夹具旧字段改成现行`display_text`，未放宽正文或包合同。首轮专项48通过。

同布局308个应用源码副本、同安装环境、三组交替新鲜解释器对照：
纯导入中位1.417621→1.064043秒，新增模块515→331；
实际文本打包中位1.777052→1.338086秒。补充九项AUTH_ENABLED=true配置探针
保留所有导入/业务断言且通过，不叠加进pytest计数，不是认证HTTP/PG验收。
[本机诊断](../evidence/reliability-2026-11-14/ci-offline-optional-import-diagnosis.json)
只证明Windows本机，未测Linux/21-child浏览器/整次CI或内存/信号验收。

CI脚本72、离线Node205（25文件）、lint/typecheck及单head0061通过。
最终43模块API**486通过/72显式跳过（68 PG、4 POSIX）**，1004.83秒，
包含新增35项，不叠加首轮48项或补充九探针为覆盖率。
[1399输入](../evidence/reliability-2026-11-14/ci-offline-optional-inputs.json)跨最终回归
无漂移，统一写入[本轮验证](../evidence/reliability-2026-11-14/ci-offline-optional-verification.json)；
十三保护文件、10目录2103旧文件和原派发回执字节保全。旧548构建输入未变不称
新build/PWA；不重启旧测试PG/服务栈，不触碰生产、配置、资料或唯一备份。

保持无项目job/step总限时和GitHub每job六小时平台上限；只选择性提交/非force
推送并派发一次完整精确CI。随后独立`ci-offline-optional-dispatch.json`登记实际
提交/唯一run，确认后立即暂停，由用户反馈结果，不轮询/等待器/安排/部署。
原`ci-settings-completion-dispatch.json`按原字节纳入白名单，描述旧时点；
它的暂停已由本次用户失败反馈结束，不据此重复派发或复用旧终止授权。
生产只沿用先前3564cbf/schema0060指针，本轮未复查；其余验收仍归用户。

### 前一轻量核对与平台默认CI限时检查点（历史）

用户最新澄清只授权本轮修复、选择性提交/推送和一次完整精确CI；
项目不配置job/step `timeout-minutes`，不是改成显式360分钟或0/null。
GitHub托管runner仍有每job六小时平台上限。确认派发后立即暂停，由用户
告知结果；不轮询、不启动等待器/安排、不部署。此边界覆盖上方旧自动继续流程。

前次530a55b的CI43556068261已独立确认completed/cancelled；Settings在
04:19:31Z–05:19:51Z触及原60分钟限时，431项打印通过，432–437六项
在终止窗口ECONNREFUSED，470矩阵及独立restore未完成。
API6697/3/5 warnings（1967.53秒）、Web及阅读比较仅是该失败run的结果；
新增23个旧冷启动控制已按官方日志逐项确认，仍不得继承为新CI验收。
四份正式日志/三份正式ZIP摘要核验；本次诊断依据用户报告超时，不伪称
此前已停止的等待器完成了新3000秒monotonic等待，未发取消请求。
[独立失败回执](../evidence/reliability-2026-11-14/ci-settings-completion-failure.json)。

最小代码修复仅让中断核对直接读取既有`archive_task_status`，避免无关
系统/个人归档、编辑和索引处理器加载；heavy module继续reexport同一对象。
user/stalled/admin终态、来源保留、代次/锁、备份状态与幂等审计不变。
18项新鲜解释器实际内存SQLite红测准确拒绝旧无关导入，身份控制1项通过；
修复后新增19项通过。三路径各三次同布局/同安装环境诊断：
普通导出0.832701→0.054134秒、噪音核对0.753569→0.053267秒、
系统归档核对0.772294→0.163954秒；新增模块283/284降至11/26。
这是Windows本机合成核对，不是Linux或完整CI提速证明。
[诊断](../evidence/reliability-2026-11-14/ci-settings-completion-import-diagnosis.json)。

最终25模块API307通过/60显式PG或平台跳过（含新增19，不叠加为覆盖率）；
CI脚本72（新增8）、lint/typecheck及单head0061通过。
两份workflow解析对照仅移除39个总限时字段，原六job、命令/顺序/配置、
测试选择/并发、470+restore1和全部原资源/逐帧门禁保留；四个新增shell
仅作Git Bash语法核验，未执行应用。Settings新增精确身份、三阶段耗时/
RSS/退出码和两fixture启动/清理请求时间，不把请求时间当退出完成时间。
1398输入、十三保护文件及原09目录1790文件哈希无漂移；旧548 Web构建输入
不变，不称新build/PWA。未重启本机PG/站点、未触碰生产/用户资料。
[本地验证](../evidence/reliability-2026-11-14/ci-settings-completion-verification.json)。

提交及唯一新CI的实际编号由随后独立`ci-settings-completion-dispatch.json`
记录；该回执出现后保持暂停，不沿用旧helper/等待器或再次派发。
用户反馈后仍需新完整CI/精确制品验收和fresh发布准入，生产仍旧3564cbf/
schema0060；两次旧导入终止授权已经执行，不复用。

### 接续时沿用的用户工作偏好

- 不使用web search；优先查现有任务记录、代码、真实接口和可复现测试。
  Skill仅作待核查清单，不把其中的断言、评分或未实测建议当作项目事实。
- 按完整工作流深入调研、先保留失败复现再修正；不无限追加无关小优化，
  不放宽内存/逐帧门槛，不把“未复现”写成“已修复”。
- 保留现有字体/色板/布局、用户资料、无关脏改动及旧失败证据。
  未知写入先只读核对，不静默重发；当前结论只维护本页。
- `a0faa85`已用完上次一次提交授权；11月13日最新指示另行授权本次
  提交/推送/CI/部署。此前正常回查遵守至少50分钟边界；11月14日本轮
  最新要求是确认派发即暂停、不回查，由用户反馈结果，不创建安排。
  只提交本轮源码与证据，保留原tsbuildinfo和无关审查/清理记录。

### 可靠性四块实施

| 编号 | 问题域 / 证据 | 本地实施与验证状态 |
| --- | --- | --- |
| A1 | 提交后响应失败删文件；失败后暂存丢失；COMMIT结果未知 | 已实施事务所有权、暂存保留、实际COMMIT边界及PG新连接核对。真实API及丢失COMMIT回执故障注入通过；不把ORM提交前拒绝当作未知提交 |
| A2 | 多引用、整行误删、合法缺失、代码假引用 | 已实施真实Markdown范围、精确单处/显式全部替换、重复token一次上传、多引用缺失兼容；22个跨语言共享样例及真实编辑器撤销覆盖。复审补齐合并/拆分/修复/个人归档的代码示例保全、`.cr`恢复引用重映射和缺失附件显式变换 |
| A3 | 新输入被覆盖、同版本双端覆盖、缺回执 | 已实施精确源码SHA256+版本锁、原操作幂等回执、快照确认不覆盖后续输入；关闭/重开恢复身份、核对不PATCH、正文刷新与保存分离 |
| A4 | 多文件乱序、失败新会话、关闭丢身份 | 文件面板/源码均单文件完整处理后才处理下一个，失败不取消后续；原session/item回执进Dexie v2设置，File仅留内存，拒绝后的替换是显式新上传 |
| B | 心跳假进展、辅助写回卡死、无法停止 | 已实施监督进程+一个子进程、独立停止记录、300秒无检查点/30秒退出宽限、数据库租约和代次栅栏；真实PG锁、卡进程、监督主循环、迁移往返通过。总资源门禁未验 |
| C | 恢复按钮失效、读取无界、离线焦点丢失 | 保存/上传重入与读取时限、迟到认证隔离、离线行消失后的焦点恢复已补；Reader39/离线12场景通过。未宣称实体平板或冷启动223/331ms已解决 |
| D | 清理与业务混为一谈、失败清理掩盖主因 | 已补已授权删除字节回执、四类有界轮换维护、回滚/未知保护、派生/归档/离线临时清理主次错误分离、安静管理员摘要。宿主备份恢复未验；未操作生产 |

测试必须包含真实接口、组件、PostgreSQL 锁及进程退出场景；单函数结果
不替代浏览器、内存和逐帧门禁。未验证不得标为完成。

### 本地验证及发现过程（不是发布验收）

- 首轮6项API失败复现保留；修复后相应回归通过。
- 首轮全量API（运行期间已有后续修改）：6241通过、257平台/显式集成跳过、6失败；
  失败涉及ORM提交前拒绝被误判为COMMIT未知，以及旧测试缺少新基线哈希。
  已修正后相关163项通过；**不能把该中途全量运行改称精确最终源码全绿**。
- PostgreSQL追加专项32通过；另一归档/清理组10通过/1可选跳过（与前组有重叠，
  不累加为覆盖率）。含真实监督父子进程连续执行、卡死后
  后续任务10秒内运行、取消不等待canonical锁、同值进度不刷新检查点、
  COMMIT提交/回滚/无法核对三态、0060↔0061往返与单head。
  另通过1项真实PG `.cr`完整API往返：上传→编辑→导出→预览→恢复，
  正文/文件身份一致，代码示例未改写；初始化夹具失败与纠正过程保留。
- 真实源码编辑器93场景，文件面板12场景（375/800/1440、响应丢失、
  单文件顺序、重开只读核对、存储拒绝、显式替换被拒来源），离线12、
  阅读交互39通过。API适配的浏览器测试不冒充真实API网络验收。
- Node2502、lint/typecheck与546输入隔离同依赖Next构建通过。
  最终源码哈希及追加检查统一写入本轮机器回执，不累加重叠用例当覆盖率。
- 两次流程复审额外修复：保存后刷新按钮被页脚遮挡、附件异步恢复被继续
  输入取消、离线完成行丢焦点、安全HTML投影误当可编辑Markdown表格、
  已拒绝上传的“重试”循环、归档/预览提交清理边界。
- 跨入口复审追加：附件/归档/合并专项283通过/1平台跳过；后续最终变换组85通过。
  先复现后修复代码示例误改、缩进丢失、错误行号指向示例、合法缺失附件
  拆分/合并被拒、`.cr`正文保留旧附件身份。跨对话引用仍422，历史资料仍保留。
  文件列表不再将已合并删除消息算成当前引用；历史版本不因此删除。
  管理员12、阅读接续12、图片比例6、短时反馈12浏览器场景追加通过。
  状态区分“未推进”“停止中”“核对中”，不能在尚未发出停止请求时宣称已在停止。

本轮[机器回执](../evidence/reliability-2026-11-12/verification.json)保留
1381项源码/测试/配置哈希、546项构建输入、20个失败检查点及3张合成截图；
计数不叠加为覆盖率。任务自建的隔离PostgreSQL已停止，临时资料和原证据保留。

### 尚未关闭的验收项

1. Docker守护进程不可用，尚未测Linux监督进程+子进程总320/640MiB、
   无swap/无OOM，以及真实Linux父进程退出信号路径；不能提高预算代替。
2. 原完整64条逐帧矩阵、所有任务类型/全部外部副作用组合未在本轮整链运行。
   组件场景、PostgreSQL故障测试与原门禁互补，不替代它们。
3. 实体平板、冷启动长任务根因、旧宿主唯一备份隔离恢复仍待单独验证；
   合成`.cr`/系统归档恢复不是宿主灾备演练。
4. 旧“无回执”文件与未知提交文件受保护；本轮不自动修复/清理历史数据。
   兼容接口新增不代表旧离线副本被改写。
5. 完整精确源码CI43459604614、43483733253和74a1e86的43503483829均已失败；
   43514182245也已结束，仅为CPU诊断。Web夹具及阅读坐标测量修正已本地验证，
   b2d3a65的完整CI43531859718也在50分钟双边界后确认Settings原60分钟超时，
   不完整/不可发布。当前仅修复监督子进程结束后的强制idle等待；
   后一次修复9a084146已提交/推送，完整CI43543975636也在50分钟双边界后确认
   Settings原60分钟超时，451项打印通过但矩阵/restore未完成。尚无本轮
   可部署制品；冷启动/维护预算修复进入530a55b后，其CI43556068261仍因
   原60分钟未完成。4a943ea的43566365014在平台默认限时下已跑完470矩阵，
   469通过/1个离线准备失败，restore未执行，仍不可发布。本批子进程可选依赖
   修复的43578495558现已四项质量成功（含470+restore1），但镜像控制平面
   null异常导致资源/制品未验。最新用户批准的严格输入等价镜像补跑见顶部；
   不改变并发、不复用旧资源结果，也不将该补跑当作新完整质量矩阵。
6. 下述后一批已补管理员当前执行的定点停止与结果核对，但不是全局异常
   任意重置工具。所有业务类型恢复出口仍未逐项完成整链验收；不能据此
   宣称A–D所有体验目标已经全部完成。

### a0faa85后：管理员定点恢复批次（本地，未再次提交）

按用户要求，前述工作已做一次本地提交`a0faa85`；未推送、未派发或等待CI。
旧审查资料与构建缓存未混入提交，原文件保留。当前下一批集中解决D的
“看到卡住但无法处理”缺口，不扩展成新管理页面。

| 实际缺口 | 修正与边界 |
| --- | --- |
| Root只有计数，无法处理其他账户的执行 | 原运行页按需展开当前执行；显示账户、任务类别、时间，不读取正文/文件名/payload |
| 旧页面可能误停下一个任务 | 停止绑定原task/token/attempt，独立控制行NOWAIT；不锁canonical任务，不清队列 |
| 请求超时被误认为停止失败 | 15秒释放UI忙态，保留“待确认”，只读核对；重开从服务器最后审计恢复，不自动重发 |
| 停止与关联恢复状态脱节 | 管理员中断记为未完成，原任务可显式处理；账户删除请求同步FAILED，邮件UNKNOWN不重发，已完成业务不回滚 |
| 手动重试重用attempt=1，旧核对误报新结果 | 先复现后补执行开始边界，审计保留原时间；代次替换后不拿新任务结果冒充旧回执 |
| 操作反馈重复、键盘失焦 | 展开时仅保留一处执行说明；确认/Escape/关闭恢复真实焦点，44px目标，不改变现有色板与字体 |

本批API/真实PG相关44通过；Node2502、管理员mounted12、lint/typecheck通过。
PG验证两种实际行锁、原子审计和既有父子进程门禁；首轮夹具未给强约束owner
失败保留，修复夹具而非放宽schema。缺入口7项失败、恢复取消语义失败及
重复attempt误认结果失败均保留并回归。浏览器用合成HTTP，不冒充线上整链。
547输入同依赖隔离构建通过、源码漂移0；详见
[本批增量回执](../evidence/reliability-2026-11-12/admin-recovery-verification.json)。
隔离PG已停止、临时与失败证据保留；原Linux内存/64帧/实体平板/宿主恢复缺口不变。

### 11月13日：用户任务中断恢复（本地，未再次提交）

恢复记录及工作区哈希确认上一批管理员恢复已完成，不重做或覆盖旧回执。
本批限定在受监督任务中断后的owner恢复，不增加新架构或重画页面。

| 实际失败 / 缺口 | 修正与边界 |
| --- | --- |
| 独立控制快路绕过原不可取消能力 | 任务读取与取消复用同一能力判断；账户删除/维护/回填仍不可owner取消，Root显式中断仍独立 |
| 导出/离线接受无关来源放弃参数；通知任务动作泄露身份 | 来源body仅限分析；通知详情/重试/取消均404，在控制记录读取前隐藏 |
| 批量删除保留cursor却清空此前结果，恢复后丢成功/失败回执 | 原任务显式重试保留有效已提交断点及计数，只做余下项；实际逐项删除覆盖首项成功和失败两条路径 |
| processing+独立stopping缺核对入口；扫描继续显示“再取消” | 共享独立状态投影，任务/扫描显示等待退出并只读核对；读取失败保留入口，真实控制替换恢复焦点 |
| 旧PG锁夹具选不可取消的搜索回填；PG时间偏移导致字符串误判 | 先保留失败，仅把锁夹具改为允许取消的导出；按实际时间点验证回执，不改权限、锁或2秒门槛 |

本批合成API、真实PostgreSQL、Node、mounted浏览器和隔离构建证据归入
[11月13日增量回执](../evidence/reliability-2026-11-13/owner-recovery-verification.json)；
最终八文件API/PG专项130通过，保留1条既有Alembic配置警告；
Node2503、mounted12、lint/typecheck及547输入同安装依赖隔离构建通过。
1381项代码/测试/配置输入在最终专项前后哈希一致，原tsbuildinfo未改。
原生启动会话延迟到停止后的连接失败单独保留，不拿它冒充功能复现或通过。
新自建PG已核验身份/无其他客户端后停止，集群目录与失败证据保留。
之前回执不覆盖，重叠用例不累加为覆盖率。全量最终源码API及CI、Linux总内存/
信号、原64帧、实体平板及宿主恢复仍未验收，本批不改变生产或资料保留边界。

### 11月13日：发布批次（原CI失败，未部署）

- 提交前1381项代码/测试/配置与最终owner专项输入哈希一致，漂移0；
  12个新增/修改Python文件AST与候选单一head0061检查通过。
- 既有最终130项API/PG、Node2503、mounted12、静态和隔离构建证据仍是
  本地证据，不伪称完整最终API/CI通过。本轮不重复代做用户的剩余验收。
- 远端master已核对为7a4d61b，本地a0faa85仅领先1个提交，无分叉；
  本次选择性提交包括其后管理员和owner恢复，不混入无关缓存/历史资料。
- 使用既有Git凭据在内存中调用GitHub CLI；不打印或持久化凭据，
  不改变全局环境/登录配置。发布临时物及后续制品位于独立任务目录。
- CI成功后仍须新容量准入、五组件停写备份、旧租约释放、精确镜像迁移
  和健康/配置保全检查。实体设备、全业务副作用和宿主恢复由用户验收；
  不在生产压测，不自动重试原导入，不删除唯一好备份或旧镜像。
- 选择性提交`adc80ac0dc671d86f26fc221626b4acfe4ee3651`共49文件已推送；
  13个无关文件哈希未变，索引空。完整
  [CI43389645130](https://github.com/foolkking/chat-reader/actions/runs/43389645130)
  在15:58:50 +08:00派发，首次读取不早于16:48:50；没有创建安排或提前回查。
  [派发回执](../evidence/reliability-2026-11-13/ci-dispatch.json)不代表通过。
- 等待期间仅做宿主只读元数据检查：生产仍3564cbf/schema0060，三个应用
  无OOM/重启，活动和排队任务均0，保留一份旧备份。未停服、写数据库、
  创建生产备份或迁移；实际部署仍需届时重新核验。

### 11月13日：CI阻断修复（本地回归通过，等待新CI）

首次读取在16:48:50 +08:00，满足原50分钟边界；17:04:07补读最终状态：
API/Web失败，Settings原60分钟门槛超时取消，性能/构建/制品检查跳过。
未下载或加载可部署镜像，未部署；原失败日志、诊断ZIP及摘要保留。

| 已确认问题 | 最小修复 / 验证边界 |
| --- | --- |
| PG测试在持锁UPDATE回调内同步等待竞争取消COMMIT，夹具自造等待环 | 取消移入独立线程，真实Session.after_commit释放行锁后再等待；不改业务取消实现，原终态/来源保全断言保留 |
| PG清理聚合SELECT/GROUP BY重复创建JSON路径绑定，运行摘要不可用 | 复用同一state表达式；真实PG红测保留，owner强约束夹具错误先纠正，不放宽schema |
| 表格pending Escape主动跳Markdown，与真实cell恢复相冲突 | 沿用真实DOM延迟焦点队列；解析完成后返回原cell，用户已选其他控件则不抢焦点，保留pending/Apply门槛 |
| 清理后的显式重载只刷新Reader props，未更新CodeMirror | 明确的一次性重载请求；未出现后续输入才用一个可撤销transaction更新正文/基线，否则保留草稿并进入原比较入口；普通刷新仍不是编辑器输入 |
| 首次挂载时的编辑被包装层200ms旧value闭包回写 | 沿用同一依赖公开hook及initial state，创建时也不传受控value；原包装层负对照保留，真实创建时输入/后续输入/Undo/Redo回归通过 |
| 成功“全部替换”后旧Undo请求重放 | 实测同一id被执行11次，最后撤销新替换；请求绑定消息并在真实view就绪后仅消费一次，回调/焦点/host刷新不再重放历史命令 |
| 选择相同文件的独立picker请求需要保留身份 | 按实际请求对象去重，不把URI/placement相同等同于同一次请求；这是请求边界，不再冒称上述回退的充分根因 |
| 扫描核对按钮禁用/消失后丢焦点，legacy cancelling仍重复显示核对 | 保存真实row焦点锚点，恢复自己丢失的焦点，不抢用户新焦点；独立stopping继续可核对，legacy已确认停止请求则返回原row动作，不重发POST |
| 导入完成被误当作其噪声扫描已经READY | 测试先在原配置预算内读取该import_id自己的canonical follow-up至READY，再保留原5秒UI断言；不sleep、不同步扫描、不放宽CI超时 |

PG聚合/导入进度模块35通过；监督/任务/管理员/来源恢复模块59通过，
保留1条既有Alembic配置警告，两组不累加为覆盖率。
最终源码编辑器99场景、picker独立20次重复、扫描恢复12组通过；
覆盖清理重载后的实际保存基线、后续输入比较、一次性创建与历史命令。
原97/98场景单次通过后仍有picker红测，不能用单次全绿掩盖它；
两条独立回退原因及全部失败/探针/fixture证据均保留。
最终Node158文件/2591项通过，无超时或并发覆盖参数；此前同范围的一次
Windows Git Bash夹具10秒超时另存，不改门槛，停止并行构建后完整复跑通过。
lint/typecheck与548输入同安装依赖隔离Next构建通过，工作区及副本输入漂移0。
本机Node20.13.1不冒充CI/image的22.13.1。单一head0061不变；
两座自建PG均核验路径/进程/无其他客户端后停止，集群目录保留。
[修复回执](../evidence/reliability-2026-11-13/ci-repair-verification.json)
保留最终输入、测试与失败证据哈希；十三个无关文件仍未改、未暂存。
完整精确新CI和部署仍待执行，不继承旧结果，不代做用户剩余验收。
完整本地API/worker启动被策略拒绝，不换工具/路径绕过；
真实网络Settings/PWA与Linux/原逐帧门槛由完整新CI负责。
实体设备、全业务副作用和宿主灾备仍由用户验收，不改标通过。

### 11月13日：修复提交与完整新CI（该批已取消，未部署）

- 选择性提交`829e1b794a795e4bee9a456717825089e88dd354`共23文件已推送；
  本地/远端master一致，十三个无关文件字节未变、索引空，没有force push。
- 新完整[CI43424349497](https://github.com/foolkking/chat-reader/actions/runs/43424349497)
  在20:20:35.862256 +08:00确认派发，首次状态读取不早于
  **21:10:35.862256 +08:00**。[独立派发回执](../evidence/reliability-2026-11-13/ci-repair-dispatch.json)
  不覆盖旧失败回执；等待器在同一任务进程内遵守边界，未创建安排。
  边界后的首次请求TLS超时，21:12:16有效读取API/Web失败；用户随后要求取消，
  21:13:57发出一次取消请求，21:14:35核验整次run为cancelled，未重复取消。
- 等待期仅做有界宿主只读调研，未停服务/取消查询/写任务/迁移：
  旧生产3564cbf/schema0060出现一项首次执行的processing/persisting导入、
  一项排队分析；canonical事务仍打开，辅助进度等canonical、心跳又等进度，
  容器无重启/OOM但心跳陈旧。不是“还在正常推进”。
- 当前旧/新代码均保留最多三次遗留自动恢复；直接杀掉该首次执行再启动
  新worker可能重排原输入，不能作为“不重放”的安全上线步骤。
  部署前必须重新核对原任务结果与旧租约安全结束，不伪造终态或清队列。
- 宿主只读容量准备快照：可用约7.21GiB，原备份未压缩估算约5.49GiB，
  还未计新精确镜像、归档与原headroom。存在准入不足风险；
  必须按届时精确制品与新快照计算，不降低预算、不删唯一好备份或旧镜像。
  生产配置/dirty checkout/卷和用户来源未改。

### 11月13日：按指示取消CI并修正夹具（回归通过，已提交/派发新CI）

保留43424349497的API/Web/Settings原日志及两份官方质量ZIP，独立核对
artifact ID、精确829e1b7来源和官方ZIP摘要；不是可发布制品或通过回执。
API在停机夹具前已有三项失败，不能只修最后的无界等待。逐项红测后修正：

| 真实失败 | 最小修正与保留的门槛 |
| --- | --- |
| 备份恢复后仍断言旧0060，而实际源库已经0061 | 从停写源库读取单一head，与真实恢复库逐字比较；原版本/收藏/附件字节及SHA断言保留 |
| 离线并发replace-current夹具未提供新源码基线 | 并发writer提供原version及精确UTF-8 SHA；两种保存/进度提交组合和原快照一致性断言全部保留 |
| Linux子进程只patch旧task_worker，真实入口转到supervisor，stdout readline无界 | 受控原loop接到当前入口；跨平台mocked红测验证绑定，实际子进程日志5秒就绪上限、信号后原5秒成功退出不变，四项POSIX场景仍由Linux CI实测 |
| Escape后立刻比较Unicode cell，却读到尚未绘制的新预览 | 复用既有预览调度seam复现原错误；明确验证旧cell禁用、精确新Markdown保留，再释放并在原5秒内核对Unicode字节、真实cell焦点、Apply与一次Undo |

最终三文件API/PG专项**34通过、4项Windows/POSIX跳过**，mounted编辑器原
**99场景**通过，Unicode同一完整场景**20次**重复（十次1x、十次4x CPU调度）
通过；不累加重叠用例为覆盖率，不冒称实体设备/原64帧或Linux信号验收。
三个Python模块AST、浏览器脚本语法与diff检查通过。1382项输入仅四个测试
夹具变化，应用/工作流/deploy不变；548项原Web构建输入漂移0，沿用前批
构建而非伪称新构建。十三个保护文件字节未变，索引未混入无关文件。
真实失败、取消stdout解码错误、只读下载错误与本机PG身份守卫拒绝均保留。
新自建PG已核验路径/端口/无其他客户端后停止，资料未删；没有启动完整本地
API/worker、生产写入、重放或清理。详见
[夹具回归与取消回执](../evidence/reliability-2026-11-13/ci-fixture-verification.json)。

用户的“可以”另行批准了**仅在新完整CI及精确制品全绿后**，重新严格核验
旧锁链及来源字节，再仅取消旧worker的**辅助进度SQL等待**，让原代码回滚
收尾并保留来源、不重试。该批检查点尚未执行；11月14日另获立即定点停止
授权后的操作见下。不授权终止canonical连接、修改
任务行、清队列或自动重放，也不能复用等待期旧PID作操作。CI取消期间生产不动。
夹具修复已按原授权选择性提交/推送为
`2ae0ed0ff26d1bc4cfe49b617cb6a08981f99a51`，共12文件；提交/推送前后
1382项测试输入与十三个保护文件未漂移，索引空，无force push。
新完整[CI43436935411](https://github.com/foolkking/chat-reader/actions/runs/43436935411)
在21:48:46.069725 +08:00确认派发，首次状态读取不早于
**22:38:46.069725 +08:00**；[新派发回执](../evidence/reliability-2026-11-13/ci-fixture-dispatch.json)
不覆盖两次旧失败/取消回执。首次有效读取为22:38:46.069844 +08:00，
满足50分钟边界；Web失败，API/阅读性能通过仅属于2ae0ed0。
22:39:58 +08:00发出一次取消请求并独立确认整次run cancelled，stdout解码
错误不导致重复取消。Settings是主动取消，不是60分钟超时；两个发布job
均零step、未开始，没有可部署制品。三份官方诊断ZIP及四份日志保留并核对。
生产取消、备份、迁移或部署均未执行，没有创建安排。

### 11月13日：源码合同与扫描夹具收尾（本地通过，新CI待派发）

不把取消后的ECONNREFUSED当成应用根因，也不只修Web后碰运气：

| 本次真实失败 / 复现 | 最小修正与验证边界 |
| --- | --- |
| 两条Web静态断言仍要求旧保存变量和已移除的受控编辑器 | 原9项先复现7通过/2失败；改为核对原保存请求内的version+精确hash及持久化/重试payload，编辑器只接一次性lazy seed、不传value；cursor/真实Reader目标断言保留 |
| Settings跨账户取消测试只关浏览器，遗留人工claimed/cancelling任务；后续导入预览与四项扫描一直QUEUED | 真实PG复现legacy保护正确阻止下一任务，原300秒内不会stale恢复；所有生命周期finally及初始化失败路径仅收尾自己的原人工scan，真实取消/终结，不清队列或改worker保护 |
| 夹具收尾可能碰错账户/scan或真实受监督执行 | 精确核对owner、job类型、scan关联、token/control；拒绝接管真实child，终态回执幂等保留，额外import follow-up也只按原身份处理；正文/版本及已提交import保留 |

新PG夹具回归先复现**11失败/3通过**，修后四文件专项**39通过**，保留一条
既有Alembic配置警告；源码合同最终**9通过**，五项精确负对照全部拒绝。
负对照在任务独立副本运行，不修改应用源码；初版定位歧义与配置错误均保留。
lint/typecheck通过，build-info只写任务目录。1383项代码/测试/配置输入仅两项
既有测试和一项新增PG回归变化；应用、工作流、部署未改。构建预检发现
原548项输入也包含这两项e2e测试，拒绝沿用旧构建；新548输入、同安装依赖
隔离Next构建已通过，原仓库与副本输入漂移均0、未复制env。本机Node20.13.1
不是CI/image的22.13.1，构建不升级为发布验收。十三个无关文件字节未变、未暂存。
PG身份守卫先拒绝未归一化的路径比较；按真实argv/data/loopback精确复核后
运行测试，最后核验无其他客户端并停止，集群/失败证据保留，未删资料。
[本批回执](../evidence/reliability-2026-11-13/ci-focused-verification.json)记录
实际输入与边界。未启动完整本地API/worker或绕过此前策略拒绝；整站Settings、
Linux内存/信号、原逐帧及五份精确发布制品仍须新完整CI，不继承旧成功项。
本批没有生产写入、原资料重放或清理；用户的条件式辅助SQL授权仍未执行。

### 派发前：API CI临时数据库端口兼容（回归通过，尚未派发）

上述修复已选择性提交/推送为`a8d859bb37f0f8963c45e60a991af3e7abea8920`，
十二文件、十三个无关文件保全，尚未派发CI。派发前进一步核对发现：API job
默认5432，而新增回归执行的原扫描夹具只接受65438/45438；真实guard在数据库
import前拒绝5432，Node配置红测18通过/1失败。没有放宽seeder或跳过新测试。
仅将API job自己的临时PG/连接对齐既有65438约定；Web和镜像内存fixture仍
用原5432。六个job、原45/60分钟及所有资源/读取/逐帧门槛不变。
三项既有CI脚本回归62通过；相同39项在独立65438 PG再次通过，保留一条既有
Alembic警告，不与前组累加。PG严格核验身份/零其他客户端后停止，资料保留。
原输入清单未含本次五个CI test/helper文件，补入后共1388项；源库文件与
548项已构建Web输入无漂移。完整解析对比确认只有API fixture env改变，
未改其他工作流字段。新增[端口兼容回执](../evidence/reliability-2026-11-13/ci-api-port-verification.json)
保留guard/Node红测、编码/原Git字节比较的预检错误与精确输入；旧回执不改写。
完整本地API/worker、生产恢复与部署均未启动，没有新安排；完整CI仍待派发。

### 11月14日：端口修复完整CI失败（本地修复通过，未部署）

端口修复选择性提交/推送为`5fcb835b23bb76779f203519ce6346422544e14a`，
十个任务文件；远端master独立核对一致，1388项源码、548项已构建输入及
十三个保护文件均无漂移，索引空，没有amend/force push。最终YAML比较
保留原Git末尾换行，确认只有API fixture env变化；首次预检误去掉末尾
换行造成的shell block比较拒绝另存，不是应用失败，不改旧修复回执。
新完整[CI43459604614](https://github.com/foolkking/chat-reader/actions/runs/43459604614)
在**00:07:59.560391 +08:00**确认派发，首次状态读取不早于
**00:57:59.560391 +08:00**；[独立派发回执](../evidence/reliability-2026-11-14/ci-port-dispatch.json)
只证明派发，不是通过或发布。等待器在当前任务进程内遵守50分钟边界，
未创建安排；最初等待期只准备精确制品/部署核验。随后两次另行明确授权的
定点停止与保全见下，没有停服、备份、迁移、部署或清理。旧CI成功项不继承，
立即定点恢复授权不免除原发布门槛。

本轮实际首次读取为**00:58:03.927117 +08:00**，满足50分钟边界；最终
API/阅读性能通过，Web失败，Settings在原60分钟job上限取消，两个发布job
跳过。本轮没有发送CI取消请求；Settings此前已有三个Task Center导出QUEUED
及一个离线重建generating失败，停机后的ECONNREFUSED不是根因。
四份官方已结束job日志、三份诊断ZIP已保留并再次核对官方摘要，不是发布制品。
[独立失败回执](../evidence/reliability-2026-11-14/ci-port-failure.json)不覆盖派发或事件回执。

已核对两项Web失败：旧409用例仍按“加载即采用基线”直接保存，实际产品要求
先比较、显式接受最新基线；部分detach在列表refetch前使用含糊的全体checkbox
断言。Settings另一个Task Center人工processing任务未在finally完成取消，
新监督器正确拒绝越过该legacy执行。本批只校准测试流程和精确夹具收尾，
用真实PG/实际mounted组件保留复现，不改应用、监督保护或原门槛。
先前成功项不能继承为下一版本完整CI通过；生产仍旧版，未备份/迁移/部署。

### 11月14日：比较恢复与人工动作任务收尾（本地通过，新CI失败）

- Task Center人工processing/cancelling任务在真实PG下挡住下一导出/离线任务，
  原300秒恢复和监督器保护均正确。缺disposer的原14项先红；原身份回执与
  精确收尾实现后三模块专项**50通过**，其中新夹具24项。所有终态回执保留，
  wrong scope/creation/start/attempt/token/control及四类opt-in拒绝；真实retry
  的queued/受监督/已提交状态只读保留。请求原取消服务，再以原执行指纹
  调既有取消终结路径，不清队列、不手改任务完成状态或接管真实child。
- 直接执行原TypeScript晚到响应测试的**4项**Node用例，覆盖retry/cancel的
  初始化失败和迟到响应失败。finally先释放并等待route退出，再精确收尾；
  删除disposer的独立内存负对照使四路径均拒绝。该4项包含在Node全组，
  不重复累加为覆盖率。
- 409用例改为真实并发canonical写入，比较→显式接受最新基线→再保存；
  核对原草稿/长源码caret与滚动、比较/接受均不PATCH、最终version+UTF8 SHA
  和新操作身份。mounted原99项及三个宽度新组共**102通过**，两项旧流程负
  对照均拒绝；API网络整链仍交给完整CI，不能把HTTP adapter当真后端。
- detach显式绑定失败原文件身份，等待成功项消失并读取剩余canonical ID，
  保留单项重试/最终空列表。实际文件组件持住refetch，先保留旧含糊断言的
  两checkbox strict红测；修后失败项仍选中、成功项立即取消选择，原12项加
  三宽度持住读取组共**15通过**。不加sleep/超时，不用`.first()`掩盖竞争。
- Node UX **2510**、既有CI脚本**62**、安全/PWA单测**20**、lint/typecheck
  通过，build-info只写任务目录。新548输入、同安装依赖隔离Next构建通过；
  三个e2e也属于构建输入，拒绝继承旧构建，源库/副本漂移均0。1390项源码/
  测试/配置及十三个保护文件核对，应用/工作流/migration/部署代码未改。
- 保留一条既有Alembic警告。PG本机启动包装层因Windows继承pipe迟迟不退出；
  先核对确已ready的自建库身份，只终止原Python包装层，数据库未终止。
  初版host文本守卫在操作前拒绝、ZIP sibling路径预检和比较区多summary
  定位错误均保留，修正方法而非应用。最终PG按原data/PID/零其他客户端
  核验停止，资料未删。未启动完整本机API/worker服务或绕过此前启动拒绝。

[独立修复回执及输入](../evidence/reliability-2026-11-14/ci-recovery-verification.json)
记录实际源码/测试/构建与失败方法，不覆盖前批回执。没有新增生产操作、
自动重放、清理或安排；Linux总内存/信号、原帧矩阵、精确五制品仍须完整新
CI，实体设备/产品/宿主恢复验收仍由用户完成。

### 11月14日：修复提交与完整新CI（已失败/单次取消，未部署）

- 精确修复`7f8a6425a1d3b9f5c255925ce55340a406a3e063`选择性提交/推送
  十九个白名单文件；本地/远端master核对一致，1390项源码/测试/配置、
  548项新构建输入和十三个保护文件无漂移，索引空，没有force push。
- 完整[CI43483733253](https://github.com/foolkking/chat-reader/actions/runs/43483733253)
  于**02:33:11.802991 +08:00**确认派发；首次实际读取
  **03:23:11.814857 +08:00**满足50分钟边界。[独立派发回执](../evidence/reliability-2026-11-14/ci-recovery-dispatch.json)
  只证明这一次派发，不是CI成功或部署证据，不覆盖旧失败/事件回执。
  等待器位于本任务进程内，执行wall-clock及monotonic双边界，不创建安排。
- API/Web确认失败后，**03:26:36.093662 +08:00**单次请求取消；
  **03:27:03.210582**独立确认整次completed/cancelled。Settings取消、性能
  跳过；build-images/inspect-release-artifact取消且均零step，未执行或下载发布
  制品。生产仍3564cbf/schema0060，两次定点恢复授权均已执行完，不重复恢复
  helper或重放输入。任何新活动任务都必须重新核对安全边界。

### 11月14日：API探针、Web比较定位及Settings分页（本地通过，新CI待派发）

- 三个实际执行job日志已保留；旧下载器随后请求零step build日志失败，
  属取证方法问题。仅补已下载日志的SHA/provenance，不重复取消或重新下载；
  两份官方质量诊断ZIP精确匹配run/SHA/attempt并核验官方digest，不是发布制品。
- API原45分钟full-suite上限仍保留，到约95%停止，未发现FAILED断言；
  未执行余项不得算通过。真实120秒faulthandler停在20轮draft generator的
  `gc.collect()`；该测试约141秒，相同旧CI约119秒。另两组scan及unit retention
  探针也重复全堆GC。先保留真实writer的20次collect成本观测，再仅在先前弱
  引用仍活着时collect；每轮零保留、最终引用/顺序/summary保持。三项controls
  先红2失败/1通过；修后已释放引用0次collect、首个不可达自环实际collect一次，
  故意保留前一conversation的writer仍在第二单元被原断言拒绝。原三模块24通过。
  受控20万tracked-list诊断从20次collect/2.155秒降为0次/0.019秒，只是探针
  成本观测，不是完整API或内存验收。
- Web官方trace显示249行点击等待约88秒：真实并发写入、409、读取最新及
  草稿/caret保全均已完成，两次route.continue均正常退出。实际main下的footer
  不具隐式contentinfo角色；mounted夹具原为顶层div，未暴露该差异。
  改为真实main祖先的原组件红测匹配0元素，保留证据；不是仅catch 270行finally
  或去掉route等待就算修复。原90秒、比较/接受不PATCH及真实最终保存断言不变。
  修后workspace内唯一native footer定位，mounted夹具还断言contentinfo数量0，
  防止夹具重新脱离真实main而隐藏错误；原102项mounted组通过。
- Settings取消前还有一项真实768宽度管理员分页失败：20+1页只有20个unique
  IDs，不能把它当取消后的连接错误。原文件明确关闭trace；官方只有
  error-context。真实PG/认证TestClient复现原messages/insert已提交但derived/
  index follow-up仍queued，任务在两次分页间完成并改变排序；materialization后
  两页合并为21，原4条messages和offline_revision保持。e2e在生成其他20项前
  用原owner读取本对话既有derived_data_rebuilt event，原20秒action边界内等待
  total=1；没有不存在的derived_job_id、新API或同步业务实现，分页/搜索/只读/
  附件/删除断言均保留。最终七模块API/PG专项**39通过**，包含前三模块，不累加。
- Settings成本对照：本次取消前312个完成结果累计约3003秒；前次458个结果
  约3420秒（含四个约60秒失败），最大热点export-retention约578秒。这是预算
  风险而非本次已触及60分钟上限的证明；不提高job边界、不改真实TTL或断言。
- 最终mounted编辑器**102**、Node UX**2510**、CI脚本**62**及安全/PWA单测
  **20**、lint/typecheck通过。Typecheck的build-info只写任务目录。两个修改的
  e2e仍属于Web构建范围，拒绝继承旧输出；新**548输入**同安装依赖隔离Next
  build通过，原库和副本漂移0、未复制env。最终**1391项**源码/测试/配置及
  四个Python AST、单一head0061、十三个保护文件核对通过，索引空。
  本机Node20.13.1/Python3.11.7/PG17不冒充CI的Node22.13.1/PG16。自建PG按
  原PID/exe/data/loopback及零其他客户端核验停止，集群与全部失败证据保留。
  本批只有测试/夹具与必要文档/回执变更，未改应用、工作流、migration或部署。

[独立失败回执](../evidence/reliability-2026-11-14/ci-recovery-failure.json)不覆盖
派发/生产事件或上一批修复回执；
[Settings分页补充回执](../evidence/reliability-2026-11-14/ci-recovery-settings-failure.json)
只补官方取消前失败及真实PG复现。十三个保护文件与1390项原输入重新核对，
没有新生产操作、完整本地API/worker服务、清理、用户资料重放或安排。
[本批最终回执](../evidence/reliability-2026-11-14/ci-probe-pagination-verification.json)
及精确输入不覆盖前批。完整新CI、Linux总资源/信号、原完整帧矩阵及五份
精确制品仍须通过，再做fresh生产准入/备份/迁移/部署；用户验收范围不代做。

### 11月14日：探针/定位/分页修复提交与新完整CI（派发记录，后续失败）

- 选择性提交/推送`74a1e8605bc00d64b543544041c3095566f2881f`共十九文件；
  1391项最终源码/测试/配置、548项新构建输入、十三个保护文件无漂移，
  本地/远端master精确一致，索引空，无amend/force push或全量暂存。
- 新完整[CI43503483829](https://github.com/foolkking/chat-reader/actions/runs/43503483829)
  在**04:38:55.083438 +08:00**确认派发；首次读取不早于
  **05:28:55.083438 +08:00**。[独立派发回执](../evidence/reliability-2026-11-14/ci-probe-pagination-dispatch.json)
  不覆盖旧失败或事件回执，只证明派发。等待器在当前任务进程内从启动后
  完整等待五十monotonic分钟并核对wall-clock边界，不创建安排或提前读状态。
- 六job、原API45/Settings60分钟、读取/信号/内存/完整逐帧门槛不变。新run
  不继承前次局部成功；该派发时点尚无通过结论或发布制品，后续失败见下。
  生产仍3564cbf/schema0060。
  两次定点导入恢复授权均已执行，不复用旧helper取消新活动任务或重放来源。

### 11月14日：完整CI失败、Web旧语义修复与精确CPU诊断（未部署）

- `43503483829 / 74a1e86 / attempt1`首次读取
  **05:28:55.244142 +08:00**满足新50分钟wall-clock/monotonic双边界；
  **05:39:07**独立确认completed/failure，取消请求**0次**。
  API**6656通过/3跳过/5 warnings，2009.90秒**；Settings**470+独立restore1**
  通过。Web五项失败、reading comparison一项失败；build-images和
  inspect-release-artifact均skipped，未执行发布步骤或产生可部署制品。
- 四份官方job日志和三份ZIP精确run/SHA/attempt/官方digest均核验、安全解压；
  `gh run view --job --log`在整run仍执行时拒绝取已结束job日志的方法失败保留，
  改用官方jobs/logs接口，不因取证方法失败取消run。
- Web五份官方trace逐项定位：两文件实际201且列表齐全，重开caret在图片引用
  上，picker提供Replace而不是Insert；最后引用删除已自动KEEP，无旧确认弹窗；
  第一finalize held时两draft pending且第二上传尚未开始；unknown finalize第一次
  Retry只读原session/item，第二次显式重试原条目；unknown save须Check result后
  Retry original save。不是缓存丢文件、数据库删除卡死或原导入资料损坏的证明。
- 仅校准两个旧e2e和已有挂载夹具，保留源文件/历史引用、串行次序、save blocked、
  无transient、单次上传及原operation/base/hash快照复用断言。真实Files显式detach
  与历史content可读断言保留，不改应用、工作流、migration或部署代码。
  挂载编辑器**117**（原102全部保留，三宽度新增15）、Files**15**通过；
  真实API/TestClient选定三模块**75**、Node UX2510、CI scripts64、
  安全/PWA20及最终lint/typecheck通过。API组使用现有SQLite/inline合成夹具，
  不冒充PG/Linux总内存或完整服务验收，不重启已停止的PG。
  两e2e仍属于构建范围，拒绝继承旧输出；新**548输入**同安装依赖隔离Next
  build通过，原输入与副本漂移0，未复制env；最终**1391输入**与十三个保护
  文件核对通过、索引空。新增修改仅三项原测试/夹具，业务和部署代码未变。
- 首轮挂载117个场景body执行完，但全局console断言因三次刻意注入500失败；
  原脚本/日志/未完成回执保留。修正精确匹配三条消息、各自请求URL和数量，
  任何额外transport/renderer/application错误仍失败。不是屏蔽console或放宽门槛。
- Reader同runner baseline九例通过，candidate八通过/一失败：
  **math10000 cold0 longest/total213ms、p95约16.8ms、mounted22**，其余两个
  cold long task均0，parse91/render119/math17未随tier增加。原unfiltered JSON
  保留，但trace关闭且无CPU栈；213ms及历史223/331ms根因尚未证明，不称噪声
  或已修，不猜改TOC、GC、KaTeX。
- 仅派发已有完整九例CPU诊断
  [43514182245](https://github.com/foolkking/chat-reader/actions/runs/43514182245)，
  精确`diagnostic_ref=74a1e8605bc00d64b543544041c3095566f2881f`；
  **05:50:15.070938 +08:00**确认派发，首读不早于
  **06:40:15.070938**，当前任务进程从启动完整等待3000 monotonic秒并核对
  wall-clock。baseline→candidate原九例/顺序/门槛均保留，每cold追加CPU；
  **diagnostic-only，不是发布验收**，不能继承其通过或覆盖原失败。

[独立失败回执](../evidence/reliability-2026-11-14/ci-probe-pagination-failure.json) /
[CPU诊断派发回执](../evidence/reliability-2026-11-14/ci-runtime-frame-diagnostic-dispatch.json)
不覆盖旧派发/失败/生产事件。十三个保护文件与索引仍保全；不重启或再次停止
旧测试PG、不启动完整本机站点、不建安排、不操作生产或重复两次已完成的取消。
必须新完整精确CI全绿、五份精确制品及fresh容量/备份/迁移/部署安全检查。

### 11月14日：CPU诊断结束与真实阅读坐标修正（本地通过，完整CI待派发）

- `43514182245 / 74a1e86 / attempt1`已completed/failure；首次读取
  **06:40:15.205718 +08:00**满足wall-clock及**3000.015秒**monotonic边界。
  全18份测量、54份cold CPU profile和官方ZIP/日志摘要核验保留。
  baseline两例、candidate一例失败均是旧raw scrollMonotonic；candidate
  plain1000 cold1两段长任务只有`(program)`栈，不能归因TOC/GC/KaTeX。
  math10000三cold长任务为0/58/0ms；原非profile213ms未复现，不称已修。
- 原六份retention trace及同一实际Reader/plain1000正负对照证实：
  合法整轮回收可大幅减少raw scrollTop而真实DOM锚点不后退；真实-120px
  轮间回跳又可被下一wheel抵消，旧轮间raw comparator反而漏检。
  测量v4在每rAF/每wheel用仍连接的共享真实block/article，按前一阅读线
  排序选锚点；同ID重挂、版本变化、缺共享/可见锚点均不能伪造连续。
  原raw samples/reversals、所有chronological frames/longTasks完整保留。
  原2px、34/150/250ms、40/120 DOM门槛及30×120px+34ms输入均不变；
  未改应用、250ms回收策略、工作流、migration或部署代码。
- 实际collector13项先红**5通过/8失败**，修后三模块专项**25通过**；
  同组包含在最终Node数，不重复累加。真实mounted Reader原39场景逐字
  保留，加合法回收/反向wheel/轮间回跳三组，最终**42通过**。
  第一次完整mounted run完成37项后，诊断quiet开始时edge仍busy，未触发
  回收；保留原脚本/result/失败现场。仅在诊断夹具中先有界等edge settled，
  再计400ms quiet；发布capacity采样不新增pause或放宽时限。
- 最终Node UX**2519**、CI scripts**64**、安全/PWA单测**20**及
  lint/typecheck通过。先前同批editor117/Files15/API TestClient75输入
  未变，不冒称追加重跑或真实API网络验收。官方fixture的原PATCH及
  v3响应证实正文末尾是普通文本，Control+End在引用范围外；未再改e2e。
- capacity变化拒绝旧build，新**548输入**同安装依赖隔离Next build通过，
  原库/副本漂移0、未复制env。最后诊断夹具修正后重新捕获**1391输入**，
  十三个保护文件无漂移、索引空；较早1391清单不冒充最终输入。
  本地回执初版误读Files不存在的errors数组，在写证据前失败；方法和日志
  保留，按真实status/results校验，不制造console/page telemetry。

[CPU诊断结果](../evidence/reliability-2026-11-14/ci-runtime-frame-diagnostic-result.json) /
[最终本地回执](../evidence/reliability-2026-11-14/ci-runtime-frame-verification.json) /
[最终源码输入](../evidence/reliability-2026-11-14/ci-runtime-frame-inputs.json) /
[新构建输入](../evidence/reliability-2026-11-14/ci-runtime-frame-build-inputs.json)。
不重启/再次停止旧自建PG，不绕过完整本机站点启动拒绝，不清理或重放来源，
不重复两次已完成的生产取消，不创建安排。完整新CI及五份精确制品、fresh
容量/停写备份/0060→0061/健康保全仍须完成；产品、实体设备、灾备由用户验收。

### 11月14日：坐标与上传夹具修复提交、完整CI超时（未部署）

- 精确候选`b2d3a653f9655a6480d4f669cc12446030655037`选择性提交/推送
  二十个白名单文件；本地/远端master一致，最终1391输入和新548构建输入、
  十三个保护文件无漂移，索引空，没有amend/force push或全量暂存。
- 完整[CI43531859718](https://github.com/foolkking/chat-reader/actions/runs/43531859718)
  于**08:06:06.651342 +08:00**确认派发；首读不得早于
  **08:56:06.651342**，并须任务进程启动后完整3000秒monotonic等待。
  实际首读**08:56:06.772164**满足wall-clock及完整**3000.0秒**monotonic边界；
  **09:09:01**独立确认completed/cancelled，未请求取消。
  [独立派发回执](../evidence/reliability-2026-11-14/ci-runtime-frame-dispatch.json)
  不覆盖旧失败/诊断/事件回执，也不证明成功。
- 等待期仅准备本地精确制品/质量/生产安全核验材料，不建立安排、不操作生产、
  不复用已完成的两次导入取消授权。原六job、自动资源/信号/完整逐帧和
  备份/迁移门槛不变；生产仍3564cbf/schema0060。

### 11月14日：Settings原60分钟超时与忙队列节流修复（已提交，新完整CI仍超时）

- 官方Settings check在**08:06:11–09:06:28 +08:00**执行，明确注解
  `The job has exceeded the maximum execution time of 1h0m0s`。取消前按完整
  标题核验**344项通过、0项打印断言失败**；五项后来打印失败发生在API
  关闭之后。原470矩阵及fresh-instance restore未完成，实际gate JSON仍为
  `running/test_count470`且没有result_counts，不能编造最终报告。
  API、Web、阅读比较成功，两发布job跳过；四份官方日志及三份ZIP摘要/来源
  核验保留，不是可发布镜像。没有取消、部署或新生产操作。
- 与74a1e86/43503483829按同名**344项**匹配：打印时长累计
  **2778.976→3415.803秒，+636.827秒/+22.9%**；分钟显示存在舍入，
  不把它称为精确handler耗时。旧完整矩阵56.7分钟+独立restore40.2秒本已接近
  job上限。两精确commit的**1138项**应用/Settings/workflow输入不变；
  尚未证明应用回归或全部环境变慢原因，取消后五项不加入耗时比较。
  官方runner同为Ubuntu26.04.1，image version从20261111.82.6变为
  20261111.196.1；仅说明环境身份不完全相同，不据此认定镜像或CPU根因。
- 同窗口worker日志有**394次committed/25次failed事件**，含故意业务失败，
  不当作394项测试或25项断言失败。相邻完成间隔包含排队、启动、业务和HTTP/
  poll成本。Windows单次冷导入background_jobs约4.580077秒，仅是本机诊断，
  不证明Linux CI根因，也不改成fork、连接复用或常驻执行池。
- 真实生产循环每次监督完执行子进程都强制等待原1秒idle poll。新增实际
  主循环受控租约/子进程测试先红**8失败/9通过**，保留原代码/测试/日志SHA。
  最小改动仅让已监督退出的child立即进入下一轮：仍重新取得监督租约，
  先canonical核对再检查执行租约；任一失败/空队列仍等待原poll，不busy-spin。
  不以OS退出代替PG租约释放，停止/替换仍阻止下一项，四类维护仍单槽有界。
- 既有真实PG父子进程两任务用例保留poll1，追加故意更慢的poll20对照；
  原25秒整体、下一项10秒及不重叠断言全部不变。已停止的本机PG不再启动，
  此新增真实PG/Linux/信号/内存验证交完整新CI，不冒称本机已测。
- 最终十一模块API专项**153通过/43跳过，120.52秒**；原17项实际循环
  控制全部通过。PG模块及Windows POSIX限制仍为未执行，不换路径启动旧PG
  或完整站点。此前153/42结果在PG参数追加前采集，不当作最终新测试覆盖。
  CI脚本**64**、lint/typecheck、单一head0061通过；最后**1392输入**在最终
  专项前后无漂移，十三个保护文件、全部**548旧Web build输入**字节不变。
  Web应用/测试/依赖未改，不冒称追加Node UX/挂载/PWA或新build运行。

[独立失败/耗时回执](../evidence/reliability-2026-11-14/ci-runtime-frame-failure.json)
只说明已失败run；
[本地最终回执](../evidence/reliability-2026-11-14/ci-settings-scheduling-verification.json)
及[1392项精确输入](../evidence/reliability-2026-11-14/ci-settings-scheduling-inputs.json)
只说明本地回归。修复已选择性提交/推送为
`9a0841461671dfdabd5d50a56f55e68f8ffde227`，十四个白名单文件；本地与远端
master一致，提交后1392输入/十三保护文件无漂移、索引空，无amend/force push。
完整[CI43543975636](https://github.com/foolkking/chat-reader/actions/runs/43543975636)
在**10:01:44.250642 +08:00**确认派发；
[独立派发回执](../evidence/reliability-2026-11-14/ci-settings-scheduling-dispatch.json)
绑定精确SHA/run。dispatch wall-clock边界为**10:51:44.250642**；原等待器
在**10:03:18.450682**启动，须完整等待新3000 monotonic秒，所以实际首读
UTC预计**10:53:18.450682**。实际请求**10:53:18.448494**、收到结果
**10:53:21.276186**；从派发wall-clock**3094.197852秒**和新monotonic
**3000秒**均满足50分钟合同。请求相对等待器UTC预计值早**2.188ms**，等待器
wall跨度2999.997812秒；两种实际合同门槛不因此混淆，原时间和回执不改写。
[实际首读回执](../evidence/reliability-2026-11-14/ci-settings-scheduling-first-read.json)
保留全部差异。首次快照API/阅读比较成功，Web/Settings仍执行，未接受整次CI
或制品；原首读及completion等待器均已结束，不再重启它们。
未重派发、取消、提前下载制品或操作生产。
已按07批最终helper SHA核对后改绑本次run，原等待器未替换。独立消费者新增
全部17个唯一监督单测及真实PG的`[1]`/`[20]`精确PASSED要求，重复、缺失、
跳过、失败或只匹配函数名均拒绝；实际消费者调用的20项控制通过。
连同原OCI层次/whiteout、容量合算、来源保全、原PG/TS回调、挂载schema和
measurement v4，共**77项本地控制通过**。另核对13份已有真实输出schema及
3份已有DOM坐标正负对照，仅用于消费者方法检查，不当作新应用或CI验收。
1392源码输入/十三保护文件再次无漂移、索引空；
[等待期机器回执](../evidence/reliability-2026-11-14/ci-settings-scheduling-waiting-preparation.json)
保留最终helper SHA和限制。未提前查CI、下载新制品、复用旧取消helper或触碰生产。
最终再将原Settings470全通过/0跳过、独立restore1和summary/result_counts一致
纳入实际消费者，六项新增控制连同原控制一次完整重跑**83通过**，不累加为160。
旧b2失败run已保留的两官方ZIP及全部提取文件逐字节复核后，13挂载schema、
原64+12+4/冷Viewer和18份v4/54 cold独立内容检查通过；仅用于方法诊断，
不继承给新发布、不修写旧制品或宣称原213ms根因已修。
[最终消费者回执](../evidence/reliability-2026-11-14/ci-settings-scheduling-consumer-final-preparation.json)
追加最终helper SHA及限制，不覆盖初次77项回执；1392输入/十三文件仍无漂移。
原资源、逐帧和部署门槛不变，不创建安排，
不清理或重放来源，不重复两次已完成的定点终止，用户负责产品/设备/灾备验收。

本次完整CI已在**11:04:21.516068 +08:00**独立确认completed/cancelled：
Settings正式注解仍为`The job has exceeded the maximum execution time of 1h0m0s`；
API **6674通过/3跳过/5警告/1822.28秒**、Web和阅读比较成功，两发布job跳过。
新官方API日志中的17唯一监督单测及真实PG的poll1/poll20均通过，不继承旧run。
Settings打印**451通过、三项终止窗口失败**；最后通过在11:01:48.2204839，
失败打印在11:01:59–11:02:01。API的`Shutting down`本行无原时间戳，
尚不能将三项全部定性为产品断言或关闭后失败。原470矩阵和独立restore未完成，
实际gate仍为`running/test_count470`且没有result_counts。
同名344项打印时长**3415.803→2975.303秒，少440.5秒**；有舍入，
不作为精确handler耗时或完整因果证明。worker有479 committed/25 failed事件，
含刻意业务失败；**maintenance_deferred/scheduling_paused均0行**，
不代表fresh helper冷导入成本为零。
[本次独立失败/耗时回执](../evidence/reliability-2026-11-14/ci-settings-scheduling-failure.json)
追加正式注解、四官方日志/三digest核验ZIP及实际未完成gate，不覆盖旧证据。
无取消请求、可部署镜像或生产操作。当前只做安全纯导入profiling与最小修复
调研；本机PG/完整站点仍不启动，不提高原60分钟、并发、内存或逐帧门槛。

### 11月14日：按需处理器与包含导入的维护预算（本地通过，待完整CI）

| 实证缺口 | 最小修复与不变边界 |
| --- | --- |
| 每个fresh child导入无关的编辑/归档/离线/删除等处理器 | 分发只加载轻量合同/模型，任务与格式分支按需导入原service；保留现有故障注入/删除委托，参数、结果、异常与业务检查点不变 |
| 噪声扫描还加载仅应用清理才需要的版本/索引服务 | 四个既有写回接口惰性委托，实际应用仍调用原实现；不改扫描识别、原文哈希、版本或回滚语义 |
| 维护先导入四类服务才开始2秒预算 | 预算从入口开始，逐lane导入并再次检查停止/时间；导入异常按类隔离，耗尽不再导入下一类。仍四类轮换/20项、父进程wait5秒和租约核对 |
| 轻量队列仍需要原编辑错误/归档类型 | 原MessageEditError逐字语义迁入轻量定义，旧editor路径reexport；个人类型沿用既有archive_task_status，原类别/权限不变 |

首先保留18项初始测试的**15失败/3通过**；补扫描依赖边界后另保留五项红测，
不把方法/委托测试失败都宣称为已发生的生产事故。最终新增**23项**通过。
原处理器、真实TestClient/SQLite、取消/回滚、归档/离线/导入等46模块整次回归
**591通过/65跳过，1178.17秒**，含新增23项，不累加成614项。
真实PG和Windows不适用的POSIX场景仍跳过；不重启已停的本机PG/完整站点，
新的精确CI必须实际运行它们。CI脚本64、lint/typecheck、单一head0061通过。
最终**1395输入**在完整专项/静态检查前后无漂移，十三保护文件及548旧Web
build输入不变；未声称新Web build/PWA/挂载、Linux内存/信号或生产验收。

独立纯导入使用307文件的9a精确Git源码和308文件同布局候选副本，同依赖/
新解释器/仅副本LF，每路径三次。分发+扫描额外导入中位数
**1.081→0.098秒**，账户删除**0.980→0.164秒**，离线**0.862→0.398秒**，
个人归档**0.825→0.683秒**，分析**0.941→0.194秒**，纯导出
**0.876→0.062秒**；扫描总模块974→654。含importtime开销和文件缓存/
调度差异，仅为Windows诊断，不外推Linux或整个CI可省多少秒。
两次探针护栏错误的原日志保留，不当作应用红测或修复证据。

[导入诊断](../evidence/reliability-2026-11-14/ci-worker-startup-import-diagnosis.json) /
[最终本地回执](../evidence/reliability-2026-11-14/ci-worker-startup-verification.json) /
[1395输入](../evidence/reliability-2026-11-14/ci-worker-startup-inputs.json)
不替代新完整CI。独立消费者新增23项精确case验收及11项拒绝控制通过；
旧日志缺项、任一跳过/失败、重复或错身份均拒绝，不用旧run补数。
没有取消请求、生产操作、安排、原资料删除/重放或预算放宽；
用户仍负责产品/实体设备/灾备验收，技术发布门禁不豁免。

### 11月14日：两次明确授权结束卡住导入（已恢复，生产仍旧版）

- 用户先明确要求现在终止原卡住任务，覆盖此前“CI全绿后才辅助取消”的
  时间条件，仅授权本次定点恢复，不覆盖精确CI、制品或部署门槛。
  **00:25:57 +08:00**重新核验三连接身份/时间/语句类别、同worker地址、
  完整锁链及全部canonical来源后，仅一次取消辅助进度SQL。旧服务自行回滚
  为`FAILED/IMPORT_COMMIT_FAILED`，attempt仍1，没有确认提交或canonical结果。
  两个来源共**21,410,219字节**，实际SHA与文件身份前后相同；后续合法分析
  完成，00:26:58独立快照无活动/排队任务、租约或锁等待，worker空闲。
- 初版方法将preview的一份上传计数当作全部来源；在执行任何取消前被守卫
  拒绝。保留该失败方法和stderr，改按实际两份SourceArtifact完整指纹与
  文件字节核验后才执行一次取消。不是文件损坏，也不是两次实际取消。
- **00:30:55 +08:00**开始的是另一ImportRecord、另一份输入，不是代理重放
  原失败任务。两份新来源共**2,596,483字节**，实际SHA与canonical记录一致；
  解析已到persisting/progress10，旧版再次形成canonical持锁、进度等canonical、
  心跳等进度的同类应用等待环。无worker重启/OOM，不能解释为正常缓慢推进，
  也没有证据据此认定输入文件坏了。
- 用户再次明确授权停止该新导入后，重新核验其执行开始/任务指纹、全部来源
  以及角色已交换的完整连接身份；不复用原操作的旧PID或原来源守卫。
  **00:43:36 +08:00**只一次取消新辅助进度SQL；旧服务再次自行回滚为
  `FAILED/IMPORT_COMMIT_FAILED`，attempt仍1、未提交/无结果，源文件大小、
  实际SHA和inode/mtime前后相同，没有删除、重传或自动重试。
- **00:44:39 +08:00**独立有界只读复核：活动/排队import与job、advisory租约、
  锁等待全部0；worker idle、心跳年龄0.18秒。全部11容器的ID/start/restart/
  镜像/配置/挂载，生产配置、dirty checkout、发布pointer及volume均未变；
  仍保留同一份备份目录，宿主OOM计数未增加。计数与队列是该时点观察，
  后续用户操作可以改变，不能把它无限期称为“当前空闲”。
- 新候选`5fcb835`的十个相关代码/测试文件及原真实PG红/绿日志SHA重新核对
  一致：进度和任务心跳跳锁/有界辅助写，独立控制记录、单子进程监督、真实
  进展检查点及commit代次/租约栅栏覆盖本次**数据库可用时的自锁机制**。
  无进展300秒请求停止、30秒协作宽限后有界退出，再核对结果/租约才调下一项。
  不是保证任意输入成功或任意数据库断网都330秒结束，也不会修复已运行的
  旧进程。未重跑原PG组、未冒称Linux内存/信号或完整新CI通过。

[脱敏事件机器回执](../evidence/reliability-2026-11-14/production-stall-recovery.json)
关联两次独立操作/保全及原代码验证证据，不保存真实业务ID、文件名/正文、
源摘要或SQL内容。没有手工改任务行、终止canonical连接、重启服务、
清队列、备份/迁移/部署、清理生产或建立安排。生产仍`3564cbf/schema0060`；
本事件操作时新CI尚未到00:57:59.560391首次读取边界；其后失败结果见上。
正式部署前不要反复重试
旧版导入来验证运气。

## 前一轮收尾记录（下方保留历史，不覆盖上述新授权）

## 1. 目标与现在的位置

目标不是“任何错误都继续”，而是：**阅读稳定；慢任务有界且可恢复；结果未知
可以核对；原资料受保护；管理员能用少量入口判断和处理问题；适合单并发小机器。**

用户已要求结束本轮、整理后再决定下一步。随后明确要求先恢复生产卡住队列，
该定点处理及代码补防护已完成；现在停止新增探索，不提交、推送、派发CI或部署。
**目标仍未整体验收完成，不能把本地测试成功等同于已经上线。**

| 层次 | 当前事实 |
| --- | --- |
| 生产 | 应用仍为`3564cbf`，11月11日发布；schema`20261108_0060`。11月12日只做定点运行态恢复，没有升级镜像。 |
| 已提交候选 | `master`的`7a4d61b`及前序A–L；精确CI`43025451379`六项成功，尚未部署。 |
| 本地待提交 | M/N/O：预览提交不确定性、失败清理/准入、重试读取身份、本机存储拒绝与归档状态；另有本次任务心跳跳锁补丁及回归。 |
| 验证边界 | M/N/O有本地API229通过/2可选跳过、Node2472、lint/typecheck、mounted12+12和544输入精确构建。本次后台专项91通过/4 Windows信号跳过。完整CI尚不覆盖这些后续修改。 |
| 工作区 | 保留原用户未提交修改、历史证据和任务临时目录；没有全量暂存、清场或创建自动安排。 |

[候选CI回执](../evidence/small-host-2026-11-11/ci-kl-acceptance.json) /
[M/N/O本地回执](../evidence/small-host-2026-11-11/import-mno-verification.json) /
[本次队列恢复](../execution/SERVER_QUEUE_RECOVERY_2026-11-12.md)。

## 2. 已经探索并落实的改善

| 方向 | 已有成果 | 不能据此宣称 |
| --- | --- | --- |
| 导入与排队 | 已发布选择顺序、单单元准入、慢资源等待、停止保留与显式放弃、源文件修复、缺附件/无法解析正文引用的兼容。候选补首次上传身份与只读回执、原输入保留、有限读取和真实状态；本地补清理失败不覆盖主错误、未知COMMIT不删来源、本机记录失败不阻断操作。 | 所有ZIP都能导入；危险路径、CRC、扫描、来源变更和真实超限仍须拒绝。未知写入不自动重发。 |
| 后台与小机器 | 已提交维护与心跳分离、单维护通道、事务本地时限、每批最多100条遗留恢复、canonical执行租约、进度跳锁及失败降级。本次再补任务心跳跳锁。仍只运行一个用户后台任务。 | 进程存在就一定在工作；心跳活着就能证明正文正在推进；无上限自动重试可以代替恢复。 |
| 阅读 | 已发布公式成本虚拟化、悬停范围收窄、触摸边界补载、真实消息位置、专注工具、返回强调计时和显式跨端接续。候选补完整轮次保护回收、有限GET/认证隔离、区分解析与渲染计数。 | 已解决所有实体平板滑动问题；两个设备应该强制同步滚动；CI未复现就说明间歇卡顿根因已修复。 |
| 文件与管理员 | 已发布显式清理边界；候选有持久清理回执、只重试未完成删除、私有回传输入有界维护、真实分类/摘要与失败读取恢复。 | 草稿过期等于可以删源文件；新回执能自动修复全部历史孤儿；应用`.cr`归档等于宿主灾备。 |
| 操作连续性与精简 | 表格只保留复制/下载、短时成功反馈、离线旧副本保全、导出选项保留已发布；候选补接续草稿/历史原字节保留、保存与刷新分离、原请求核对。 | 必须取消整个页面或把错误隐藏起来；完整刷新可以保留内存中的File；成功消息需要永久占正文位置。 |

## 3. 本次生产故障带来的明确结论

用户所见三个排队项，实际为**一个卡在持久化的导入和两个被挡住的导出**。
同一worker的canonical事务持有导入行锁；任务心跳等待该事务，进度写回又排在
心跳后面，形成包含应用调用的等待环。容器仍运行，但心跳停止约24小时。
不能把这种状态解释为“文件大，继续等”，也不能把两个合法导出当垃圾删除。

在核验连接身份、锁链、语句类型及年龄后，只取消被阻塞的辅助进度语句：
原导入事务正常回滚为失败，两个原文件的大小与实际SHA-256均核对保留；
后面两个导出正常完成。复核活动任务0、锁等待0、worker空闲且心跳更新。
没有重启服务、直接改任务为成功、清空队列、重放原文件或删除资料。

候选已有的进度隔离尚未发布，是“代码已改”与“生产已修”的实际差距。
新增心跳跳锁避免进入同一等待链，真实PostgreSQL回归覆盖两个辅助通道和
正文提交。**当前只恢复了这次故障；生产仍是旧代码，正式发布前存在复发风险。**

## 4. 后续按四个整块收敛，不再无限增加小优化

### 第一优先：发布闭环，而不是再找一批功能

冻结现有M/N/O及心跳补丁，按用户下一次指示做一次选择性提交、完整精确CI。
先检查前次失败，不降低门槛；没有新指示前不派发。CI成功后独立验收并获部署
授权，再发布并检查队列、心跳、慢导入和恢复入口。不要在旧生产上反复重试
本次卡住的原导入来“验证运气”。

### 第二优先：真实阅读与跨端验收

以用户平板和实际浏览器做双向连续滑动、长公式、TOC返回、折叠、一起阅读
隔离及两设备接续。记录输入、真实锚点和长任务，不再仅增加合成截图。
历史223/331ms冷长任务诊断未复现，根因仍待定；保留原门槛和全部帧。
跨端默认继续本机位置，发现远端新进度时显式接续，不强行抢走正在阅读的位置。

### 第三优先：小机器故障恢复的整链验收

在隔离且同预算的环境串联慢上传、断网、worker中断、取消待确认、原任务重试、
锁竞争、磁盘/内存压力。验证既不丢输入也不重复导入，队列能前进，恢复不用
退出账户；长任务有进展可慢慢做，无法继续时给真实原因和可执行下一步。
不在生产压测、不自动回放用户ZIP，不把一个总超时误作所有业务失败。

### 第四优先：文件生命周期与管理员日常闭环

核对历史失败来源、草稿、回传包、导出、离线替换及账户删除的分类边界；
先给有界只读清单，再由管理员明确处理，不按年龄盲删。
用隔离恢复演练验证备份可用，明确恢复步骤。历史只保留一份备份的事实，
不等于已经验证异地冗余或可恢复性；新备份确认之前不删唯一好副本。
管理员默认保留必要摘要与行动，不新增常驻信息墙。

依赖审计的3项非阻断公告另开有界兼容性审查；尤其公式引擎升级必须同时验证
MathML、复制、安全与性能。不要把它扩展成一次全面依赖升级。

## 5. 什么条件下可以结束这个目标

1. 冻结范围的精确CI、制品与获授权后的生产验收完成；状态不再混用。
2. 实体阅读关键路径通过；尚不能复现的问题有明确复现材料/限制，而非伪报已修。
3. 主要故障矩阵能安全结束或原地恢复：无无界假排队、无重复业务提交、无静默丢输入。
4. 文件清理能解释“保留/待处理/已清理”，管理员可操作；隔离备份恢复得到验证。
5. 文档入口只有一份当前结论；剩余低优先级改进转入普通待办，不再阻止本目标收尾。

详细历史：[原分块方案](../planning/SMALL_HOST_OPERATIONS_2026-11-11.md) /
[实施与失败账本](../execution/SMALL_HOST_OPERATIONS_2026-11-11.md) /
[已发布基线](../execution/RECOVERABLE_OPERATIONS_RELEASE_2026-11-11.md)。
