# Chat Reader — Release J

# Cleanup / Retention First-Apply Closure

# TASKS.md Continuation + Autonomous Execution

你正在 Chat Reader 项目中继续 Release 系列。

你的任务不是只输出计划。

你的任务是：

1. 将本 Release J 作为下一阶段任务安全写入现有 `TASKS.md`；
2. 保留 `TASKS.md` 已有 Release I 和其他历史任务，不覆盖、不重建整个文件；
3. 如果 Release I 尚未正式 PASS，则把 Release J 保持为等待状态；
4. 一旦 Release I 已有可靠证据：

```text
RELEASE_I = PASS
READY_FOR_RELEASE_J = YES
```

立即自主开始 Release J；
5. 对可恢复工具/环境错误自行诊断、恢复并继续；
6. 完成 Release J 的验证、首次受控 production cleanup apply、复核与持久化证据；
7. 最终只有在真实证据支持时关闭：

```text
RELEASE_J = PASS
```

---

# 0. TASKS.md 是本轮执行状态账本

第一步先读取：

```text
TASKS.md
PROJECT_STATE.md
results.md
TEST_RESULTS.md
相关 cleanup / artifact lifecycle 文档
repository 当前状态
```

不要假设它们的内容。

---

## 0.1 不得覆盖现有 TASKS.md

禁止：

```text
replace entire TASKS.md
rewrite all historical tasks
erase completed evidence
erase Release I status
```

应：

```text
read
→ locate current release section
→ append/update Release J section
→ preserve previous content
```

如果 `Release J` 已存在：

不要重复追加第二份。

合并到现有 Release J section。

---

## 0.2 Release J 在 TASKS.md 中至少维护

```text
RELEASE_J_STATUS
PREREQUISITES
CURRENT_CHECKPOINT
TASKS
COMPLETED
BLOCKERS
RECOVERY_NOTES
PRODUCTION_EVIDENCE
FINAL_RESULT
```

任务执行过程中持续更新。

不要等到最后再凭记忆补写。

---

## 0.3 推荐任务状态

使用：

```text
[ ] pending
[x] completed
[-] blocked
```

并记录必要 evidence。

不要：

```text
[x]
```

代表“计划要做”。

只有真实完成才勾选。

---

# 1. Release J 前置条件

Release J 的唯一合法入口：

```text
RELEASE_I = PASS
READY_FOR_RELEASE_J = YES
```

必须从当前 repository / TASKS.md / results / release evidence 确认，而不是只相信本 Prompt。

---

## 1.1 如果 Release I 仍不是 PASS

例如：

```text
RELEASE_I = BLOCKED
RELEASE_I = PARTIAL_PASS
RELEASE_I = FAIL
RELEASE_I = UNKNOWN
```

则：

```text
RELEASE_J = WAITING_FOR_RELEASE_I
READY_FOR_RELEASE_J = NO
```

在 `TASKS.md` 保留 Release J。

不要执行任何 production cleanup。

不要提前做 Release J runtime 修改。

然后继续完成 Release I，如果当前 agent 同时拥有 Release I 的执行任务和上下文。

---

## 1.2 Release I PASS 后自动接续

一旦实际证据建立：

```text
RELEASE_I = PASS
READY_FOR_RELEASE_J = YES
```

无需再次询问用户：

```text
Should I start Release J?
```

直接：

```text
RELEASE_J = IN_PROGRESS
```

开始执行。

---

# 2. Release J 的准确范围

本阶段正式名称：

```text
Release J — Cleanup / Retention First-Apply Closure
```

这是 Release C 留下 cleanup debt 的正式 closure。

历史已有：

```text
CLEANUP_CLASSIFIER = PASS
CLEANUP_DRY_RUN = PASS
CLEANUP_RECHECK = PASS

CLEANUP_MANUAL_APPLY = NOT_EXECUTED
AUTOMATIC_CLEANUP = DISABLED
ASSET_OBJECT_GC = NOT_IMPLEMENTED
```

Release J 的核心目标是：

> 对已经存在的安全 cleanup engine 进行第一次真实、受控、可审计、可复核的 production manual apply，并验证 retention/grace/recheck/idempotency 合同在真实环境成立。

---

# 3. 本 Prompt 的 operator authorization

执行本 Release J Prompt 本身构成：

```text
OPERATOR_APPROVAL =
ONE_BOUNDED_PRODUCTION_MANUAL_CLEANUP_APPLY
```

但这个授权范围非常窄。

只允许删除：

```text
ORPHAN_FINAL
```

中经过本轮重新建立 identity、两遍稳定分类、retention/grace 检查、最终逐对象 recheck 后仍明确安全的 candidate。

这不是：

```text
approve all cleanup
approve automatic cleanup
approve AssetObject GC
approve attachment deletion
approve backup deletion
approve export retention policy change
```

---

# 4. 永久禁止扩大这个授权

本轮不授权：

```text
AUTOMATIC_CLEANUP = ENABLED

ASSET_OBJECT_GC

Attachment physical-byte GC

user attachment deletion

conversation content deletion

MessageVersion deletion

historical attachment deletion

Share-required object deletion

.cr required object deletion

offline canonical package deletion

successful retained user Export deletion

PostgreSQL deletion

business volume deletion

backup retention cleanup

Docker volume cleanup

arbitrary filesystem cleanup

old files merely because they are old
```

---

# 5. 历史 cleanup evidence

历史 Release B baseline：

```text
ORPHAN_FINAL = 4 / 659,673 bytes
SAFE_TEMP = 0
SUPERSEDED_ARTIFACT = 0
UNSAFE_PROTECTED = 29 / 236,546,674 bytes
```

Release C production 两次 stable dry-run 后：

```text
ORPHAN_FINAL = 3 / 655,810 bytes
SAFE_TEMP = 0
SUPERSEDED_ARTIFACT = 0
UNSAFE_PROTECTED = 30 / 236,550,537 bytes
```

重要：

```text
4 → 3
```

的 candidate-set 变化历史上没有保存足够 opaque identity 来证明对象映射。

因此：

```text
CURRENT HISTORICAL COUNT
IS NOT DELETE AUTHORITY
```

---

# 6. 不得假定今天仍然是 3 个 candidate

当前 Release J 必须从 production 当前事实重新扫描。

历史：

```text
3 / 655,810 bytes
```

只能作为 comparison baseline。

不得写：

