import { useCallback } from "react";
import { usePreferences } from "../../components/preferences-provider";

export function importStateLabel(state: string, zh: boolean): string {
  const labels: Record<string, [string, string]> = {
    COLLECTING: ["等待文件", "Waiting for files"], ANALYZING: ["正在分析", "Analyzing"],
    CANCELING: ["正在停止", "Stopping"], PAUSED: ["已暂停 · 来源保留", "Paused · sources retained"],
    NEEDS_GROUPING: ["需要配对", "Pairing needed"], RESOLVING: ["需要设置", "Configuration needed"],
    READY: ["等待确认导入", "Ready for review"], IMPORTING: ["正在导入", "Importing"],
    COMPLETED: ["已导入", "Imported"], BLOCKED: ["需要处理", "Needs attention"],
    FAILED: ["处理失败 · 可查看原因", "Failed · review the cause"], CANCELED: ["已取消", "Cancelled"],
  };
  return labels[state]?.[zh ? 0 : 1] ?? (zh ? "状态待核对" : "Check status");
}

const english: Record<string, string> = {
  "导入来源": "Import source",
  "选择文件": "Choose files",
  "粘贴文本": "Paste text",
  "粘贴 Markdown 或纯文本对话": "Paste a Markdown or plain-text conversation",
  "在此处粘贴文本；点击“分析并继续”后才会上传。": "Paste text here. It is uploaded only after you choose Analyze & continue.",
  "不会自动读取剪贴板。文本只保留在此页面内存中，只有你明确开始分析时才上传；请勿粘贴不打算导入的敏感内容。": "The clipboard is not read automatically. Text stays in this page's memory until you explicitly start analysis. Do not paste sensitive content you do not intend to import.",
  "已准备一段粘贴文本": "Pasted text is ready",
  "尚未粘贴文本": "No text pasted",
  "输入大小：": "Input size: ",
  "已保留 {0} 个文件选项": "{0} file selections retained",
  "粘贴文本不能超过当前上限 {0} MiB。": "Pasted text must be within the current {0} MiB limit.",
  "粘贴文本超过本批导入上限 {0} MiB。": "Pasted text exceeds this batch's {0} MiB import limit.",
  "分析已停止，来源与设置已保留": "Analysis stopped; sources and settings are retained",
  "停止尚未确认，不代表已经结束。可以核对状态，或先离开处理其他文件；原任务不会被重复提交。": "Stopping is not yet confirmed. Check the status or leave to work on other files; the original task will not be resubmitted.",
  "操作结果需要核对。请先读取原任务状态，不要重复提交；来源不会因关闭窗口而删除。": "Check the original task's status before submitting again. Closing this window does not delete its sources.",
  "核对状态": "Check status", "正在提交…": "Submitting…", "继续分析": "Continue analysis",
  "正在请求停止…": "Requesting stop…", "停止并保留": "Stop and retain", "返回文件选择": "Back to file selection",
  "放弃本次导入…": "Discard this import…",
  "放弃将删除本次暂存来源和导入草稿。已导入的其他对话不会改变。": "Discarding deletes this import's staged sources and draft. Other imported conversations are unchanged.",
  "确认放弃": "Confirm discard",
  "会话状态已变化，请先刷新会话状态再调整来源。其他文件和设置仍保留。": "The session changed. Refresh its status before changing sources; other files and settings are retained.",
  "保留的来源已变化，请替换来源并重新核对。旧预览不会被继续使用。": "A retained source changed. Replace it and review again; its old preview will not be reused.",
  "查看上次保留的导入": "View the last retained import",
  "有 {0} 处本地链接无法解析；文字保留，链接暂不可访问，其他内容可正常导入。": "{0} local links could not be resolved. Text is retained and these links are inactive; other content can be imported.",
  "处理无法解析的链接（{0} 个目标）": "Review unresolved links ({0} targets)",
  "仅关联本 ZIP 内已经核验的文件，不按同名猜测，不访问包外。没有对应文件时可保留文字继续；需要补充文件时替换 ZIP 后重新核对。": "Only verified files in this ZIP can be linked. Names are not guessed and nothing outside the ZIP is accessed. Continue with retained text, or replace the ZIP with the missing file included and review it again.",
  "文档 {0}": "Document {0}", "行 {0}": "Line {0}", "{0} 次引用": "{0} references",
  "关联包内文件": "Link to a file in this ZIP", "为 {0} 选择包内文件": "Select a ZIP file for {0}",
  "保留文字，不访问此链接": "Retain text; keep this link inactive",
  "当前关联目标未在此页或已排除，请重新核对": "The current target is not on this page or is excluded; review it",
  "相对链接超出 ZIP 的目录范围": "The relative link points outside the ZIP",
  "使用了绝对路径": "An absolute path was used",
  "使用了反斜杠路径": "A backslash path was used",
  "引用了本机路径或盘符": "A local filesystem path or drive was used",
  "路径包含空字符": "The path contains a NUL character",
  "链接地址格式无效": "The link address is malformed",
  "路径经过多层编码，无法可靠解析": "The path has excessive encoding and cannot be resolved reliably",
  "无法在 ZIP 内可靠解析该路径": "The path cannot be resolved reliably inside the ZIP",
  "路径包含重复分隔符或不规范目录段": "The path contains repeated separators or noncanonical segments",
  "缺少 {0} 个附件，正文仍可导入；缺失引用将保留。": "{0} attachments are missing. Text can still be imported; missing references will be retained.",
  "文件缺失 · 保留引用": "File missing · reference retained",
  "已导入，部分附件缺失": "Imported with missing attachments",
  "缺少 {0} 个附件；正文和缺失引用已保留。": "{0} attachments are missing; text and missing references were retained.",
  "操作结果尚未确认。请在任务中心查看原任务，不要重复提交或重新上传。": "The operation result is unconfirmed. Check the original task in Tasks; do not submit or upload it again.",
  "累计等待资源已达 30 分钟，任务已暂停。请在任务中心继续原任务，无需重新上传。": "Resource waiting reached 30 minutes. Continue the paused original task in Tasks without uploading again.",
  "单条消息超过 1 MiB 处理上限，未拆分或截断；请检查来源。": "One message exceeds the 1 MiB processing limit. It was not split or truncated; review the source.",
  "服务器存储空间不足，源文件仍保留。处理已停止，请释放空间后在任务中心继续。": "Server storage is full and sources are retained. Processing stopped; free space, then continue in Tasks.",
  "处理单元超过内存工作区上限，已停止自动重试；源文件仍保留，请检查处理链路。": "A processing unit exceeded the workspace limit. Automatic retries stopped and sources are retained; review the processing path.",
  "等待服务器资源，系统会自动继续；源文件和当前映射保留，无需重新上传。": "Waiting for server resources. Processing will resume automatically; sources and the current mapping are retained, with no re-upload needed.",
  "源文件不可用，已保存的配置仍可查看。请选择原文件后继续处理。": "Source files are unavailable. Saved configuration is still visible; choose the original files to continue.",
  "原文件仍保留，导入预览已过期或缺失。重新生成预览会保留分组和映射，不会提交导入。": "Source files are retained, but the import preview expired or is missing. Rebuilding preserves grouping and mappings; it does not commit the import.",
  "重新生成预览": "Rebuild preview",
  "刷新会话状态": "Refresh session",
  "请先重新生成预览，再确认导入。": "Rebuild the preview before confirming import.",
  "会话状态已变化，请先刷新会话状态再决定是否重新生成预览。已保存的配置仍保留。": "The session changed. Refresh its state before deciding whether to rebuild the preview. Saved configuration is retained.",
  "源文件不可用，已保存的分组和映射仍保留。": "Source files are unavailable. Saved grouping and mappings are retained.",
  "请先完成已有映射，再重新生成预览。": "Complete the saved mappings before rebuilding the preview.",
  "展开其余 {0} 条提示": "Show the remaining {0} notices",
  "只读样本：最多 12 条消息，每条最多 2000 字符；不改变映射或正文。": "Read-only sample: up to 12 messages and 2000 characters each; mapping and source are unchanged.",
  "预览显示方式": "Preview display",
  "渲染": "Rendered",
  "源码": "Source",
  "此条仅显示正文前 2000 字符。": "Only the first 2000 characters of this message are shown.",
  "第 {0} 条消息样本": "Message {0} sample",
  "其余 {0} 条消息未在样本中展示。": "The remaining {0} messages are not shown in this sample.",
  "导入位置": "Import destination",
  "未归类": "Unclassified",
  "当前项目": "Current project",
  "项目不可用": "Project unavailable",
  "正在保存导入位置…": "Saving import destination…",
  "原项目已不可用，请从有效项目页面重新打开导入。": "The original project is unavailable. Reopen import from an active project.",
  "导入分析未完成": "Import analysis did not finish",
  "导入分析已取消": "Import analysis cancelled",
  "本次临时来源已移除，尚未导入对话。你可以重新选择文件。": "Temporary sources for this analysis were removed; no conversations were imported. You can choose files again.",
  "正在停止导入分析": "Stopping import analysis",
  "已加入后台分析队列": "Queued for background analysis",
  "正在后台分析文件": "Analyzing files in the background",
  "这批 {0} 个文件已保存在服务器。你可以关闭此窗口继续阅读，在任务中心查看进度和结果。": "This batch of {0} files is saved on the server. You can close this window, keep reading, and check progress and results in Tasks.",
  "首轮分析失败，尚未导入对话。源文件仍保留，可在任务中心重试或重新选择文件。": "Initial analysis failed; conversations have not been imported. Source files are retained. Retry in Tasks or choose different files.",
  "服务器当时可用内存不足以安全分析这个 ZIP。文件仍保存在服务器，尚未导入；可以直接重试，或稍后再试。": "There was not enough available memory to safely analyze this ZIP. The file is still saved on the server and has not been imported. Retry now or try again later.",
  "这个 ZIP 超出了小内存安全处理范围。文件仍保存在服务器，尚未导入；请稍后重试，或缩小归档后重试。": "This ZIP exceeded the safe low-memory processing budget. The file is still saved on the server and has not been imported. Retry later or use a smaller archive.",
  "服务器可用内存不足，导入已安全停止，本次更改未提交。源文件和导入草稿仍保留，可稍后重试，无需重新上传。": "Not enough memory is available. Import stopped safely and these changes were not committed. Source files and the import draft are retained. Retry later without uploading again.",
  "导入分析": "Import analysis",
  "查看后台任务": "View background tasks",
  "正在提交重试…": "Queuing retry…",
  "重试分析": "Retry analysis",
  "取消本次分析": "Cancel this analysis",
  "格式不支持？": "Format not supported?",
  "重新选择本批文件": "Choose this batch again",
  "选择转换后的文件": "Choose the converted file",
  "这是 Skill 文件，请在设置的 Skill 管理中上传。": "This is a Skill file. Upload it in Settings → Skill management.",
  "本批文件合计不能超过 {0} MiB，请分批导入。": "This batch must be within {0} MiB. Import it in smaller batches.",
  "使用格式转换 Skill": "Use format conversion Skill",
  "下载 Skill ZIP。": "Download the Skill ZIP.",
  "要求输出 ChatGPT Markdown Transcript Profile v1。": "Request ChatGPT Markdown Transcript Profile v1.",
  "Skill 只负责把无法安全映射的源文件整理为 ChatGPT Markdown Transcript Profile v1；不会回答、总结或改写原对话。": "The Skill converts sources without reliable mappings into ChatGPT Markdown Transcript Profile v1; it does not answer, summarize or rewrite the conversation.",
  "请在设置的数据与备份中恢复 .cr 归档。": "Restore .cr archives from Data & backup in Settings.",
  "请打开目标对话，在批注旁的上下文面板中更新 Current / Index。": "Open the target conversation and update Current / Index in the Context panel beside annotations.",
  "没有可靠的消息边界": "No reliable message boundaries", "当前内容不足以安全分割为 Conversation 消息。": "This content cannot be safely divided into conversation messages.",
  "这不是对话记录": "This is not a conversation transcript", "当前文件是说明文档或转换指令，不是可直接分段的 Conversation。": "This file contains documentation or conversion instructions, rather than a conversation transcript.",
  "文件没有可导入内容": "No importable content", "文件为空，无法建立 Conversation。": "The file is empty and cannot form a conversation.",
  "文件类型不属于标准导入格式": "Unsupported file type", "当前文件类型没有可用的确定性解析器。": "No supported parser is available for this file type.",
  "JSON 无法解析": "Cannot parse JSON", "语法或编码错误无法通过字段映射解决。": "Field mapping cannot fix syntax or encoding errors.",
  "文本编码无法读取": "Unreadable text encoding", "请先转换为 UTF-8 文本，或使用 Conversation Rescue。": "Convert the file to UTF-8 text, or use Conversation Rescue.",
  "当前结构不足以安全生成 Conversation。": "This structure cannot safely form a conversation.",
  "无法连接服务器。请检查网络后重试，当前输入仍然保留。": "Cannot connect to the server. Check your network and retry; your input is retained.",
  "服务暂时不可用，请稍后重试。": "The service is temporarily unavailable. Please retry shortly.",
  "正在恢复已保存的导入会话…": "Restoring the saved import session…",
  "IMPORT_COMMIT_FAILED": "This import did not complete. Your source files and import session are retained; review them and choose Import again.",
  "IMPORT_COMMIT_CANCELLED": "This import was cancelled. Your source files and import session are retained; choose Import again when ready.",
  "导入分析的提交结果尚未确认。请先在任务中心核对是否已有本批分析，再决定是否重新上传。": "Import analysis submission is not confirmed. Check Tasks for this batch before uploading it again.",
  "替换文件未能保存，原文件仍保留，请稍后重试。": "The replacement could not be saved. The original file is retained; please retry shortly.",
  "本批文件合计超过当前导入总容量限制，请分批导入。": "This batch exceeds the total import limit. Import the files in smaller batches.",
  "当前导入状态已变化，请返回概览后重试。": "The import state has changed. Return to the overview and retry.",
  "服务器正在处理另一个大文件，请稍后重试。": "The server is processing another large file. Please retry shortly.",
  "服务器当前可用内存不足以安全分析所选文件。请减小单个文件或拆分批次后重试。": "There is not enough available memory to safely analyze these files. Reduce the file size or split the batch, then retry.",
  "服务器的导入分析队列已满，请稍后重试。": "The import analysis queue is full. Please retry shortly.",
  "服务器仍在分析其他大文件，本次尚未开始。请稍后重试。": "The server is still analyzing another large upload. This request has not started; please retry shortly.",
  "替换后的文件会超过本次导入总容量限制。": "The replacement would exceed this import session's total size limit.",
  "导入结果尚未确认。请返回概览检查当前状态，再决定是否重试。": "The import result is not confirmed. Return to the overview to check the current state before deciding whether to retry.",
  "请求结果尚未确认。请检查当前导入状态，再决定是否重试。": "The request result is not confirmed. Check the current import state before deciding whether to retry.",
  "登录状态已失效，请重新登录后重试。": "Your sign-in has expired. Sign in again and retry.",
  "没有权限完成这次导入。": "You do not have permission to complete this import.",
  "当前导入会话已不存在，请返回后重新选择文件。": "This import session no longer exists. Go back and choose the files again.",
  "所选文件超过当前导入限制，请分批导入。": "The selected files exceed the current import limit. Import them in smaller batches.",
  "导入操作失败，请稍后重试。": "The import operation failed. Please retry shortly.",
  "所选文件超过当前单文件大小限制。": "The selected file exceeds the current per-file limit.",
  "最后一项不能排除，请替换它的源文件或重新选择文件。": "The last item cannot be excluded. Replace its source or choose files again.",
  "一次最多分析 500 个文件。": "Analyze up to 500 files at a time.",
  "请选择至少一个 JSON、Markdown 或 ZIP 源文件。": "Choose at least one JSON, Markdown or ZIP source file.",
  "已提交 {0} 个对话，共 {1} 条消息。": "Imported {0} conversations with {1} messages.",
  "打开第 {0} 条": "Open conversation {0}",
  "发现 {0} 个对话，识别出 {1} 种格式": "Found {0} conversations in {1} formats",
  "管理员已关闭导入功能。": "Importing is disabled by the administrator.", "单个文件不能超过当前上限 {0} MiB。": "Each file must be within the current {0} MiB limit.", "尚未选择文件": "No files selected", "已选择 {0} 个文件": "{0} files selected",
  "选择一组采用该格式的代表性源文件。验证成功后会保存新版本，旧版本继续可用。": "Choose representative sources for this format. Successful validation saves a new version while retaining earlier versions.", "选择对话源文件。已知格式会直接准备导入；陌生结构只需设置一次，以后会自动识别。": "Choose your conversation files. Known formats are ready to import. Map an unfamiliar structure once to recognize it in future imports.",
  "导入类型": "Import type", "已知与已学习格式": "Built-in and learned formats", ".cr 归档": ".cr archive", "恢复 Chat Reader 归档": "Restore a Chat Reader archive", "修复只接受 JSON / Markdown": "Repair accepts JSON / Markdown sources", "拖放文件到这里": "Drop files here", "或": "or",
  "选择 JSON / Markdown 文件": "Choose JSON / Markdown files", "选择 .cr 归档": "Choose a .cr archive", "支持单 JSON、单 Markdown、JSON + Markdown 及批量文件": "Supports JSON, Markdown, paired files and batches", ".cr 使用独立归档恢复流程": ".cr files use the archive restore flow", "当前单文件上限：": "Current limit per file: ", "无法读取导入限制。": "Import limits are unavailable.", "重试": "Retry", "正在读取导入限制…": "Reading import limits…",
  "选择 JSON / Markdown / ZIP 文件": "Choose JSON / Markdown / ZIP files", "仅支持 JSON、Markdown、ZIP 或文本源文件。": "Choose JSON, Markdown, text, or ZIP source files.", "ZIP 内容": "ZIP contents", "可在导入前确认文档、附件和排除项": "Review documents, attachments, and exclusions before import", "个文档": " documents", "个附件": " attachments", "项排除": " excluded", "条提示": " notices", "查看 ZIP 内容": "View ZIP contents", "查看内容": "View contents", "收起内容": "Collapse contents", "正在读取 ZIP 内容…": "Reading ZIP contents…", "导入为对话": "Import as conversation", "导入为附件": "Import as attachment", "排除": "Exclude", "附件归属对话": "Attachment conversation(s)", "分类": "Classification", "次引用": " references", "只保存发生变化的分类；资源文件仍从原 ZIP 安全读取。": "Only changed classifications are saved; resources are read safely from the original ZIP.", "保存 ZIP 分类": "Save ZIP classification", "正在读取…": "Reading…", "读取其余 {0} 项": "Read the remaining {0} items",
  "正在识别格式": "Recognizing formats…", "分析并继续": "Analyze & continue", "检查归档": "Check archive", "恢复归档": "Restore archive", "系统中已有相同归档。默认会创建副本，不覆盖原记录。": "This archive already exists. By default, restoring creates a copy and preserves the original.", "打开已有对话": "Open existing conversation",
  "ZIP 内容已变化，未保存的选择已保留。请重新读取并核对后再保存。": "ZIP contents changed. Your unsaved selections are preserved. Reload and review before saving.",
  "重新读取 ZIP 内容": "Reload ZIP contents",
  "放弃旧选择，使用最新分类": "Discard old selections and use current classification",
  "请先保存或放弃 ZIP 分类选择，再进行其他操作。": "Save or discard ZIP classification selections before continuing.",
  "ZIP 分类尚未保存": "ZIP classification has not been saved",
  "放弃 ZIP 分类选择": "Discard ZIP classification selections",
  "导入已完成": "Import complete", "已提交": "Imported ", "个对话，共": " conversations with ", "条消息。": " messages.", "导入提示": "Import notes", "已导入的对话": "Imported conversations", "已导入对话": "Imported conversation", "打开第": "Open conversation ", "条": "", "另有": "There are ", "个对话可在资料库中查看。": " more conversations in the library.", "查看导入的对话": "View imported conversations", "打开对话": "Open conversation", "打开第一条": "Open first conversation",
  ".cr 归档必须单独导入。": "Import one .cr archive at a time.",
  "放弃未保存的映射？": "Discard unsaved mapping?", "字段映射尚未保存，导入会话和原始文件仍会保留。": "The field mapping has not been saved. The import session and source files will remain available.", "放弃更改": "Discard changes",
  "返回导入概览": "Back to import overview", "修复导入格式": "Repair import format", "设置新的导入格式": "Learn a new import format",
  "此设置会应用于当前结构的": "This mapping applies to all ", "个对话。": " conversations with this structure.",
  "示例对话": "Sample conversation", "切换当前结构的示例对话": "Choose a sample with this structure", "示例：": "Sample: ", "当前文件": "Current file",
  "规范字段映射": "Field mapping", "只保存结构、字段映射与角色字典，不保存示例正文。": "Only the structure, field mapping and role dictionary are learned. Sample content is not saved.",
  "保存为导入格式": "Format name", "验证会运行此格式的全部": "Validation checks all ", "个对话，不只检查示例。": " conversations using this format, including those outside the preview.",
  "正在验证": "Validating…", "验证映射": "Validate mapping", "继续查看验证结果": "Continue reading validation result", "正在保存": "Saving…", "保存新版本并继续": "Save new version & continue", "保存映射并继续": "Learn mapping & continue",
  "读取结果超时，原文件和当前输入仍保留。可继续核对，没有重新提交。": "Reading the result timed out. Original files and current input are retained. Continue checking; nothing was resubmitted.",
  "来源结构": "Source structure", "结构分析": "Structure analysis", "个候选结构。点击诊断可定位到对应字段。": " candidate structures. Use a diagnostic to locate its field.",
  "JSON 字段映射": "JSON field mapping", "消息列表": "Message list", "角色来源": "Role source", "未设置": "Not set", "正文来源": "Content source", "标题来源": "Title source", "使用文件名": "Use filename",
  "Markdown 字段映射": "Markdown field mapping", "消息分界": "Message boundary", "H{0} 角色标题": "H{0} role headings", "角色标签行": "Role label lines", "Markdown 前置内容": "Markdown preamble",
  "忽略并提示": "Ignore with notice", "保留到首条": "Keep in first message", "JSON 与 Markdown 字段映射": "JSON and Markdown field mapping", "JSON 来源": "JSON source", "Markdown 来源": "Markdown source",
  "JSON 与 Markdown 对应关系": "JSON and Markdown alignment", "角色 + 时间": "Role + time", "顺序": "Order",
  "默认使用 Markdown 正文、JSON 角色和时间。完整文件组合必须通过关系校验。": "Uses Markdown content with JSON roles and timestamps by default. The complete file group must pass alignment validation.",
  "角色值": "Role values", "{0} 对应的标准角色": "Standard role for {0}", "需要确认": "Choose a role", "导入预览": "Import preview", "全部对话通过": "All conversations validated", "验证失败": "Validation failed",
  "正在验证所有对话": "Validating every conversation…", "确认字段后运行“验证映射”，这里会显示 Chat Reader 实际将要导入的对话。": "Choose the fields, then validate the mapping to preview the actual conversation that Chat Reader will import.",
  "条消息": " messages", "返回概览处理输入": "Return to overview to fix input", "自定义 JSON + Markdown": "Custom JSON + Markdown", "自定义 Markdown": "Custom Markdown", "自定义 JSON": "Custom JSON", "你": "You",
  "重新选择文件": "Choose different files", "导入概览": "Import overview", "发现": "Found ", "个对话，识别出": " conversations in ", "种格式": " formats", "个对话需要修复输入": " conversations need input repair",
  "其他已识别格式仍可继续设置。替换、排除或重新组合这些文件后，系统会自动重新分析。": "You can configure other recognized formats now. Replacing, excluding or regrouping these files automatically runs analysis again.",
  "调整文件组合": "Adjust file groups", "导入格式处理状态": "Import format status", "已支持": "Supported", "可设置格式": "Can be mapped", "暂不可映射": "Cannot be mapped yet",
  "已支持 · 可直接导入": "Supported · Ready to import", "可设置格式 · 需要确认一次": "Mappable · Confirm the mapping once", "暂不可映射 · 需要先转换": "Not mappable · Convert the source first",
  "准备导入 {0} 个对话、{1} 条消息。": "Ready to import {0} conversations and {1} messages.", "还有 {0} 个对话需要设置或修复。已完成的处理会保留。": "{0} conversations still need mapping or repair. Completed work is retained.",
  "正在整理导入计划。": "Preparing the import plan…", "正在导入": "Importing…", "导入 {0} 个对话": "Import {0} conversations", "个对话 ·": " conversations · ",
  "检测到来源结构变化，需要保存一个新版本。": "The source structure has changed. Save a new format version to continue.", "使用": "Use ", "修复格式": "Repair format", "设置格式": "Map format",
  "需要处理的输入": "Input requiring attention", "使用 Conversation Rescue": "Use Conversation Rescue", "保留": "Keep", "确认不导入": "Confirm exclusion", "最后一项不能排除，请替换文件或重新选择。": "The last item cannot be excluded. Replace it or choose different files.",
  "从本次导入中排除这一项": "Exclude this item from the import", "不导入此项": "Exclude this item",
  "将不可映射的源文件恢复为 Chat Reader 可导入的 Markdown。Chat Reader 不会自动上传原文。": "Recover an unmappable source as importable Markdown. Chat Reader does not upload the original content automatically.",
  "关闭": "Close", "查看 Skill 摘要": "View skill summary", "Skill 只负责把无法安全映射的源文件整理为 Chat Reader Native Markdown Export v2；不会回答、总结或改写原对话。": "The skill converts unmappable sources into Chat Reader Native Markdown Export v2 without answering, summarizing or rewriting the transcript.",
  "当前文件：": "Current file: ", "当前结构没有可靠的消息边界。继续设置角色或内容字段无法安全得到 Conversation。": "This structure has no reliable message boundaries. Choosing role or content fields cannot safely reconstruct the conversation.",
  "复制或下载 Rescue Skill。": "Copy or download the Rescue skill.", "将源文件和 Skill 提供给你选择的大模型。": "Provide the source and skill to a model of your choice.", "要求输出 Chat Reader Native Markdown Export v2。": "Request Chat Reader Native Markdown Export v2.", "回到这里替换当前文件，再重新分析。": "Return here, replace the file and analyze it again.",
  "中文 Skill": "Chinese skill", "下载 Skill": "Download skill", "复制 Skill": "Copy skill", "已复制，可粘贴到大模型。": "Copied. Paste it into your chosen model.", "下载文件后，与源文件一起提供给外部大模型。": "Provide the downloaded skill along with your source to the external model.",
  "转换请求模板": "Conversion request template", "复制模板": "Copy template", "已复制。": "Copied.", "输出后请重新上传生成的 .md 文件。": "Upload the generated .md file when conversion is complete.",
  "隐私提示：外部大模型可能会读取源文件中的对话内容。Chat Reader 不会代替你向第三方服务上传文件，请自行确认隐私范围。": "The external model may read the conversation in your source. Chat Reader does not send files to third parties for you. Choose what you want to share.",
  "替换当前文件": "Replace current file", "稍后处理": "Do this later", "替换 {0}": "Replace {0}", "替换文件": "Replace file", "这个导入会话需要恢复": "This import session needs recovery",
  "源文件仍然保留。可以使用当前分析器重新检查，或先调整文件组合。": "Your source files are retained. Analyze them again or adjust their grouping first.", "调整组合": "Adjust groups", "重新分析": "Analyze again", "对话组合 {0}": "Conversation group {0}",
  "取消本次导入": "Cancel this import", "确认文件组合": "Confirm file groups", "把属于同一段对话的 JSON 与 Markdown 设为相同组合编号。一个组合最多包含一个 JSON 和一个 Markdown；单文件也可以独立导入。": "Give the JSON and Markdown files of the same conversation the same group number. Each group can contain at most one of each. Single files can also be imported independently.",
  "组合": "Group", "{0} 的组合编号": "Group number for {0}", "正在重新分析": "Analyzing…", "确认组合并继续": "Confirm groups & continue", "请为每个文件填写组合编号。": "Enter a group number for every file.", "组合 {0} 不是有效组合：最多放入一个 JSON 和一个 Markdown。": "Group {0} is invalid: use at most one JSON and one Markdown file.",
  "准备导入": "Ready to import", "需要恢复": "Recovery needed", "{0} 项待处理": "{0} items need attention", "兼容": "Compatible", "结构变化": "Structure changed", "需要选择": "Choose a format", "需要设置": "Mapping needed", "需要修复": "Repair needed",
  "定位：": "Locate: ", "位置：": "Location: ",
  "JSON 文件不完整、编码错误或语法无效。请替换为修正后的文件，或不导入这一项。": "The JSON file is incomplete or has invalid encoding or syntax. Replace it with a corrected file, or exclude it.",
  "没有找到可确认的消息结构。可以替换文件，或调整文件组合后重试。": "No reliable message structure was found. Replace the file or adjust file groups, then retry.",
  "Markdown 不是有效的 UTF-8 文本。请转换编码后替换文件。": "The Markdown is not valid UTF-8 text. Convert its encoding and replace the file.", "Markdown 文件没有可导入内容。请替换文件，或不导入这一项。": "The Markdown file has no importable content. Replace it or exclude it.",
  "Markdown 中有未闭合的代码块。请修正后替换文件。": "The Markdown has an unclosed code fence. Correct it and replace the file.", "这些文件不能安全组成一个对话。请调整文件组合。": "These files cannot safely form one conversation. Adjust the file groups.", "临时源文件已丢失。请替换该文件或重新选择。": "The temporary source is missing. Replace it or choose files again.",
  "无法分析的 JSON + Markdown": "Unrecognized JSON + Markdown", "无法分析的 Markdown": "Unrecognized Markdown", "无法分析的 JSON": "Unrecognized JSON", "未知 JSON + Markdown 格式": "Unknown JSON + Markdown format", "未知 Markdown 格式": "Unknown Markdown format", "未知 JSON 格式": "Unknown JSON format", "第 {0} 行": "Line {0}", "文本文件": "Text file",
};

