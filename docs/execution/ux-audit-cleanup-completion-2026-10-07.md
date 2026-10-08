# 噪声清理完成确认与冲突审计 — 2026-10-07

上一目标轮有实质进展：第七批代码、真实数据库／浏览器证据及文档均已完成。
本轮面向普通用户执行清理后的确认与恢复，不重复前七批，不提交／部署。
清理会创建消息版本，因此优先保证用户知道是否实际完成、重试是否会重复写入。
沿用已读取的 ux-audit 工作流；本审计先于产品修改。

| ID | 严重度 | 证据可信度 | 当前证据与影响 | 拟处理 |
|---|---|---|---|---|
| OUT-01 | High | Observed (code + real browser) | `content_cleanup._apply_scan` 成功删除 scan；workspace 的 apply 错误只能再读 preview。响应丢失后 scan/preview 都 404，用户无法分辨是否已完成 | 在原 BackgroundJob 中原子记录无正文完成结果，增加 owner-scoped 核对入口；重复 apply 只返回原完成结果 |
| OUT-02 | High | Observed (code + real browser) | workspace 在 mutation.onSuccess 内 await onApplied；Source Editor 的 callback 会请求正文。GET 失败可把已完成清理显示成 apply 错误 | 独立保存已确认结果；正文刷新失败只提供读取重试，不能再发送 apply |
| PRE-02 | Medium | Observed (browser screenshot + code) | 第七批 source-conflict 截图全部冲突，仍显示“确认应用 1 项清理”且按钮可用。preview.summary.fragments 是已选数，不是可删除数 | 数字准确表述为选择范围；所有选择已确认冲突时禁用应用，直接重新扫描；不靠前端猜删除位置 |

## 方案边界与验证

复用原 `content_noise_scan` BackgroundJob 的 result 和已有 idempotency 索引。
完成结果只含 scan 绑定、计数和完成时间；与删除 scan 同一事务提交，不复制正文、
附件或选择上下文。旧 GET scan 404 合同保留，用独立 outcome GET 区分实际完成、
仍处理、仍待审查与无结果；不能将缺失记录当作成功。原任务终态窗口继续生效，
任务中心仅在窗口内提供结果重入，非永久历史。

部分提交继续使用已有 APPLIED 标记，结果核对报告已完成和剩余范围；不隐式
重发清理。跨账户不可读取凭证；账号删除跟随现有任务归属级联。最终结果写入
须检查扫描／任务绑定，并测试完成提交回滚和实际 PostgreSQL 并发。

先复现丢失响应、编辑器刷新失败；测试均使用真实合成消息、扫描、版本和 API，
只注入网络故障。再覆盖读取重试、刷新重入、两用户隔离、重复请求、部分失败、
冲突、Reader/源码一致性及 375/768/1440px。不要以 mock 成功替代数据库提交。
若持久化设计发现并发问题，修正方案而非放宽验证。

本轮临时目录 `C:/Users/86182/Desktop/wkkk/chat-reader-cleanup-completion-20261007`。
只恢复原独立测试集群，不初始化新集群、不清理残留、不碰生产。全站优化目标
仍 active；密集候选的布局和非本次流程保留后续审计，不宣称全系统已完成。

## 执行记录

第二轮浏览器发现补充问题 **FOC-03 (High, observed)**：375px 通过消息操作
打开源码编辑器后，旧菜单仍打开；首次点击编辑器触发菜单的 outside handler，
随后异步将焦点归还旧按钮。键盘选区因此失效，清理按钮保持禁用。代码确认
`message-item.tsx` 的 onEdit 未关闭菜单。拟在交接编辑器时关闭原菜单，不增加
第二次点击或测试等待来掩盖用户问题。此记录先于相应产品修改。

### 完成实现

- 原扫描任务记录最终计数、时间及内部 POST 回放结果，复用现有索引；任务响应
  去掉内部回放字段。原任务缺失才创建最小结果任务，绑定不符直接失败。
- 最后一个对话的新版本、APPLIED 标记、结果记录和删除扫描在同一事务提交；
  前面已提交对话仍可恢复。结果读取锁定现存 scan，扫描消失时再次核对凭证。
- 结果核对与正文重新读取各自失败、各自重试；确认成功后不再发送 apply。
  20 秒读取上限与卸载取消保留。任务中心使用原终态窗口，无永久历史新功能。
