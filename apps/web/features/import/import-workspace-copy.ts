import { useCallback } from "react";
import { usePreferences } from "../../components/preferences-provider";

const english: Record<string, string> = {
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
  "请选择至少一个 JSON 或 Markdown 文件。": "Choose at least one JSON or Markdown file.",
  "已提交 {0} 个对话，共 {1} 条消息。": "Imported {0} conversations with {1} messages.",
  "打开第 {0} 条": "Open conversation {0}",
  "发现 {0} 个对话，识别出 {1} 种格式": "Found {0} conversations in {1} formats",
  "管理员已关闭导入功能。": "Importing is disabled by the administrator.", "单个文件不能超过当前上限 {0} MiB。": "Each file must be within the current {0} MiB limit.", "尚未选择文件": "No files selected", "已选择 {0} 个文件": "{0} files selected",
  "选择一组采用该格式的代表性源文件。验证成功后会保存新版本，旧版本继续可用。": "Choose representative sources for this format. Successful validation saves a new version while retaining earlier versions.", "选择对话源文件。已知格式会直接准备导入；陌生结构只需设置一次，以后会自动识别。": "Choose your conversation files. Known formats are ready to import. Map an unfamiliar structure once to recognize it in future imports.",
  "导入类型": "Import type", "已知与已学习格式": "Built-in and learned formats", ".cr 归档": ".cr archive", "恢复 Chat Reader 归档": "Restore a Chat Reader archive", "修复只接受 JSON / Markdown": "Repair accepts JSON / Markdown sources", "拖放文件到这里": "Drop files here", "或": "or",
  "选择 JSON / Markdown 文件": "Choose JSON / Markdown files", "选择 .cr 归档": "Choose a .cr archive", "支持单 JSON、单 Markdown、JSON + Markdown 及批量文件": "Supports JSON, Markdown, paired files and batches", ".cr 使用独立归档恢复流程": ".cr files use the archive restore flow", "当前单文件上限：": "Current limit per file: ", "无法读取导入限制。": "Import limits are unavailable.", "重试": "Retry", "正在读取导入限制…": "Reading import limits…",
  "正在识别格式": "Recognizing formats…", "分析并继续": "Analyze & continue", "检查归档": "Check archive", "恢复归档": "Restore archive", "系统中已有相同归档。默认会创建副本，不覆盖原记录。": "This archive already exists. By default, restoring creates a copy and preserves the original.", "打开已有对话": "Open existing conversation",
  "导入已完成": "Import complete", "已提交": "Imported ", "个对话，共": " conversations with ", "条消息。": " messages.", "导入提示": "Import notes", "已导入的对话": "Imported conversations", "已导入对话": "Imported conversation", "打开第": "Open conversation ", "条": "", "另有": "There are ", "个对话可在资料库中查看。": " more conversations in the library.", "查看导入的对话": "View imported conversations", "打开对话": "Open conversation", "打开第一条": "Open first conversation",
  ".cr 归档必须单独导入。": "Import one .cr archive at a time.", "仅支持 JSON、Markdown 或文本源文件。": "Choose JSON, Markdown or text source files.",
  "放弃未保存的映射？": "Discard unsaved mapping?", "字段映射尚未保存，导入会话和原始文件仍会保留。": "The field mapping has not been saved. The import session and source files will remain available.", "放弃更改": "Discard changes",
  "返回导入概览": "Back to import overview", "修复导入格式": "Repair import format", "设置新的导入格式": "Learn a new import format",
  "此设置会应用于当前结构的": "This mapping applies to all ", "个对话。": " conversations with this structure.",
  "示例对话": "Sample conversation", "切换当前结构的示例对话": "Choose a sample with this structure", "示例：": "Sample: ", "当前文件": "Current file",
  "规范字段映射": "Field mapping", "只保存结构、字段映射与角色字典，不保存示例正文。": "Only the structure, field mapping and role dictionary are learned. Sample content is not saved.",
  "保存为导入格式": "Format name", "验证会运行此格式的全部": "Validation checks all ", "个对话，不只检查示例。": " conversations using this format, including those outside the preview.",
  "正在验证": "Validating…", "验证映射": "Validate mapping", "正在保存": "Saving…", "保存新版本并继续": "Save new version & continue", "保存映射并继续": "Learn mapping & continue",
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

export type ImportErrorAction = "read" | "mutation" | "commit";

const importCodeCopy: Record<string, string> = {
  IMPORT_DISABLED: "管理员已关闭导入功能。",
  IMPORT_TOTAL_SIZE_LIMIT: "本批文件合计超过当前导入总容量限制，请分批导入。",
  FILE_TOO_LARGE: "所选文件超过当前单文件大小限制。",
  FILE_COUNT_LIMIT: "一次最多分析 500 个文件。",
  FILES_REQUIRED: "请选择至少一个 JSON 或 Markdown 文件。",
  SESSION_PERSISTENCE_FAILED: "导入分析的提交结果尚未确认。请先在任务中心核对是否已有本批分析，再决定是否重新上传。",
  SESSION_ANALYSIS_FAILED: "导入分析的提交结果尚未确认。请先在任务中心核对是否已有本批分析，再决定是否重新上传。",
  SOURCE_REPLACEMENT_FAILED: "替换文件未能保存，原文件仍保留，请稍后重试。",
  UPLOAD_STAGING_BUSY: "服务器正在处理另一个大文件，请稍后重试。",
  UPLOAD_MEMORY_PRESSURE: "服务器当前可用内存不足以安全分析所选文件。请减小单个文件或拆分批次后重试。",
  UPLOAD_QUEUE_FULL: "服务器的导入分析队列已满，请稍后重试。",
  UPLOAD_QUEUE_TIMEOUT: "服务器仍在分析其他大文件，本次尚未开始。请稍后重试。",
  SESSION_TOO_LARGE: "替换后的文件会超过本次导入总容量限制。",
  SESSION_STATE_INVALID: "当前导入状态已变化，请返回概览后重试。",
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