export type ImportCopy = (key: string, ...values: Array<string | number>) => string;

export function importWarningMessage(warning: string, tr: ImportCopy): string {
  const missing = /^ZIP missing attachments: (\d+)\./.exec(warning);
  const blocked = /^ZIP blocked references: (\d+)\./.exec(warning);
  if (blocked) return tr("有 {0} 处本地链接无法解析；文字保留，链接暂不可访问，其他内容可正常导入。", blocked[1]);
  return missing ? tr("缺少 {0} 个附件；正文和缺失引用已保留。", missing[1]) : warning;
}

export function archivePathReason(reason: unknown, zh: boolean): string {
  const reasons: Record<string, [string, string]> = {
    outside_archive: ["相对链接超出 ZIP 的目录范围", "The relative link points outside the ZIP"],
    absolute: ["使用了绝对路径", "An absolute path was used"],
    parent_segment: ["ZIP 条目路径包含上级目录（..）", "A ZIP member path contains a parent segment (..)"],
    backslash: ["使用了反斜杠路径", "A backslash path was used"],
    local_filesystem: ["引用了本机路径或盘符", "A local filesystem path or drive was used"],
    nul: ["路径包含空字符", "The path contains a NUL character"],
    empty: ["条目路径为空", "The member path is empty"],
    noncanonical: ["路径包含重复分隔符或不规范目录段", "The path contains repeated separators or noncanonical segments"],
    duplicate: ["多个 ZIP 条目使用相同路径", "Multiple ZIP members use the same path"],
    encrypted: ["ZIP 条目已加密", "The ZIP member is encrypted"],
    special_file: ["ZIP 条目是链接或特殊文件，不是普通文件", "The ZIP member is a link or special file, not a regular file"],
    invalid_url: ["链接地址格式无效", "The link address is malformed"],
    excessive_encoding: ["路径经过多层编码，无法可靠解析", "The path has excessive encoding and cannot be resolved reliably"],
  };
  const pair = typeof reason === "string" ? reasons[reason] : undefined;
  return pair ? pair[zh ? 0 : 1] : zh ? "无法在 ZIP 内可靠解析该路径" : "The path cannot be resolved reliably inside the ZIP";
}

