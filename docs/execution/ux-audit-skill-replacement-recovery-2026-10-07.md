# Skill 替换恢复审计 — 2026-10-07

第十一批本地优化。上一目标轮为 progress：账户与安全修复已完成真实验收和
文档交付。本批审计个人／系统 Skill 文件替换，目标仍为持续优化；不提交、
推送、触发 CI 或部署。

## 范围与改动前证据

依据当前组件、API 和 Context Skill 合同；浏览器行为先复现再改动。沿用
ux-audit 和 interface-design，面向更新个人能力文件的用户及系统管理员。
仅处理替换结果、下载一致性、冲突及失败恢复。其他设置仍属于后续审计范围。

| ID | 类型／严重度／置信度 | 证据及用户影响 | 优先处理／工作量 |
|---|---|---|---|
| FBK-11 | Defect / High / Observed(code); runtime Inferred | SkillBundleFiles.onSuccess 丢弃已返回的 revision，清除文件后等待列表和解析刷新；真正保存了也可能长时间不显示成功，下载仍指向旧版本 | 先采用已确认 revision／下载链接，再独立刷新；旧读取取消。M |
| ERR-11 | Defect / High / Observed(code); runtime Inferred | 所有替换错误统一显示“刷新后重选文件”；409 无法在当前页读取新版并继续，刷新会丢失已选文件 | 保留文件，读取最新版本并提供下载；用户再次明确确认替换，绝不自动覆盖。M |
| STATE-11 | Defect / Medium / Observed(code); runtime Inferred | 普通网络错误、非法 Bundle、权限问题共用同一提示；已提交但丢响应也称为失败 | 分类反馈；不确定结果同文件同基础版本重试，沿用服务端 digest 幂等；格式错误重新选文件。M |
| ERR-12 | Defect / High / Observed(code); runtime pending | 本批首版恢复只从历史 revision 列表找当前版本；系统恢复内置后回到 revision 0，历史列表无此项，恢复流程无法继续 | 无当前历史条目时读取当前文件元数据，使用服务端返回的版本／下载地址。S |

快速收益先保证“已替换”和真实下载一致，再补齐冲突流程。不存在模型或脚本
执行；三个默认 ZIP 字节、个人选择、无克隆／查看器／编辑器的产品决策保留。
版本与 digest 已由现有后端维护，本次优先复用，不建立新候选／审核模型。

## 设计与验收

Intent：用户在原行完成替换，知道文件是否保存，遇到冲突仍保留所选文件。
Palette／Surfaces：沿用纸白、石墨和海绿，红色仅错误，浅深色共用既有 token。
Depth：原有行分隔和局部错误区，不新增装饰卡片。Typography：现有字体和
text-sm/text-xs 层级。Spacing：4px 基础单位，主要恢复按钮至少 44px。

375/768/1440px、中英文／浅深色验证个人与系统替换。以真实 PostgreSQL/API
写入为准，注入延迟读取、读失败、真实提交后的丢失响应。下载解包检查成员
字节、版本数、个人首选与系统回退；冲突再更新不得覆盖新版本。截图使用
合成文件，不保存真实内容或凭据。

临时目录 `wkkk/chat-reader-skill-replacement-20261007`；复用并恢复原独立
PostgreSQL 集群，不重新初始化。初步假设中的其他 Skill 管理操作、格式改名
和管理员功能策略保存仍待独立运行验证，不据此声称已经修复。

## 执行结果

### 实现

替换响应确认后，先取消旧列表／解析读取，再将服务端返回的文件信息写入
个人／系统列表缓存；不等待后台刷新才显示“已替换”。刷新失败单独报告，
仍可下载已确认版本。系统更新只改变文件信息，不覆盖个人选择。解析缓存
清除旧正文后重读，避免旧指令与新下载链接混用。

冲突保留 File 对象和原输入，提供“读取最新版本”及版本下载。读取失败可
原地重试；必须再次明确点击“用所选文件替换此版本”才提交。读取后又有新
更新仍返回冲突，不能静默覆盖。恢复内置／原始文件的 revision 0 没有历史
行时，读取当前详情的 revision 和下载地址，不以最大历史版本冒充当前版本。
详情接口原有正文投影仅在该回退读取中返回，界面不新增查看器或编辑器。

