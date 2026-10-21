# UX quick review — 大表 Markdown 单行编辑（试验已撤回）

2026-10-21；先复测当前真实工作区输入成本并记录源码基线，再尝试有界单行更新。
**最终结果：** 功能门禁通过没有证明快路径已生效；后续真实事件计数得到零次命中。
试验与专属测试已撤回，当前源码恢复到横线内容修复后的 122/1,513 检查点。
范围只看表格工具下方 Markdown textarea 的普通单行编辑；不改用户可见布局、渲染器、
工具限制或完整/不确定输入的旧解析路径。合成数据、已安装 Chrome 和当前源码；
不联网、不 CI、不推送、不部署。

## 发现

| ID | 类型 | 严重度 | 置信度 |
| --- | --- | --- | --- |
| PERF-02 | 大表中编辑一行仍重复扫描/分割/编码整份源码 | Medium | Observed（当前代码 + 同机真实工作区输入测量） |

当前 `updateSimpleMarkdownTableDraft` 已只替换草稿中一个单元格行，但在此之前仍：

1. 将前后两份整表 `split` 成所有物理行；
2. 对完整新文档做 UTF-8 `TextEncoder`；
3. 从文首/文尾重新计算整篇差异；
4. 再次按文首计数目标行号。

**基线：** 同一隔离 Chrome 155、真实 Table tool/textarea、未节流、五次合成按键：

| 表格 | Markdown 源字节 | 输入到真实 GFM 表头更新帧 |
| --- | ---: | ---: |
| 10 列 × 4,000 行 | 397,013 | 37.8–57.5 ms |
| 200 列 × 248 行（50,000 单元格预算） | 499,309 | 68.3–80.8 ms |

浏览器 textarea 的 DOM 值单独到下一帧为 17.4–32.8ms / 22.9–34.0ms；
渲染表头追赶指标另含 React/GFM 和浏览器工作，因此整段差不能归因于文本扫描本身。
Profile 仅五次输入、未节流且无 pass threshold，不是 INP、物理设备延迟或因果分解。
完整数据与四个目标文件摘要见相邻
[性能基线](ux-audit-table-delimiter-content-2026-10-21-evidence/pre-raw-input-optimization-performance.json)、
[浏览器结果](ux-audit-table-delimiter-content-2026-10-21-evidence/pre-raw-input-optimization-browser-result.json)
和[源码 SHA-256](ux-audit-table-delimiter-content-2026-10-21-evidence/pre-raw-input-optimization-source-sha256.json)。

## 改进方向

仅对 textarea `beforeinput` 捕获到的同文档、同一物理行、单行范围操作，提供变更范围与
行索引给已有简单草稿解析器。快速路径只检查被编辑的一行、按该片段 UTF-8 字节差更新
现有长度、复制单条模型行；不拆/编码整篇。输入法、未知 inputType、跨行/换行编辑、
整表粘贴、陈旧 range 或无法证实的状态继续使用现有保守 fallback，不因性能优化放宽
Apply 条件或内容限制。范围、长度和行结构任一不匹配则快速路径返回 null。

先记录此基线后再修改。最终没有保留新输入路径、缓存/Worker 或新增信任标记，
也没有降低表格预览真实性。

## 验收边界

用纯函数测试普通插入、替换、删除、Unicode、头/体/末行、CRLF、输入超限、
换行/分隔行编辑回退；浏览器继续真实双向编辑、中文/Emoji、Apply/Undo 与窗口/边缘
操作。前后保持同一用例和未节流设置；报告全部样本及差异，不设硬件相关门槛。

## 试验与门禁覆盖盲点

试验添加 React `onBeforeInput`，尝试借选区判断同一物理行范围；也试验过当前草稿
“简单表格”标记与行索引的生命周期缓存。无服务测试、lint/typecheck/build 和
76 个 Chrome 场景都通过，但它们验证的是内容结果及回退保护，**没有证明新增路径
实际调用过**。纯函数测试直接提供了变更范围，绕过了真正的 React 事件来源。

后续对实际工作区添加**仅计数、不替换结果**的临时探针：

- textarea 的原生监听器收到四次 `insertText` 和一次 `deleteContentBackward`；
- React `onBeforeInput` 四次回调的 `nativeEvent.type` 均为 `textInput`，
  `nativeEvent.inputType` 为空；删除未进入该 React 回调；
- 新增提示快路径调用 **0 次**，原路径调用 **5 次**。

见[实际事件来源证据](ux-audit-table-delimiter-content-2026-10-21-evidence/raw-input-authority-probe.json)。
它说明前面的“已接入有界路径”判断错误，因此不能凭内容正确和单次时序差异把试验
视作完成。安装的 React 事件实现也注册 `textInput`/keypress/paste/compositionend，
而非直接转发完整原生 beforeinput 事件；没有修改 React 本身或增加框架补丁。

以下五次时序原样保留，属于**未生效试验的观察，不是优化收益**：

| 表格 | 修改前五次 | 修改后五次 |
| --- | --- | --- |
| 10 列 × 4,000 行 | 57.5, 48.9, 51.7, 37.8, 43.8 ms | 46.3, 43.7, 45.3, 48.9, 38.8 ms |
| 200 列 × 248 行 | 68.3, 80.8, 72.3, 71.7, 74.4 ms | 64.4, 69.7, 70.9, 66.7, 78.7 ms |

## 最终取舍

已删除此次 React beforeinput 回调、信任提示接口、简单表格状态缓存及仅用于该接口的
专属纯函数测试；20 个源码/测试哈希逐项恢复为横线内容修复后的检查点。原有
保守字符串差分复用、受控 textarea、真实 GFM 预览、源码预算和 Apply/Undo 保持。
**当前没有该新性能优化**，并且不能从零次路径命中推导任何局部或端到端改善。
后续若重试，必须先证明事件路径实际命中和明确范围绑定；不能以扩大信任跳过 UTF-8、
版本或完整原文检查来换速度。

完整试验数据见
[优化前 profile](ux-audit-table-delimiter-content-2026-10-21-evidence/pre-raw-input-optimization-performance.json)、
[优化后 profile](ux-audit-table-delimiter-content-2026-10-21-evidence/raw-input-post-optimization-performance.json)、
[最终摘要](ux-audit-table-delimiter-content-2026-10-21-evidence/raw-input-final.json)
和[撤回前源码摘要](ux-audit-table-delimiter-content-2026-10-21-evidence/raw-input-final-source-sha256.json)。
其中试验的 123/1,514 检查计数不能替代撤回后的当前验收；最终保留的横线修复为
122 专项、76 Chrome、1,513 无服务检查。大表长任务仍未解决。

仍未运行 CI、未推送、未部署；目标继续活动。