export type ImportErrorAction = "read" | "mutation" | "commit";

export function importFailureMessage(
  failure: unknown,
  legacyError: string | null | undefined,
  stage: "analysis" | "commit",
  zh: boolean,
): string | null {
  if (legacyError === "IMPORT_RESOURCE_WAIT_EXPIRED" || (failure as { code?: unknown } | null)?.code === "IMPORT_RESOURCE_WAIT_EXPIRED") {
    return zh ? "累计等待资源已达 30 分钟，任务已暂停。源文件和已完成的处理仍保留，可在任务中心继续原任务，无需重新上传。"
      : "Resource waiting reached 30 minutes; the task is paused. Sources and completed work are retained. Continue the original task in Tasks without uploading again.";
  }
  const value = failure !== null && typeof failure === "object"
    ? failure as Record<string, unknown>
    : null;
  const code = typeof value?.code === "string" ? value.code : (
    legacyError === "UPLOAD_MEMORY_PRESSURE" || legacyError === "There is not enough memory headroom to safely analyze this upload. Reduce the file size or split the batch, then retry."
      || legacyError === "The server cannot safely commit this import under current memory pressure. Retry when other work finishes, or split the source into smaller conversations."
      ? "UPLOAD_MEMORY_PRESSURE" : ""
  );
  if (code === "IMPORT_MESSAGE_TOO_LARGE") {
    return zh ? "单条消息超过 1 MiB 安全处理上限，未拆分或截断内容。源文件仍保留，请调整该条消息后替换来源。"
      : "A single message exceeds the 1 MiB processing limit. Nothing was split or truncated. Sources are retained; adjust that message and replace the source.";
  }
  if (code === "IMPORT_STORAGE_FULL") {
    return zh ? "服务器临时存储空间不足，处理已停止。源文件仍保留，请释放服务器空间后继续，无需重新上传。"
      : "Server staging storage is full. Processing stopped and sources are retained. Free server storage, then continue without uploading again.";
  }
  if (code === "IMPORT_WORKSPACE_EXCEEDED") {
    return zh ? "这一处理单元超出了内存工作区上限，任务已安全停止。源文件仍保留，需要检查处理链路；系统不会反复自动重试。"
      : "A processing unit exceeded the workspace limit. The task stopped safely and sources are retained. The processing path needs review; it will not repeatedly retry automatically.";
  }
  if (code === "UPLOAD_MEMORY_PRESSURE") {
    return stage === "commit"
      ? zh ? "服务器可用内存不足，导入已安全停止，本次更改未提交。源文件和导入草稿仍保留，可稍后重试，无需重新上传。" : "Not enough memory is available. Import stopped safely and these changes were not committed. Source files and the import draft are retained. Retry later without uploading again."
      : zh ? "服务器当时可用内存不足，文件分析已安全停止，尚未导入对话。源文件仍保留，可直接重试或稍后再试，无需重新上传。" : "There was not enough available memory. Analysis stopped safely and no conversations were imported. Source files are retained. Retry now or later without uploading again.";
  }
  if (code === "SMALL_IMPORT_BUDGET_EXCEEDED") {
    return zh ? "这个 ZIP 超出了小内存安全处理范围，本次导入未完成。源文件仍保留，请稍后重试，或缩小归档后重试。"
      : "This ZIP exceeded the safe low-memory processing budget and import did not finish. Source files are retained. Retry later or use a smaller archive.";
  }
  if (code === "UPLOAD_QUEUE_FULL" || code === "UPLOAD_QUEUE_TIMEOUT") {
    return zh ? "服务器正在处理另一个导入任务，本次分析尚未完成。源文件仍保留，请稍后重试，无需重新上传。"
      : "The server is processing another import. This analysis did not finish, but source files are retained. Retry later without uploading again.";
  }
  if (["MANIFEST_ASSET_MISSING", "MARKDOWN_RESOURCE_MISSING"].includes(code)) {
    return zh ? "此前的分析因附件缺失停止，源文件仍保留。可以重试原任务；缺失附件将保留引用，不再阻止正文导入。"
      : "The previous analysis stopped because attachments were missing. Sources are retained. Retry the original task; missing references will be kept without blocking the text import.";
  }
  if (["ZIP_INVALID", "ZIP_CRC_INVALID"].includes(code)) {
    return zh ? "ZIP 文件损坏或完整性校验失败，尚未导入对话。源文件仍保留，请重新导出后替换文件。"
      : "The ZIP is damaged or failed integrity validation. No conversations were imported. Source files are retained. Export it again and replace the file.";
  }
  if (code === "ZIP_SOURCE_CHANGED" || code === "SOURCE_CHANGED") {
    return zh ? "保留的来源已发生变化，旧预览和关联不能继续使用。请替换来源并重新核对；尚未导入对话。"
      : "A retained source changed. Its old preview and bindings cannot be reused. Replace the source and review it again; no conversations were imported.";
  }
  if (code === "SOURCE_PATH_INVALID") {
    return zh ? "服务器暂存来源的位置无法安全确认，处理已停止，未导入对话。请管理员检查暂存目录；不要通过关闭路径校验来重试。也可以返回文件选择，建立新的导入。"
      : "The staged source location could not be verified safely. Processing stopped without importing conversations. Ask an administrator to check staging storage, or return to file selection for a new import. Do not disable path validation.";
  }
  if (["ZIP_PATH_UNSAFE", "ZIP_PATH_DUPLICATE", "MANIFEST_ASSET_PATH_INVALID", "ZIP_MEMBER_UNSUPPORTED"].includes(code)) {
    const details = value?.details !== null && typeof value?.details === "object" ? value.details as Record<string, unknown> : null;
    const index = typeof details?.entry_index === "number" && Number.isSafeInteger(details.entry_index) && details.entry_index > 0 ? details.entry_index : null;
    const location = index ? zh ? `ZIP 第 ${index} 个条目：` : `ZIP entry ${index}: ` : "";
    if (details?.reason) {
      const repair = code === "ZIP_MEMBER_UNSUPPORTED"
        ? zh ? "请将该条目改为未加密的普通文件后替换 ZIP。" : "Replace this ZIP after exporting that entry as an unencrypted regular file."
        : code === "ZIP_PATH_DUPLICATE"
          ? zh ? "请为重复条目使用不同路径，并同步正文链接后替换 ZIP。" : "Give duplicate entries distinct paths, update their links, and replace the ZIP."
          : zh ? "请修正该条目的包内相对路径，并同步正文链接后替换 ZIP。" : "Correct that member's archive-relative path and its links, then replace the ZIP.";
      return `${location}${archivePathReason(details.reason, zh)}。${zh ? "为防止读取错误文件，本文件分析已停止，来源仍保留。" : " Analysis stopped to avoid reading the wrong file; the source is retained. "}${repair}`;
    }
    if (code === "MANIFEST_ASSET_PATH_INVALID") {
      return zh ? "附件清单声明了无法安全解析的资源路径。请检查 manifest.json 中 assets 的路径，改为 ZIP 内的相对路径后替换来源；正文中的普通失效链接不会按此错误阻断。"
        : "The asset manifest declares a path that cannot be resolved safely. Correct assets paths in manifest.json to archive-relative paths, then replace the source. Ordinary unresolved body links do not cause this error.";
    }
    return zh ? "此前任务因 ZIP 路径问题停止，但未记录具体条目。来源仍保留，可显式重试以重新检查：正文失效链接将安全保留，实际条目风险仍会停止并说明原因。"
      : "The earlier task stopped for a ZIP path issue without recording its entry. The source is retained. Retry explicitly to recheck: unresolved body links will be retained safely; unsafe actual members still stop analysis with a specific reason.";
  }
  return null;
}