```text
there should be 3
therefore delete these 3
```

---

# 7. Release J 核心原则

```text
IDENTITY
>
COUNT
```

以及：

```text
REAL REFERENCES
>
REF_COUNT CACHE
```

以及：

```text
UNKNOWN
=
PROTECTED
```

以及：

```text
STALE CLASSIFICATION
!=
DELETE AUTHORITY
```

---

# 8. Frozen Cleanup Categories

继续使用已有：

```text
SAFE_TEMP
ORPHAN_FINAL
SUPERSEDED_ARTIFACT
UNSAFE_PROTECTED
```

不要在本轮随意创造新 destructive category。

---

# 9. 本轮唯一 production first-apply category

即使当前 dry-run 新出现：

```text
SAFE_TEMP
SUPERSEDED_ARTIFACT
```

也不要自动把它们纳入首次 apply。

本 Release J 首次 production apply 默认严格限制：

```text
APPLY_CATEGORY = ORPHAN_FINAL
```

其他 category：

```text
DRY_RUN / REPORT ONLY
```

除非 repository 已有更窄且此前正式批准的合同。

不得扩大删除范围。

---

# 10. ORPHAN_FINAL 当前定义必须保持

一个对象只有同时满足以下条件才可能成为：

```text
ORPHAN_FINAL
```

至少要求：

```text
server-controlled path

inside known managed final-artifact namespace

zero canonical DB reference

zero active job reference

zero pending transaction-visible reference
where applicable

age > applicable grace window

path validation PASS
```

---

# 11. 必须保护 canonical state

以下至少属于：

```text
UNSAFE_PROTECTED
```

不得删除：

```text
current Offline artifact

committed available Export

successful retained user Export

active/pending Import source

business Attachment

AssetObject

current MessageVersion dependency

historical MessageVersion dependency

Share-required object

history-required object

current artifact

active BackgroundJob object

pending publication object

rollback-required artifact

unknown category

unresolved reference state
```

---

# 12. AssetObject 明确排除

再次冻结：

```text
AssetObject
=
immutable physical bytes / dedupe object
```

Release J：

```text
ASSET_OBJECT_GC = NOT_IN_SCOPE
```

不得因为 cleanup classifier 能看到某个文件就把它纳入 artifact cleanup。

最终要求仍是：

```text
ASSET_OBJECT_GC = NOT_IMPLEMENTED
```

除非历史当前代码已经存在但明确 disabled；无论如何不得本轮启用。

---

# 13. Attachment lifecycle 不变

继续：

```text
Attachment
=
conversation-owned business file
```

```text
AttachmentOccurrence
=
reference inside MessageVersion
```

尤其：

```text
zero current occurrence
!=
safe physical deletion
```

active-unreferenced Attachment 必须保持。

---

# 14. 第一阶段 — Current Runtime Authority

Release I PASS 后先确认 production authority：

```text
SOURCE_COMMIT_SHA
CI_SHA
immutable artifact
deployed image digest
running image digest
```

必须已经来自 Release I PASS evidence。

要求：

```text
RUNNING_RELEASE_I_IMAGE_IDENTITY = PASS
```

如果 production runtime identity 无法确定：

不要执行 cleanup apply。

恢复/调查 runtime authority。

---

# 15. 当前 source / cleanup implementation inspection

确认现有 cleanup engine 仍具备：

```text
explicit grace

two-pass stability

opaque candidate identity/token

final per-object recheck

dry-run default

explicit apply mode

path boundary validation

canonical reference check

active job check

idempotent absent-file handling

partial failure reporting
```

优先检查现有 implementation 和 tests。

---

# 16. 不要重新实现已经存在的 cleanup engine

如果上述保护已存在：

```text
DO NOT REWRITE CLEANUP ENGINE
```

Release J 优先是：

```text
verification
+
operational first apply
+
evidence closure
```

不是 cleanup rewrite。

---

# 17. 什么时候允许修改代码

只有真实 evidence 证明：

```text
existing engine cannot safely perform the approved bounded apply
```

才允许最小修复。

例如：

```text
candidate identity not stable

final recheck missing

path escape possible

canonical reference check wrong

active job not protected

dry-run and apply classify differently

apply can widen category unexpectedly

partial failure falsely reports success
```

---

# 18. 如果无需代码修改

如果现有 engine 已满足合同：

```text
PRODUCT_SOURCE_CHANGED = NO
```

不要为了 Release J 创建无意义 runtime change。

直接进入 production operational closure。

TASKS/results/docs 的 evidence 更新可以单独完成。

---

# 19. 如果代码必须修改

则必须重新进入标准 release authority：

```text
focused cleanup tests
→ full affected regression
→ lint/typecheck/build where applicable
→ commit
→ push
→ exact-SHA CI
→ immutable artifact
→ production deploy
→ running-image identity
```

只有新 runtime 验证完成后才能执行 cleanup apply。

禁止：

```text
local modified script
→ directly run against production
```

---

# 20. No Database Migration by Default

Release J 预期：

```text
NEW_ALEMBIC_MIGRATION = NONE
```

不要为了：

```text
cleanup ledger
candidate history
metrics table
GC status
```

临时新增 schema。

---

# 21. Retention / Grace Contract

本轮需要验证，而不是重新发明 retention。

优先读取当前真实：

```text
preview TTL
failed-job TTL
artifact retention
cleanup grace
existing configuration
```

---

# 22. 不得凭空发明用户 retention

禁止为了完成任务创建：

```text
exports expire after 7 days
attachments expire after 30 days
offline packages expire after N days
```

这种新的用户可感知政策。

如果当前 category 已有 technical cleanup grace：

沿用并验证。

---

# 23. 如果当前 grace 不明确

先从：

```text
code
configuration
tests
docs
Release C implementation
```

恢复真实合同。

只有在仍无法确定、且设置新值会改变用户可观察 retention 时：

才属于 genuine blocker。

不要猜。

---

# 24. 第二阶段 — Pre-Apply Production Safety Snapshot

在执行任何删除前建立当前 production safety snapshot。

至少确认：

```text
API healthy
Web healthy
PostgreSQL healthy
worker running
Scanner disabled as designed
Alembic current == head
running image identity PASS
```

---

# 25. Pre-Apply storage baseline

记录 aggregate：