网络失败明确“尚未确认”；同文件、同基础 revision 重试复用后端已有 digest
幂等逻辑。非法大小／格式提示重新选择，权限、会话、不可用对象和限流有
对应说明。恢复动作与替换成功后恢复键盘焦点，主要动作至少 44px 高。
读取按 20 秒有界且可取消，替换请求按 60 秒有界。卸载／账户代际检查阻止
旧结果写回其他账户。当前服务端事务、权限、版本和归档规则均未改动。

涉及 SkillBundleFiles、个人／系统设置组件、API 客户端及轻量 skill-cache
辅助函数。三个默认 ZIP 与公共资源未改动；不执行包内脚本，不增加候选、
克隆、文件树、版本编辑 UI。

### 验收与失败记录

| Gate | 结果 | 解释 |
|---|---|---|
| `skill-recovery-baseline` | 3 failed | 个人成功反馈等待刷新、冲突无法继续两项真实复现；系统项未到操作，测试把 `System skills` 大小写写错 |
| `skill-recovery-system-baseline` | 1 failed | 修正定位后，真实系统替换已提交，但“已替换”仍等待列表，复现成功 |
| `skill-recovery-first` | 21 passed / 1 failed | 13 个新恢复场景全过；新增消费端回归错误地对已恢复的导入任务再次上传／点击预览 |
| `skill-recovery-delivery` | 22 passed / 0 skipped | 修正测试，使原导入任务重新打开 Normalizer，验证立即使用新的个人版本 |
| `skill-recovery-restore-baseline` | 1 failed | 首版恢复遗漏 revision 0；真实恢复内置后没有可继续的确认按钮，记录为本批实现缺口 |
| `skill-recovery-final` | **23 passed / 0 skipped** | 最终 14 个恢复场景 + 9 个既有 Bundle/消费流程回归，全数通过 |

不累加这些重叠 gate。真实 PostgreSQL/API 浏览器用例覆盖个人与系统三宽度
替换、延迟／失败刷新、下载成员字节、个人首选、两类丢失响应的幂等重试、
非法 ZIP 后重选、读新版失败后恢复、第二次版本冲突、系统恢复内置再替换。
验证实际 revision 数量、旧内容保留和下载内容，不以按钮可见代替执行。
Normalizer 回归在同一浏览器已有缓存的情况下，替换后重新进入原失败导入
并下载新 revision；不是重新登录或清空缓存后才通过。

API 专项 `test_skill_bundles.py`、`test_skill_zip_defaults.py`、
`test_skill_unified_preferences.py`、`test_skills_api.py`：**34 passed / 0 skipped**。
这些隔离 SQLite/文件 fixture 验证真实持久化、跨账户拒绝、系统替换审计、
旧版本、重复提交、默认三包与个人选择；不冒充独立 PostgreSQL migration 专项。

最终 lint、非增量 TypeScript、普通 Web build、`git diff --check` 通过；
Alembic 单一 head `20261006_0048`。无 schema 变化。没有重跑全量 API/PWA、
整站 UI、独立外部模型 Skill 或生产验收，不计为通过。

### 证据和交接

[证据目录](ux-audit-skill-replacement-recovery-2026-10-07-evidence/) 保留六份浏览器
gate JSON、一份 API 摘要、四张基线及 30 张最终合成截图。基线和关键状态逐张
检查，最终全部截图在五张缩略图总览中检查；没有声称完成全站无障碍评估。
首次测试定位错误、导入恢复假设错误、revision 0 的真实实现缺口分别记录。

临时文件仍在本批 C 盘目录。独立 PostgreSQL/API/SMTP/worker 已停止，
65438/8008/8328/3107 均核对无监听；未重新初始化或清理残留。十一批改动均未提交，tsbuildinfo 不暂存，
生产与部署不变。长期目标仍 active；其他 Skill 操作／格式改名／功能策略的
恢复问题需要新的运行证据，不作为本批已完成项。