const importCodeCopy: Record<string, string> = {
  IMPORT_OPERATION_UNCONFIRMED: "操作结果尚未确认。请在任务中心查看原任务，不要重复提交或重新上传。",
  IMPORT_RESOURCE_WAIT_EXPIRED: "累计等待资源已达 30 分钟，任务已暂停。请在任务中心继续原任务，无需重新上传。",
  IMPORT_MESSAGE_TOO_LARGE: "单条消息超过 1 MiB 处理上限，未拆分或截断；请检查来源。",
  IMPORT_STORAGE_FULL: "服务器存储空间不足，源文件仍保留。处理已停止，请释放空间后在任务中心继续。",
  IMPORT_WORKSPACE_EXCEEDED: "处理单元超过内存工作区上限，已停止自动重试；源文件仍保留，请检查处理链路。",
  IMPORT_DISABLED: "管理员已关闭导入功能。",
  IMPORT_TOTAL_SIZE_LIMIT: "本批文件合计超过当前导入总容量限制，请分批导入。",
  FILE_TOO_LARGE: "所选文件超过当前单文件大小限制。",
  FILE_COUNT_LIMIT: "一次最多分析 500 个文件。",
  FILES_REQUIRED: "请选择至少一个 JSON、Markdown 或 ZIP 源文件。",
  SESSION_PERSISTENCE_FAILED: "导入分析的提交结果尚未确认。请先在任务中心核对是否已有本批分析，再决定是否重新上传。",
  SESSION_ANALYSIS_FAILED: "导入分析的提交结果尚未确认。请先在任务中心核对是否已有本批分析，再决定是否重新上传。",
  SOURCE_REPLACEMENT_FAILED: "替换文件未能保存，原文件仍保留，请稍后重试。",
  UPLOAD_STAGING_BUSY: "服务器正在处理另一个大文件，请稍后重试。",
  UPLOAD_MEMORY_PRESSURE: "服务器当前可用内存不足以安全分析所选文件。请减小单个文件或拆分批次后重试。",
  SMALL_IMPORT_BUDGET_EXCEEDED: "这个 ZIP 超出了小内存安全处理范围。文件仍保存在服务器，尚未导入；请稍后重试，或缩小归档后重试。",
  UPLOAD_QUEUE_FULL: "服务器的导入分析队列已满，请稍后重试。",
  UPLOAD_QUEUE_TIMEOUT: "服务器仍在分析其他大文件，本次尚未开始。请稍后重试。",
  SESSION_TOO_LARGE: "替换后的文件会超过本次导入总容量限制。",
  SESSION_STATE_INVALID: "当前导入状态已变化，请返回概览后重试。",
  SESSION_STATE_CHANGED: "会话状态已变化，请先刷新会话状态再调整来源。其他文件和设置仍保留。",
  SOURCE_CHANGED: "保留的来源已变化，请替换来源并重新核对。旧预览不会被继续使用。",
  PREVIEW_STATE_CHANGED: "会话状态已变化，请先刷新会话状态再决定是否重新生成预览。已保存的配置仍保留。",
  PREVIEW_REBUILD_UNAVAILABLE: "请先完成已有映射，再重新生成预览。",
  SOURCE_MISSING: "源文件不可用，已保存的分组和映射仍保留。",
  SESSION_WOULD_BE_EMPTY: "最后一项不能排除，请替换它的源文件或重新选择文件。",
  IMPORT_COMMIT_FAILED: "这次导入未完成，原始文件和导入会话仍保留。检查后可再次点击导入。",
  IMPORT_COMMIT_CANCELLED: "这次导入已取消，原始文件和导入会话仍保留。准备好后可再次点击导入。",
};