- 预览数字改为已选片段；当前返回覆盖全部已选消息且全部冲突时禁用确认，
  可直接重新扫描。不会声称已检查未加载的分页。手机打开源码先关闭消息菜单。

### 验证与失败记录

| Gate | 结果 | 解释 |
|---|---|---|
| `cleanup-completion-before` | 2 failed | 原实现真实应用已修改正文，丢响应无核对入口；源码 GET 失败误报应用失败。两张基线截图保留 |
| `cleanup-completion-first` | 2 passed / 4 failed | 三处用会消失的任务提示当重入入口；手机未展开消息操作。改用真实固定入口，不改变产品行为来迁就测试 |
| `cleanup-completion-second` | 5 passed / 1 failed | 暴露 FOC-03：手机旧菜单夺焦点，首次源码选择失败。修复产品，保留首次选择断言 |
| `cleanup-completion-delivery` | 33 passed / 2 failed | Task Center 的两项 Python 种子未继承显式 DATABASE_URL，误走本地开发配置，首次 SELECT 因旧 schema 缺列失败；没有执行写入。随后增加缺地址即失败的夹具保护 |
| `cleanup-completion-final` | **35 passed / 0 skipped** | 六个完整浏览器套件在显式隔离 PostgreSQL 地址重跑通过 |

专项 API 最终 **101 passed**，初轮 73 passed 为子集，不叠加计数。最终命令：

```text
python -B -m pytest tests/test_cleanup_outcomes.py tests/test_content_cleanup.py
  tests/test_cleanup_safety.py tests/test_cleanup_access.py tests/test_cleanup_learning.py
  tests/test_cleanup_rule_grants.py tests/test_message_editing_api.py
  tests/test_edit_reindex_integration.py tests/test_reader_api_contract.py
  tests/test_reader_locator_api.py tests/test_sharing_api.py
  tests/test_offline_context_anchors.py tests/test_offline_annotations_api.py
  --basetemp <C-task-root>/api-final -q -p no:cacheprovider
```

PostgreSQL **8 passed**：`test_cleanup_outcomes_postgres`、`test_cleanup_postgres`、
`test_cleanup_rule_postgres`；真实 migration/FK、并发回放、最后事务故障回滚、
账户删除、规则授权和旧选择迁移。独立 URL 指向 loopback 65438，由既有隔离
集群提供；每例创建自己的数据库。测试无需新 migration。

最终浏览器套件：`settings-cleanup-completion` (6)、`settings-cleanup-recovery`
(11)、`settings-cleanup` (6)、`content-cleanup` (1)、`settings-rule-publication`
(6)、`settings-task-center` (5)。覆盖 375/768/1440px、中英文、浅深色、键盘与
实际源码更新；故障只注入丢响应及读取失败，成功由真实 API/worker 提供。

全量 lint、非增量 TypeScript、普通 Web build、diff 检查通过；Alembic 单一
head `20261006_0048`。未执行新的全量 API/PWA、全站浏览器、外部 Skill 或生产
验收，不能把专项通过计为这些通过。

五份脱敏 gate JSON、两张基线及 35 张最终合成截图保存到
`ux-audit-cleanup-completion-2026-10-07-evidence/`。新增结果与冲突画面逐张检查，
其余回归画面使用全图联系表核对布局、换行与操作可达性；不声称正式辅助技术
或对比度全面审计。没有保存真实用户内容、会话或令牌。

### 剩余范围与交接

完成计数：POST 与其回放保持本次 applied 数，outcome/任务汇总累计历史中断
前的 applied 数；两者语义不同已写入合同。凭证跟随任务保存，但任务中心
仍只有原终态窗口，不承诺永久历史。

后续高价值视觉审计可继续检查密集候选的操作密度、完成态过高的空白与遗留
选区说明；本批未改通用弹窗尺寸，也未扩展全部分页冲突预计算。新功能验收
已完成，但长期全站优化目标仍 active，不能标记整个目标完成。

独立 API/worker/PostgreSQL/Web 已停止；C 盘临时文件与测试资料保留，未手动
清理、未使用 Docker、既有开发与生产业务数据未写入。八批改动均保持未提交，HEAD
975c1ee，生产仍 b45f049。继续优化先读 PROJECT_STATE，不重复部署或清理。