```text
SAFE_TEMP count / bytes

ORPHAN_FINAL count / bytes

SUPERSEDED_ARTIFACT count / bytes

UNSAFE_PROTECTED count / bytes

managed artifact storage total where available
```

不要输出：

```text
user content
message source
attachment contents
secret
raw auth token
```

---

# 26. 第三阶段 — Verified Backup

第一次 production cleanup apply 前必须建立符合现有 deployment contract 的验证备份。

至少覆盖当前项目正式 backup contract 中的：

```text
PostgreSQL
imports
exports
offline
assets
```

以及 repository 当前要求的其他 canonical data。

---

# 27. Backup 不能只创建

必须验证：

```text
backup exists
expected components present
archive/readability sanity
PostgreSQL backup validation
checksum / integrity where current contract provides it
```

记录：

```text
PRE_CLEANUP_BACKUP =
<actual verified identifier/path>
```

---

# 28. 不清理旧 backup

Release J 本身：

```text
BACKUP_RETENTION_CLEANUP = NOT_IN_SCOPE
```

不得为了腾空间顺手删历史 backup。

---

# 29. 第四阶段 — Production Dry-Run A

使用当前 production runtime 的正式 cleanup classifier。

执行：

```text
DRY_RUN_A
```

记录：

```text
SAFE_TEMP_COUNT
SAFE_TEMP_BYTES

ORPHAN_FINAL_COUNT
ORPHAN_FINAL_BYTES

SUPERSEDED_ARTIFACT_COUNT
SUPERSEDED_ARTIFACT_BYTES

UNSAFE_PROTECTED_COUNT
UNSAFE_PROTECTED_BYTES
```

---

# 30. 必须保存 candidate identity

对：

```text
ORPHAN_FINAL
```

必须保存现有 cleanup engine 提供的：

```text
opaque candidate identity
candidate token
stable internal fingerprint
```

中的真实机制。

不要只保存数量。

---

# 31. Candidate identity 不应泄露敏感信息

`TASKS.md`、results、最终报告默认只记录：

```text
opaque ID
hash/fingerprint
bounded token
```

不要记录：

```text
real user filename
conversation title
message body
secret-bearing path
```

---

# 32. 如果 engine 没有安全 opaque identity

检查是否已经存在 Release C 的 opaque two-pass token。

历史证据表明它应该已实现。

如果当前 runtime 中实际不存在：

这是 release implementation inconsistency。

不要用 filename/path 临时冒充安全 candidate authority。

诊断当前 source/runtime identity。

---

# 33. Candidate set classification

对 Dry-Run A 的每个 ORPHAN_FINAL candidate 建立机器验证：

```text
PATH_INSIDE_MANAGED_ROOT = PASS

FINAL_NAMESPACE = PASS

CANONICAL_DB_REFERENCE_COUNT = 0

ACTIVE_JOB_REFERENCE_COUNT = 0

PENDING_REFERENCE = ABSENT

GRACE_WINDOW = SATISFIED

BUSINESS_ASSET = NO

SUCCESSFUL_RETAINED_EXPORT = NO

CURRENT_ARTIFACT = NO

ROLLBACK_REQUIRED = NO

UNKNOWN_STATE = NO
```

---

# 34. 不读取用户内容

判断 reference 时：

优先：

```text
metadata
DB relation
job relation
artifact state
path metadata
```

不得因为 cleanup audit 去读取：

```text
conversation body
message content
attachment body
```

---

# 35. 第五阶段 — Production Dry-Run B

根据现有 two-pass contract 完成第二次稳定性检查。

不要通过：

```text
immediate duplicate command
```

伪造 two-pass。

必须满足现有：

```text
safe scan interval
candidate age
stable mtime
candidate-token
grace condition
```

中的真实要求。

---

# 36. 不要凭空增加等待时间

如果当前 two-pass implementation 已通过：

```text
opaque candidate token
+
stable candidate evidence
+
existing grace
```

满足安全合同：

按实现执行。

不要人为添加：

```text
wait 24 hours
wait 7 days
```

除非当前 contract 真正要求。

---

# 37. Dry-Run A / B exact identity comparison

必须比较：

```text
candidate identity set
```

而不仅是：

```text
count
bytes
```

目标：

```text
ORPHAN_FINAL_STABLE_SET = VERIFIED
```

---

# 38. 如果 candidate set 改变

如果：

```text
A != B
```

不要删除差异对象。

先重新 classification。

允许：

```text
new safe candidate
old candidate became referenced
candidate disappeared
```

这些本身不一定是 bug。

但首次 apply 只能针对重新稳定建立 authority 的 candidate set。

---

# 39. 历史 3 / 655,810 不影响当前 authority

如果当前结果是：

```text
0
1
2
3
4
...
```

都必须接受真实结果。

不要为了匹配历史：

```text
3 / 655,810
```

操纵 classifier。

---

# 40. 当前 candidate 为 0 的情况

如果：

```text
ORPHAN_FINAL = 0
```

则：

```text
FIRST_APPLY_ELIGIBLE_OBJECTS = 0
```

不要为了“必须首次删除”制造 candidate。

这种情况下可以把：

```text
CLEANUP_MANUAL_APPLY =
NO_ELIGIBLE_OBJECTS
```

作为真实 closure evidence，

前提是：

* classifier 正常；
* two-pass 正常；
* retention contract 已验证；
* production engine 可执行；
* 没有 candidate 是因为真实状态，而不是工具失效。

---

# 41. 第六阶段 — Pre-Apply Final Gate

正式 `--apply` 前必须同时成立：

```text
RELEASE_I = PASS

RUNNING_IMAGE_IDENTITY = PASS

PRODUCTION_HEALTH = PASS

BACKUP_VERIFIED = PASS

CLEANUP_CLASSIFIER = PASS

CLEANUP_DRY_RUN_A = PASS

CLEANUP_DRY_RUN_B = PASS

ORPHAN_FINAL_STABLE_SET = VERIFIED

RETENTION_GRACE = PASS

PATH_BOUNDARY = PASS

CANONICAL_REFERENCE_CHECK = PASS

ACTIVE_JOB_CHECK = PASS

FINAL_RECHECK_IMPLEMENTATION = PASS

APPLY_CATEGORY = ORPHAN_FINAL
```

---

# 42. First Apply scope snapshot

正式 apply 使用：

```text
PREAPPROVED_STABLE_CANDIDATE_SET
```

不得：

```text
scan current filesystem
→ delete every newly discovered candidate
```