const diagnosticCodes = new Set([
  "unsupported_source_profile",
  "json_required",
  "invalid_import_form",
  "invalid_exporter_json",
  "pairing_candidate_limit",
  "pairing_complexity_limit",
  "pairing_timeout",
  "pairing_ambiguous",
  "alignment_failed",
  "JSON_INVALID",
  "NO_MESSAGE_STRUCTURE",
  "MARKDOWN_ENCODING_INVALID",
  "MARKDOWN_EMPTY",
  "MARKDOWN_FENCE_UNCLOSED",
  "GROUP_AMBIGUOUS",
  "GROUPING_INCOMPLETE",
  "SOURCE_UNSUPPORTED",
  "FILE_EMPTY",
]);

export function importErrorMessage(error: unknown, tr: ImportCopy, action: ImportErrorAction = "read"): string {
  if (action === "read" && (error === "REQUEST_TIMEOUT" || (error instanceof Error && error.message === "REQUEST_TIMEOUT"))) {
    return tr("读取结果超时，原文件和当前输入仍保留。可继续核对，没有重新提交。");
  }
  const code = typeof error === "string" ? error : isApiRequestError(error) ? error.code : null;
  if (action === "commit" && ["UPLOAD_MEMORY_PRESSURE", "SMALL_IMPORT_BUDGET_EXCEEDED"].includes(code ?? "")) {
    return tr(code === "UPLOAD_MEMORY_PRESSURE"
      ? "服务器可用内存不足，导入已安全停止，本次更改未提交。源文件和导入草稿仍保留，可稍后重试，无需重新上传。"
      : "这个 ZIP 超出了小内存安全处理范围。文件仍保存在服务器，尚未导入；请稍后重试，或缩小归档后重试。");
  }
  if (typeof error === "string") {
    if (importCodeCopy[error]) return tr(importCodeCopy[error]);
    if (action !== "read") {
      if (error === "CONNECTION_FAILED") return tr("请求结果尚未确认。请检查当前导入状态，再决定是否重试。");
      return tr("导入结果尚未确认。请返回概览检查当前状态，再决定是否重试。");
    }
    return tr(error === "CONNECTION_FAILED" ? "无法连接服务器。请检查网络后重试，当前输入仍然保留。" : error);
  }
  if (isApiRequestError(error)) {
    if (error.code && importCodeCopy[error.code]) return tr(importCodeCopy[error.code]);
    if (error.code && diagnosticCodes.has(error.code)) return tr(error.message);
    if (action !== "read" && error.status >= 500) return tr("请求结果尚未确认。请检查当前导入状态，再决定是否重试。");
    if (error.status >= 500) return tr("服务暂时不可用，请稍后重试。");
    if (error.status === 401) return tr("登录状态已失效，请重新登录后重试。");
    if (error.status === 403) return tr("没有权限完成这次导入。");
    if (error.status === 404) return tr("当前导入会话已不存在，请返回后重新选择文件。");
    if (error.status === 409) return tr("当前导入状态已变化，请返回概览后重试。");
    if (error.status === 413) return tr("所选文件超过当前导入限制，请分批导入。");
    return tr("导入操作失败，请稍后重试。");
  }
  if (error instanceof Error && error.message === "CONNECTION_FAILED") {
    return tr(action === "read" ? "无法连接服务器。请检查网络后重试，当前输入仍然保留。" : "请求结果尚未确认。请检查当前导入状态，再决定是否重试。");
  }
  return tr(action === "read" ? "导入操作失败，请稍后重试。" : "请求结果尚未确认。请检查当前导入状态，再决定是否重试。");
}

function isApiRequestError(error: unknown): error is { status: number; code?: string; message: string } {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; status?: unknown; code?: unknown; message?: unknown };
  return value.name === "ApiRequestError" && typeof value.status === "number" && typeof value.message === "string";
}
export function useImportCopy(): ImportCopy {
  const { resolvedLocale } = usePreferences();
  return useCallback((key, ...values) => (resolvedLocale === "zh-CN" ? key : english[key] ?? key).replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? "")), [resolvedLocale]);
}