如果 cleanup CLI 本身使用 candidate token：

必须使用对应稳定 token。

---

# 43. Apply 不得自动扩大范围

明确：

```text
ORPHAN_FINAL only
```

不允许：

```text
--all
all categories
safe-looking objects
unknown objects
```

---

# 44. 第七阶段 — Production Manual First Apply

执行 repository/current-runtime 提供的正式：

```text
manual apply
```

模式。

要求显式：

```text
apply mode
+
ORPHAN_FINAL category
+
approved candidate authority
```

---

# 45. 每个 candidate 删除前必须 final recheck

对每个 candidate：

```text
candidate approved
→ immediate final recheck
```

再次确认：

```text
canonical DB references = 0

active job references = 0

pending references = 0

grace still satisfied

path still valid

still classified ORPHAN_FINAL
```

然后才允许删除。

---

# 46. TOCTOU rule

如果 candidate 在：

```text
classification
→ apply
```

之间发生变化：

```text
DO NOT DELETE
```

返回：

```text
SKIPPED_RECHECK_CHANGED
```

或当前 implementation 的等价安全状态。

这不是 Release J failure。

这是 safety system 正确工作。

---

# 47. File disappeared before apply

如果目标已经不存在：

要求：

```text
idempotent handling
```

例如：

```text
already_absent
skipped
```

不得因为文件已经消失：

```text
500
delete unrelated object
mark entire apply successful falsely
```

---

# 48. Partial failure

例如：

```text
candidate A = deleted
candidate B = permission failure
candidate C = recheck skip
```

必须真实报告：

```text
DELETED_COUNT
DELETED_BYTES

SKIPPED_COUNT
SKIP_REASONS

FAILED_COUNT
FAILURE_CLASS
```

---

# 49. 不回滚已经安全删除的 orphan

一个真正 orphan final file 已经被安全删除后：

如果后一个 object 删除失败，

不要为了“事务感”恢复前面的 orphan file。

Filesystem cleanup 使用：

```text
per-object safety
+
best-effort
+
accurate final report
```

---

# 50. 但不得伪造整体成功

如果存在：

```text
FAILED_COUNT > 0
```

则：

```text
CLEANUP_FIRST_APPLY =
PARTIAL_PASS / FAIL
```

根据实际根因决定。

不能写：

```text
all done
```

---

# 51. 第八阶段 — Immediate Post-Apply Verification

apply 完成后立即重新运行：

```text
production dry-run
```

验证：

成功删除的 candidate：

```text
no longer appears
```

recheck-skipped candidate：

```text
remains protected or correctly reclassified
```

---

# 52. Post-Apply aggregate

记录：

```text
ORPHAN_FINAL_AFTER
SAFE_TEMP_AFTER
SUPERSEDED_ARTIFACT_AFTER
UNSAFE_PROTECTED_AFTER
```

以及：

```text
DELETED_COUNT
DELETED_BYTES
```

---

# 53. 不要求 ORPHAN_FINAL 必须等于 0

如果 apply 过程中：

```text
new candidate appears
candidate became unsafe
candidate was skipped by recheck
```

最终：

```text
ORPHAN_FINAL > 0
```

不自动意味着 Release J failure。

需要解释其 identity/status。

---

# 54. Release J 成功标准不是“磁盘清零”

错误目标：

```text
ORPHAN_FINAL = 0 at all costs
```

正确目标：

```text
ONLY VERIFIED SAFE OBJECTS CAN BE DELETED
```

---

# 55. 第九阶段 — Canonical State Integrity Audit

cleanup 后必须验证：

```text
canonical database state unchanged
```

除了 filesystem orphan removal 本身。

---

# 56. 至少重新验证

```text
API health

PostgreSQL health

worker health

Alembic current/head

current Offline artifacts

committed Export access

Import source references

Attachment/AssetObject availability

Share-required files where safe to test

current artifact publication state
```

---

# 57. Attachment / AssetObject zero-deletion proof

必须能够确认：

```text
BUSINESS_ATTACHMENT_DELETED = 0

ASSET_OBJECT_DELETED = 0
```

---

# 58. Canonical artifact zero-deletion proof

要求：

```text
CANONICAL_REFERENCED_ARTIFACT_DELETED = 0
```

---

# 59. Production publication smoke

执行一个安全、可清理的 production QA artifact lifecycle smoke。

优先使用当前产品既有 QA pattern。

例如根据产品真实能力：

```text
create disposable QA source
→ trigger artifact publication
→ verify committed state
→ run cleanup dry-run
→ confirm new committed artifact is protected
```

不要制造真实用户数据。

---

# 60. Publication window regression

重点验证 Release B/C contract：

```text
new final file published
+
DB commit transition
+
cleanup
```

之间不存在危险窗口。

已有 automated race test 应重跑/复用。

确保：

```text
new staging protected

new final before commit protected

new committed final protected
```

---

# 61. Active-job protection

安全测试：

```text
candidate-looking artifact
+
active job reference
```

必须：

```text
UNSAFE_PROTECTED
```

或等价保护状态。

---

# 62. Re-reference race

测试：

```text
candidate classified
→ becomes referenced
→ apply
```

结果：

```text
SKIPPED
```

不得删除。

---

# 63. Idempotency

首次 apply 后：

再次使用相同/旧 candidate authority 安全验证。

不得重复误删。

结果应类似：

```text
already_absent
token stale
not_candidate
skipped
```

具体按现有 contract。

---

# 64. 不要执行第二轮扩大删除

Release J 授权：

```text
ONE BOUNDED FIRST APPLY
```

apply 后出现的新 candidate：

只做：

```text
dry-run
report
```

不要自动继续第二波 production deletion。

---

# 65. Automatic cleanup remains disabled

Release J 完成后必须：

```text
AUTOMATIC_CLEANUP = DISABLED
```

不得：

```text
cron enable
worker scheduler enable
feature flag true
```

---

# 66. 不要实现 automatic cleanup 作为“顺手下一步”

它是独立未来阶段。

Release J 不做：

```text
scheduled delete
background GC
continuous cleanup
```

---

# 67. Diagnostics production state不属于 Release J blocker

历史：

```text
INTERNAL_DIAGNOSTICS_IMPLEMENTATION = PASS
INTERNAL_DIAGNOSTICS_PRODUCTION = NOT_ENABLED
```

除非 cleanup engine 本身依赖 diagnostics HTTP endpoint：

否则不要为了 Release J 开启它。

继续保持：

```text
INTERNAL_DIAGNOSTICS_PRODUCTION = NOT_ENABLED
```

直到 gateway protection 独立闭环。

---

# 68. Worker idle heartbeat debt不属于 Release J

历史 debt：

```text
JOB_METRICS = PARTIAL_PASS
```

因为 idle worker heartbeat 无法独立推导。

不要为了 cleanup first apply 顺带修改 worker heartbeat。

---

# 69. Strict CSP / telemetry / Turbopack 全部继续 deferred

Release J 不碰：

```text
strict nonce/hash CSP

optional CSP reporting

worker idle heartbeat

Markdown/KaTeX precise telemetry

Turbopack migration
```

---

# 70. 可恢复错误：自主修复继续执行

本轮沿用 Release I 的 self-recovery 原则。

以下不属于最终 blocker：

```text
expired shell

missing exec cell

process already exited

temporary SSH disconnect

Docker CLI transient failure

temporary network timeout

CI polling session lost

production read-only command timeout
```

---

# 71. 恢复策略

```text
inspect actual state
→ determine whether action completed
→ recreate session if needed
→ rerun only safe/idempotent action
→ verify
→ continue
```

---

# 72. 不得因 process identity 消失而失去 release state

```text
PROCESS IDENTITY
!=
RELEASE AUTHORITY
```

authority 来自：

```text
Git
CI
artifact metadata
Docker runtime
database
filesystem state
cleanup report
```

---

# 73. Apply command 的特殊恢复规则

因为 apply 可能部分删除：

如果执行 session 在 apply 中丢失：

**绝对禁止盲目重新执行 apply。**

先：

```text
inspect filesystem state
inspect cleanup output/log if available
rerun DRY-RUN ONLY
compare approved candidate set
```

确定哪些对象：

```text
deleted
still present
became referenced
unknown
```

之后才能决定安全恢复。

---

# 74. Apply session lost 时

如果无法确定某 candidate 是否删除：

通过：

```text
read-only filesystem check
+
classifier
+
DB reference check
```

恢复真实状态。

不要猜。

---

# 75. 同一根因自动恢复次数

普通可恢复错误：

```text
MAX_RECOVERY_ATTEMPTS = 3
```

然后切换诊断路径。

---

# 76. 真正 Hard Stop A — Production target uncertainty

无法确认当前连接的是正确 production：

```text
host
namespace
service
volume
database
```

停止 destructive apply。

---

# 77. Hard Stop B — Backup unavailable

计划删除前无法建立符合现有 contract 的 validated backup：

```text
RELEASE_J = BLOCKED
```

不要执行 apply。

---

# 78. Hard Stop C — Candidate identity uncertainty

如果只能知道：

```text
3 objects
```

却无法证明具体候选身份：

不得 apply。

---

# 79. Hard Stop D — Reference uncertainty

如果某 candidate 无法可靠判断：

```text
canonical reference
active job reference
business-file classification
```

则：

```text
candidate = PROTECTED
```

如果所有 candidate 因此都不可判定：

Release J 可以 BLOCKED。

---

# 80. Hard Stop E — Path boundary uncertainty

如果 candidate path：

```text
outside managed root
symlink escape
path normalization uncertain
```

不得删除。

---

# 81. Hard Stop F — Unexpected business object

如果 ORPHAN_FINAL candidate 实际映射到：

```text
Attachment
AssetObject
canonical Export
current Offline package
Share-required object
```

停止该 candidate 删除。

如果 classifier 系统性误分类：

停止整个 apply，进入 defect remediation。

---

# 82. Hard Stop G — Destructive command broader than approved set

如果现有 CLI 只能：

```text
delete everything classified safe
```

而不能限制：

```text
ORPHAN_FINAL
+
approved stable candidate authority
```

不得直接执行。

先做最小安全实现修复并走 release chain。

---

# 83. Hard Stop H — Production mutation outside cleanup scope

发现下一操作会修改：

```text
DB canonical rows
Attachment state
MessageVersion
Share
Import/Export contract
```

且并非既有 cleanup contract：

停止。

---

# 84. Source change release discipline

如果 Release J 不需要 source change：

不要重跑整套 build/deploy 只为了 dry-run/apply。

继续使用已通过 Release I 的 immutable production runtime。

---

# 85. 如果 source changed

必须：

```text
focused cleanup tests = PASS

cleanup race tests = PASS

artifact lifecycle regression = PASS

full API affected suite = PASS

Web gates if affected = PASS

Alembic current/head = PASS

commit
push
exact-SHA CI
immutable artifact
production deploy
running identity
```

然后才重新开始 production apply safety sequence。

---

# 86. Required cleanup automated matrix

必须确认现有测试或补齐最小测试覆盖：

```text
GC-001 safe abandoned temp

GC-002 recent temp protected

GC-003 active-job temp protected

GC-004 true orphan final

GC-005 canonical offline final protected

GC-006 committed export protected

GC-007 successful retained user export protected

GC-008 current artifact protected

GC-009 unknown artifact protected

GC-010 dry-run deletes nothing

GC-011 apply only approved category

GC-012 final recheck prevents race deletion

GC-013 repeat apply idempotent

GC-014 partial permission failure

GC-015 AssetObject never eligible

GC-016 managed-root/path escape rejection
```

以及：

```text
GC-RACE-001
classified → becomes DB referenced → skip

GC-RACE-002
classified → active job starts → skip

GC-RACE-003
file disappears before apply → idempotent

GC-RACE-004
permission failure → canonical state unchanged

GC-RACE-005
unknown category → protected
```

---

# 87. Test skips

所有测试报告：

```text
passed
failed
skipped
```

Skip 不计入 PASS。

任何和：

```text
cleanup apply
path safety
candidate stability
final recheck
```

直接相关的 scoped skip，都必须单独解释。

不能悄悄算 PASS。

---

# 88. Production apply 不能依赖测试 fixture identity

production candidate 必须来自：

```text
production current classifier
```

不是：

```text
local fixture
historical results.md candidate
hard-coded path
```

---

# 89. 第十阶段 — Post-Cleanup Business Smoke

cleanup 后至少验证：

```text
Library loads
Reader opens
Source Editor opens
Files Panel works
known attachment downloads/previews
Export/Offline core route works
Import core route works
Share core route remains valid
```

按当前真实产品与既有 smoke suite执行。

---

# 90. 不要为了 smoke 修改用户数据

使用：

```text
disposable QA data
```

并遵循已有产品 cleanup method。

不得：

```text
direct SQL DELETE
manual business file deletion
```

---

# 91. QA cleanup

QA 数据通过产品 API / 已批准工具清理。

QA cleanup 与 artifact first apply 是两件事。

不要混淆。

---

# 92. Production storage delta

最终记录：

```text
BEFORE_MANAGED_BYTES
AFTER_MANAGED_BYTES
ACTUAL_DELETED_BYTES
```

如果 available。

要求关系合理。

但不要为了精确 byte delta扫描不相关 filesystem。

---

# 93. 不把磁盘释放量当成功标准

即使：

```text
DELETED_BYTES = 0
```

只要是因为没有符合条件 candidate：

Release J 仍可能 PASS。

---

# 94. Retention verification matrix

最终至少明确：

```text
RETENTION_SOURCE = EXISTING_CONTRACT

RETENTION_USER_VISIBLE_POLICY_CHANGED = NO

GRACE_WINDOW_VERIFIED = PASS

RECENT_ARTIFACT_PROTECTED = PASS

ACTIVE_JOB_ARTIFACT_PROTECTED = PASS

COMMITTED_ARTIFACT_PROTECTED = PASS

SUCCESSFUL_USER_EXPORT_PROTECTED = PASS

UNKNOWN_ARTIFACT_PROTECTED = PASS
```

---

# 95. First-Apply matrix

```text
PRODUCTION_DRY_RUN_A = PASS

PRODUCTION_DRY_RUN_B = PASS

CANDIDATE_IDENTITY_CAPTURED = PASS

CANDIDATE_SET_STABLE = PASS

BACKUP_VERIFIED = PASS

PRE_APPLY_FINAL_GATE = PASS

ORPHAN_FINAL_MANUAL_APPLY =
PASS | NO_ELIGIBLE_OBJECTS | PARTIAL_PASS | FAIL

PER_OBJECT_FINAL_RECHECK = PASS

IDEMPOTENT_RECHECK = PASS

POST_APPLY_DRY_RUN = PASS
```

---

# 96. Canonical integrity matrix

```text
BUSINESS_ATTACHMENT_DELETED = 0

ASSET_OBJECT_DELETED = 0

CANONICAL_REFERENCED_ARTIFACT_DELETED = 0

ACTIVE_JOB_ARTIFACT_DELETED = 0

SUCCESSFUL_RETAINED_EXPORT_DELETED = 0

CURRENT_OFFLINE_ARTIFACT_DELETED = 0

SHARE_REQUIRED_OBJECT_DELETED = 0
```

---

# 97. Release J 不等于 automatic GC launch

即使 Release J PASS：

```text
AUTOMATIC_CLEANUP = DISABLED
```

以及：

```text
ASSET_OBJECT_GC = NOT_IMPLEMENTED
```

仍是正确结果。

不要因此标记成 Release J debt。

它们是后续独立决策。

---

# 98. Documentation

Release J 完成后更新真实存在的相关文件，例如：

```text
TASKS.md
PROJECT_STATE.md
results.md
TEST_RESULTS.md
docs/testing.md
docs/deployment.md
cleanup/artifact lifecycle docs
documentation inventory
```

以 repository 真实文件为准。

不要创建大量重复文档。

---

# 99. TASKS.md 实时更新原则

每个 major checkpoint 后更新：

```text
current status
completed checkbox
actual evidence
remaining step
blocker if any
```

例如：

```text
[x] Release I prerequisite verified
[x] Production runtime identity verified
[x] Pre-cleanup backup verified
[x] Dry-run A complete
[x] Dry-run B complete
[x] Stable candidate set verified
[x] First bounded apply complete
[x] Post-apply integrity audit complete
```

只有真实完成才勾选。

---

# 100. TASKS.md 不保存 secret

不得写入：

```text
password
token
DATABASE_URL
SSH secret
Share token
private key
```

---

# 101. Final evidence commit

如果仅修改：

```text
TASKS.md
results.md
PROJECT_STATE.md
evidence docs
```

且 runtime source 未改变：

可以创建 docs/evidence-only commit。

必须明确：

```text
RUNTIME_SOURCE_CHANGED = NO
PRODUCTION_REDEPLOY_REQUIRED = NO
```

不要因为 docs commit 重新部署完全相同 runtime。

---

# 102. 如果 runtime source changed

则 final commit 是 runtime release commit，并必须完成标准 CI/deployment authority。

不要把 docs-only和 runtime authority 混淆。

---

# 103. 最终 Release J PASS 定义

只有以下成立才允许：

```text
RELEASE_J = PASS
```

要求：

```text
1. Release I = PASS.

2. Production runtime identity verified.

3. Existing cleanup engine safety contract verified.

4. Retention/grace contract restored from actual project authority.

5. No new user-visible retention policy invented.

6. Verified pre-cleanup backup exists.

7. Production classifier dry-run performed.

8. Candidate identities captured, not count-only.

9. Two-pass candidate stability verified.

10. Every approved candidate satisfies ORPHAN_FINAL contract.

11. Apply scope limited to approved ORPHAN_FINAL set.

12. Every candidate receives immediate final recheck.

13. Any changed/referenced candidate is skipped.

14. First production apply completes safely,
    or there are zero eligible objects.

15. Apply is idempotent.

16. Post-apply dry-run reconciles results.

17. Canonical business state remains intact.

18. Business Attachment deletions = 0.

19. AssetObject deletions = 0.

20. Canonical referenced artifact deletions = 0.

21. Production health remains PASS.

22. Publication/cleanup race regression PASS.

23. Automatic cleanup remains disabled.

24. AssetObject GC remains out of scope.

25. TASKS.md/results/current-state evidence updated.
```

---

# 104. PASS with zero deletion

允许：

```text
ORPHAN_FINAL_CURRENT = 0

CLEANUP_MANUAL_FIRST_APPLY =
NO_ELIGIBLE_OBJECTS

RELEASE_J = PASS
```

如果全部 safety/retention/operational closure 已验证。

不要人为制造 deletion 来取得“first apply”。

---

# 105. Partial pass

如果部分 candidate：

```text
deleted safely
```

但存在：

```text
permission failure
unresolved identity
reference ambiguity
```

则：

```text
RELEASE_J = PARTIAL_PASS | BLOCKED
```

根据是否仍能安全继续决定。

---

# 106. Hard Fail

以下任一实际发生：

```text
canonical artifact deleted

Attachment/AssetObject deleted

active-job artifact deleted

successful retained export deleted

path escapes managed root

stale candidate deleted after becoming referenced

cleanup changes canonical DB business state unexpectedly

apply widens beyond approved category

backup unavailable before destructive apply

production target identity uncertain
```

则：

```text
RELEASE_J = FAIL
READY_FOR_NEXT_RELEASE = NO
```

立即停止进一步删除。

---

# 107. 自动修复真实 cleanup defect

如果 pre-production/test 阶段发现一个明确、局部、安全可修的 cleanup defect：

允许自主修复。

流程：

```text
capture evidence
→ minimal scoped fix
→ focused tests
→ full affected regression
→ commit/push
→ exact-SHA CI
→ immutable artifact
→ production deploy
→ runtime identity
→ restart Release J safety sequence
```

---

# 108. Production apply 发现 classifier defect

如果在真正删除前发现：

```text
candidate falsely classified ORPHAN_FINAL
```

不得“跳过这个继续删其他全部”。

先判断是否：

```text
single candidate data anomaly
```

还是：

```text
systemic classifier defect
```

systemic：

停止 apply并修复 classifier。

---

# 109. 已发生安全删除后发现后续 defect

不得删除更多 candidate。

保护已经完成的真实 evidence。

修复后重新从：

```text
dry-run
candidate identity
two-pass
backup validity
```

评估是否可继续。

不要假设旧 candidate token 仍有效。

---

# 110. 最终报告格式

最后输出：

## Release J Result

```text
RELEASE_I =
READY_FOR_RELEASE_J =

RELEASE_J =
READY_FOR_NEXT_RELEASE =
```

---

## Runtime Authority

```text
RUNTIME_SOURCE_SHA =
CI_SHA =
DEPLOYED_ARTIFACT =
RUNNING_ARTIFACT =
RUNNING_IMAGE_IDENTITY =
```

---

## Cleanup Engine

```text
CLEANUP_CLASSIFIER =
CLEANUP_DRY_RUN =
CLEANUP_RECHECK =
CLEANUP_APPLY_IMPLEMENTATION =
PRODUCT_SOURCE_CHANGED =
```

---

## Retention

```text
RETENTION_SOURCE =
GRACE_WINDOW =
GRACE_WINDOW_VERIFIED =
USER_VISIBLE_RETENTION_CHANGED =
```

---

## Backup

```text
PRE_CLEANUP_BACKUP =
BACKUP_VERIFIED =
```

---

## Dry-Run A

```text
SAFE_TEMP =
ORPHAN_FINAL =
SUPERSEDED_ARTIFACT =
UNSAFE_PROTECTED =

ORPHAN_FINAL_IDENTITIES_CAPTURED =
```

---

## Dry-Run B

```text
SAFE_TEMP =
ORPHAN_FINAL =
SUPERSEDED_ARTIFACT =
UNSAFE_PROTECTED =

CANDIDATE_SET_STABLE =
```

---

## First Apply

```text
APPROVED_CATEGORY = ORPHAN_FINAL
APPROVED_CANDIDATE_COUNT =
APPROVED_CANDIDATE_BYTES =

DELETED_COUNT =
DELETED_BYTES =

RECHECK_SKIPPED_COUNT =
ALREADY_ABSENT_COUNT =
FAILED_COUNT =

CLEANUP_MANUAL_FIRST_APPLY =
```

---

## Post-Apply

```text
ORPHAN_FINAL_AFTER =
SAFE_TEMP_AFTER =
SUPERSEDED_ARTIFACT_AFTER =
UNSAFE_PROTECTED_AFTER =

POST_APPLY_DRY_RUN =
IDEMPOTENCY =
```

---

## Canonical Integrity

```text
BUSINESS_ATTACHMENT_DELETED =
ASSET_OBJECT_DELETED =
CANONICAL_REFERENCED_ARTIFACT_DELETED =
ACTIVE_JOB_ARTIFACT_DELETED =
SUCCESSFUL_RETAINED_EXPORT_DELETED =
CURRENT_OFFLINE_ARTIFACT_DELETED =
SHARE_REQUIRED_OBJECT_DELETED =
```

目标均为：

```text
0
```

---

## Production Health

```text
API =
WEB =
POSTGRESQL =
WORKER =
ALEMBIC =
PUBLIC_HEALTH =
```

---

## Regression

```text
CLEANUP_FOCUSED_TESTS =
CLEANUP_RACE_TESTS =
ARTIFACT_PUBLICATION_REGRESSION =
API_REGRESSION =
WEB_REGRESSION =
OTHER_SCOPED_SKIPS =
```

---

## Deferred by Design

必须明确：

```text
AUTOMATIC_CLEANUP = DISABLED

ASSET_OBJECT_GC = NOT_IMPLEMENTED / NOT_ENABLED

INTERNAL_DIAGNOSTICS_PRODUCTION =
UNCHANGED

WORKER_IDLE_HEARTBEAT =
DEFERRED

STRICT_NONCE_HASH_CSP =
DEFERRED

MARKDOWN_KATEX_PRECISE_TELEMETRY =
DEFERRED

TURBOPACK_MIGRATION =
NOT_EXECUTED
```

---

## Recovery

```text
RECOVERABLE_ERRORS_ENCOUNTERED =
RECOVERABLE_ERRORS_RESOLVED =
UNRESOLVED_BLOCKER =
```

---

# 111. Release J 最终目标状态

理想结果：

```text
RELEASE_I = PASS

CLEANUP_CLASSIFIER = PASS
CLEANUP_DRY_RUN = PASS
CLEANUP_RECHECK = PASS

RETENTION_GRACE_CONTRACT = PASS
TWO_PASS_STABILITY = PASS
CANDIDATE_IDENTITY = PASS

PRE_CLEANUP_BACKUP = PASS

CLEANUP_MANUAL_FIRST_APPLY = PASS
OR
NO_ELIGIBLE_OBJECTS

POST_APPLY_RECONCILIATION = PASS

CANONICAL_STATE_INTEGRITY = PASS

BUSINESS_ATTACHMENT_DELETED = 0
ASSET_OBJECT_DELETED = 0
CANONICAL_REFERENCED_ARTIFACT_DELETED = 0

AUTOMATIC_CLEANUP = DISABLED
ASSET_OBJECT_GC = NOT_IMPLEMENTED

PRODUCT_SOURCE_CHANGED =
NO
unless evidence required a scoped fix

RELEASE_J = PASS
```

---

# 112. Release J Stop Condition

当：

```text
RELEASE_J = PASS
```

立即停止本 Release。

不要自动开启：

```text
automatic cleanup

AssetObject GC

backup retention automation

strict CSP

worker heartbeat

telemetry

Turbopack

another architecture release
```

把下一阶段保持在：

```text
NOT_STARTED
```

等待新的 release definition。

---

# 113. Mission Rule

Release J 的目标不是：

```text
delete as much as possible
```

而是：

```text
PROVE THAT THE FIRST REAL PRODUCTION CLEANUP
CAN DELETE ONLY OBJECTS THAT ARE STILL SAFE
AT THE EXACT MOMENT OF DELETION,
WITHOUT TOUCHING CANONICAL BUSINESS STATE.
```

因此始终优先：

```text
identity over count

references over age

recheck over stale classification

protection over aggressive cleanup

verified backup over convenience

accurate PARTIAL/BLOCKED over fake PASS
```

---

# 114. 开始执行

现在：

```text
1. Read and preserve TASKS.md.

2. Append/update Release J as the next queued release.

3. Verify current Release I state.

4. If Release I is not yet PASS:
   keep Release J waiting and finish Release I first.

5. Once:
   RELEASE_I = PASS
   READY_FOR_RELEASE_J = YES

   automatically set:
   RELEASE_J = IN_PROGRESS

6. Execute the complete Release J flow above.

7. Continuously update TASKS.md with real checkpoints.

8. Do not stop for ordinary recoverable tooling failures.

9. Stop destructive work only for genuine safety/authority blockers.

10. Finish with evidence-backed RELEASE_J status.
```

**Preserve history.
Queue the next release.
Wait only for the real Release I gate.
Then execute Release J autonomously.
Delete only identity-proven, retention-qualified, rechecked ORPHAN_FINAL artifacts.
Never broaden this into automatic GC or business-file deletion.**

---

# Release J Execution Ledger

```text
RELEASE_J_STATUS = IN_PROGRESS
PREREQUISITES = PASS
CURRENT_CHECKPOINT = PRE_APPLY_CI_GATE
BLOCKERS = NONE
FINAL_RESULT = PENDING
```

## Tasks

- [x] Release I prerequisite verified from committed final evidence.
- [x] Release I runtime source and production image identity recorded.
- [x] Existing cleanup engine safety implementation verified; no runtime rewrite required.
- [x] Four explicit cleanup matrix fixture gaps closed and verified.
- [x] Existing retention/grace authority verified.
- [x] Production runtime identity and health reverified before cleanup.
- [x] Complete pre-cleanup backup created and verified.
- [x] Production dry-run A completed with opaque candidate identities.
- [x] Production dry-run B completed and exact stable set verified.
- [ ] Bounded `ORPHAN_FINAL` first apply completed or no eligible objects proven.
- [ ] Post-apply dry-run, idempotency and canonical integrity verified.
- [ ] Production business smoke and QA cleanup completed.
- [ ] Release J evidence documents committed and pushed.

## Completed

```text
RELEASE_I = PASS
READY_FOR_RELEASE_J = YES
RUNTIME_SOURCE_SHA = 7bcd686b59d62fb9907ba09d644637b7af2b3d86
CI_RUN = 31934088629
RUNNING_RELEASE_I_IMAGE_IDENTITY = PASS
PRODUCT_SOURCE_CHANGED = NO
CLEANUP_ENGINE_PRESENT = YES
RUNTIME_SOURCE_CHANGE_REQUIRED = NO
CLEANUP_LOCAL_BASELINE = 29 passed / 1 Windows symlink skip
CLEANUP_FINAL_LOCAL = 32 passed / 1 Windows symlink skip
TEST_SOURCE_COMMIT = 7983c2bf6e1e0da9137b019b4e66293914576082
TEST_CI_RUN = 31936103034
LINUX_CLEANUP_SAFETY_STEP = PASS
TEST_CI_RESULT = FAILED (Release I attachment E2E advanced after PATCH response but before client mutation state settled)
TEST_FAILURE_CLASS = TEST_SYNCHRONIZATION_DEFECT
TEST_SYNC_FIX_SCOPE = attachment-upload-flow.spec.ts only; runtime source unchanged
TEST_SYNC_FIX_LOCAL = PASS / 18 passed / 0 skipped
TEST_SYNC_FOLLOWUP_COMMIT = PENDING
```

## Recovery Notes

```text
RECOVERABLE_ERRORS_ENCOUNTERED = invalid-cell dispatches, SSH quoting, host pg_restore absence, and CRLF shell transport
RECOVERABLE_ERRORS_RESOLVED = YES (no cleanup apply or unintended production mutation occurred)
```

## Production Evidence

```text
PRE_CLEANUP_BACKUP = /opt/chat-reader/backups/release-j-precleanup-20260816T081840Z-7bcd686
BACKUP_VERIFIED = PASS (five checksums, pg_restore listing, four tar listings)
PRODUCTION_DRY_RUN_A = PASS
PRODUCTION_DRY_RUN_B = PASS
CANDIDATE_SET_STABLE = PASS
SAFE_TEMP_A_B = 0 / 0 bytes
ORPHAN_FINAL_A_B = 4 / 659673 bytes
SUPERSEDED_ARTIFACT_A_B = 0 / 0 bytes
UNSAFE_PROTECTED_A_B = 37 / 240320650 bytes
APPROVED_CATEGORY = ORPHAN_FINAL
APPROVED_CANDIDATE_TOKENS = 5b25dfb77228fc7342e05a7e, 92c67fdbd46ee0621c64d424, 310dd2c594a8bbbbfa032737, 22636908b3de8c98298b1e3b
APPROVED_CANDIDATE_COUNT = 4
APPROVED_CANDIDATE_BYTES = 659673
ORPHAN_FINAL_MANUAL_APPLY = PENDING
POST_APPLY_DRY_RUN = PENDING
CANONICAL_STATE_INTEGRITY = PENDING
```
