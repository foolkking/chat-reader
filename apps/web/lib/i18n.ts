export type ResolvedLocale = "zh-CN" | "en-US";

const zh = {
  conversations: "对话", allConversations: "全部对话", unclassified: "未归类", noUnclassified: "暂无未归类对话", search: "搜索", recent: "最近", archived: "已归档", projects: "项目", importData: "导入数据", quickNavigation: "快捷导航", offlineLibrary: "离线资料库", backOnline: "返回在线版",
  appearanceLanguage: "外观与语言", settings: "设置", tasks: "任务", openTasks: "打开任务", appearanceReading: "外观与阅读", dataImport: "数据与导入", importFormats: "导入格式", importFormatsDescription: "管理内置与已学习的 JSON / Markdown 格式", accountSecurity: "账户与安全", settingsHint: "管理偏好、数据和账户安全", backgroundTasks: "后台任务", backgroundTasksHint: "导入、合并、删除、导出和内容审查会在后台继续运行", noActiveTasks: "当前没有正在处理的任务", theme: "主题", language: "语言", readerWidth: "正文宽度", compact: "窄", standard: "标准", wide: "宽", readerDensity: "Markdown 间距", densityCompact: "紧凑", densityComfortable: "舒适", densityLarge: "宽松", readerFontSize: "正文字号", resetFontSize: "恢复 17px", decreaseFontSize: "减小字号", increaseFontSize: "增大字号", moreSettings: "更多设置", collapseSettings: "收起设置",
  readerStartup: "默认阅读模式", defaultReading: "默认阅读", defaultFocus: "默认专注", annotationDefaultPosition: "批注默认位置", floating: "浮窗", docked: "固定左栏", back: "返回", readerTools: "阅读工具", offlineGuide: "下载后可在断网时继续阅读此对话。", prepareOffline: "准备离线阅读", dismiss: "暂不显示",
  light: "浅色", dark: "深色", system: "跟随系统", automatic: "自动", chinese: "简体中文", english: "English", close: "关闭", retry: "重试",
  connectionFailed: "无法连接服务器", connectionHint: "请检查网络连接后重试。", dialogueIndex: "对话索引", sectionToc: "章节目录", aroundCurrent: "围绕当前",
  allIndex: "全部索引", customRange: "自定义范围", jumpToNumber: "跳转到消息编号", jump: "跳转", currentNoSections: "当前对话无章节",
  showMessages: "显示 {shown} / {total} 条消息", loadingIndex: "正在加载对话索引", indexFailed: "对话索引加载失败", noMessages: "暂无对话消息",
  previous: "上一段", next: "下一段", indexRange: "索引范围", hideBefore: "隐藏前 N 条", hideAfter: "隐藏后 N 条", noPreview: "无预览",
  pinIndex: "固定对话索引", unpinIndex: "取消固定", openIndex: "展开对话索引", shareConversation: "分享对话", createShare: "创建分享链接",
  creating: "正在创建…", createdLinks: "已创建的链接", open: "打开", copyLink: "复制链接", save: "保存", revoke: "撤销", revoked: "已撤销",
  expiry: "有效期", sevenDays: "7 天", thirtyDays: "30 天", never: "永不过期", custom: "自定义", shareTheme: "分享主题", shareLanguage: "分享语言",
  readerDescription: "浏览、搜索和整理你的 ChatGPT 对话", restoreDescription: "恢复已归档对话",
  serverFileNotice: "文件会在服务器中解析并保存到私有数据库。", openSidebar: "打开侧栏", closeSidebar: "收起侧栏", createProject: "创建项目",
  projectName: "项目名称", loadingProjects: "正在加载项目…", loadingConversations: "正在加载对话…", viewAll: "查看全部", dragHere: "拖动对话到这里",
  conversationHistory: "对话记录", readerNavigation: "阅读导航", locating: "正在定位引用文字…", locateChanged: "原文已变化，已定位到所在消息。", locateFailed: "未能定位引用文字，请重试。", dialogueTab: "对话", sectionsTab: "章节", annotations: "批注", focusMode: "专注模式", exitFocusMode: "退出专注模式", onlineReader: "在线阅读", onlineReaderNeedsNetwork: "联网后可进入在线阅读",
  more: "更多", you: "你", messageActions: "消息操作", select: "选择", edit: "编辑", closeEdit: "关闭编辑", split: "拆分", closeSplit: "关闭拆分",
  versions: "版本", hideVersions: "收起版本", splitting: "正在拆分…", splitMessage: "拆分消息", splitOffset: "拆分位置", splitReason: "拆分原因",
  manualSplit: "手动拆分", messageLengthHint: "消息共 {count} 个字符，拆分位置必须位于正文内部。", cancel: "取消", saving: "正在保存…",
  editReason: "编辑原因", versionHistory: "版本历史", loadingVersions: "正在加载版本…", noVersions: "暂无历史版本。", current: "当前版本",
  unknownTime: "时间未知", restore: "恢复", restoring: "正在恢复…", restoreVersionTitle: "恢复版本 {version}？",
  restoreVersionDescription: "系统会创建一个新的当前版本，并保留现有历史。", noDisplayableContent: "暂无可显示内容。",
  invalidSplitPosition: "拆分位置无效", splitPositionHint: "拆分位置必须在 1 到 {max} 之间。", unableSaveEdit: "无法保存编辑。", unableRestoreVersion: "无法恢复版本。",
  collapseActions: "收起操作", share: "分享", export: "导出", navigationTitle: "阅读导航", mergeSelected: "合并所选",
  splitToNewConversation: "拆分为新对话", loadingEarlier: "正在加载上文…",
  loadingLater: "正在加载下文…", retryEarlier: "重新加载上文", retryLater: "重新加载下文", loadingMessages: "正在加载消息", loadFailed: "消息加载失败",
  noConversationMessages: "这个对话还没有可阅读的消息。", conversationUnavailable: "对话暂时不可用", noConversationPayload: "服务器没有返回对话内容。",
  loadingInitialMessages: "正在获取首屏对话内容。", noMessagesTitle: "暂无消息",
  dataArchive: "数据归档",
  dataArchiveDescription: "备份、恢复与数据维护",
  noiseRuleLibrary: "噪声规则库",
  noiseRuleLibraryDescription: "查看、管理并扫描噪声处理规则",
  skillManagement: "Skill 管理",
  skillManagementDescription: "管理导出与格式转换时使用的 Skill",
  moreReadingSettings: "\u66f4\u591a\u9605\u8bfb\u8bbe\u7f6e",
} as const;

const en: Record<keyof typeof zh, string> = {
  conversations: "Conversations", allConversations: "All conversations", unclassified: "Unclassified", noUnclassified: "No unclassified conversations", search: "Search", recent: "Recent", archived: "Archived", projects: "Projects", importData: "Import data", quickNavigation: "Quick navigation", offlineLibrary: "Offline library", backOnline: "Back online",
  appearanceLanguage: "Appearance & language", settings: "Settings", tasks: "Tasks", openTasks: "Open tasks", appearanceReading: "Appearance & reading", dataImport: "Data & import", importFormats: "Import formats", importFormatsDescription: "Manage built-in and learned JSON / Markdown formats", accountSecurity: "Account & security", settingsHint: "Manage preferences, data, and account security", backgroundTasks: "Background tasks", backgroundTasksHint: "Imports, merges, deletes, exports and cleanup reviews continue here", noActiveTasks: "No tasks are currently running", theme: "Theme", language: "Language", readerWidth: "Reading width", compact: "Narrow", standard: "Standard", wide: "Wide", readerDensity: "Markdown spacing", densityCompact: "Compact", densityComfortable: "Comfortable", densityLarge: "Spacious", readerFontSize: "Text size", resetFontSize: "Reset to 17px", decreaseFontSize: "Decrease text size", increaseFontSize: "Increase text size", moreSettings: "More settings", collapseSettings: "Collapse settings",
  readerStartup: "Reader default mode", defaultReading: "Reading", defaultFocus: "Focus", annotationDefaultPosition: "Default annotation position", floating: "Floating", docked: "Docked left", back: "Back", readerTools: "Reader tools", offlineGuide: "Download this conversation to keep reading without a connection.", prepareOffline: "Prepare offline reading", dismiss: "Not now",
  light: "Light", dark: "Dark", system: "System", automatic: "Automatic", chinese: "Simplified Chinese", english: "English", close: "Close", retry: "Retry",
  connectionFailed: "Unable to connect to the server", connectionHint: "Check your connection and try again.", dialogueIndex: "Dialogue index", sectionToc: "Section contents", aroundCurrent: "Around current",
  allIndex: "All messages", customRange: "Custom range", jumpToNumber: "Jump to message number", jump: "Jump", currentNoSections: "No sections in the current message",
  showMessages: "Showing {shown} / {total} messages", loadingIndex: "Loading dialogue index", indexFailed: "Failed to load dialogue index", noMessages: "No messages",
  previous: "Previous", next: "Next", indexRange: "Index range", hideBefore: "Hide before N", hideAfter: "Hide after N", noPreview: "No preview",
  pinIndex: "Pin dialogue index", unpinIndex: "Unpin index", openIndex: "Open dialogue index", shareConversation: "Share conversation", createShare: "Create share link",
  creating: "Creating…", createdLinks: "Created links", open: "Open", copyLink: "Copy link", save: "Save", revoke: "Revoke", revoked: "Revoked",
  expiry: "Expiry", sevenDays: "7 days", thirtyDays: "30 days", never: "Never", custom: "Custom", shareTheme: "Share theme", shareLanguage: "Share language",
  readerDescription: "Browse, search, and organize your ChatGPT conversations", restoreDescription: "Restore archived conversations",
  serverFileNotice: "Files are parsed on the server and stored in the private database.", openSidebar: "Open sidebar", closeSidebar: "Collapse sidebar", createProject: "Create project",
  projectName: "Project name", loadingProjects: "Loading projects…", loadingConversations: "Loading conversations…", viewAll: "View all", dragHere: "Drag conversations here",
  conversationHistory: "Conversation history", readerNavigation: "Reader navigation", locating: "Locating the referenced text…", locateChanged: "The original text changed; showing its message.", locateFailed: "The referenced text could not be located.", dialogueTab: "Dialogue", sectionsTab: "Sections", annotations: "Annotations", focusMode: "Focus mode", exitFocusMode: "Exit focus mode", onlineReader: "Online reader", onlineReaderNeedsNetwork: "Connect to open the online reader",
  more: "More", you: "You", messageActions: "Message actions", select: "Select", edit: "Edit", closeEdit: "Close edit", split: "Split", closeSplit: "Close split",
  versions: "Versions", hideVersions: "Hide versions", splitting: "Splitting…", splitMessage: "Split message", splitOffset: "Split position", splitReason: "Reason",
  manualSplit: "Manual split", messageLengthHint: "The message has {count} characters. The split position must be inside the content.", cancel: "Cancel", saving: "Saving…",
  editReason: "Edit reason", versionHistory: "Version history", loadingVersions: "Loading versions…", noVersions: "No versions found.", current: "Current",
  unknownTime: "Unknown time", restore: "Restore", restoring: "Restoring…", restoreVersionTitle: "Restore version {version}?",
  restoreVersionDescription: "A new current version will be created while preserving the existing history.", noDisplayableContent: "No displayable content.",
  invalidSplitPosition: "Invalid split position", splitPositionHint: "The split position must be between 1 and {max}.", unableSaveEdit: "Unable to save edit.", unableRestoreVersion: "Unable to restore version.",
  collapseActions: "Collapse actions", share: "Share", export: "Export", navigationTitle: "Reader navigation", mergeSelected: "Merge selected",
  splitToNewConversation: "Split into new conversation", loadingEarlier: "Loading earlier messages…",
  loadingLater: "Loading later messages…", retryEarlier: "Retry earlier messages", retryLater: "Retry later messages", loadingMessages: "Loading messages", loadFailed: "Failed to load messages",
  noConversationMessages: "This conversation has no readable messages yet.", conversationUnavailable: "Conversation unavailable", noConversationPayload: "The server returned no conversation content.",
  loadingInitialMessages: "Fetching the initial conversation content.", noMessagesTitle: "No messages",
  dataArchive: "Data archive",
  dataArchiveDescription: "Backups, restore and data maintenance",
  noiseRuleLibrary: "Noise rule library",
  noiseRuleLibraryDescription: "Review, manage and scan cleanup rules",
  skillManagement: "Skill management",
  skillManagementDescription: "Manage Skills used for export and format rescue",
  moreReadingSettings: "More reading settings",
};

const dictionaries = { "zh-CN": zh, "en-US": en } as const;
export type TranslationKey = keyof typeof zh;

export function translate(locale: ResolvedLocale, key: TranslationKey, values?: Record<string, string | number>): string {
  let message: string = dictionaries[locale][key];
  for (const [name, value] of Object.entries(values ?? {})) message = message.replaceAll(`{${name}}`, String(value));
  return message;
}

export function resolveLocale(mode: "auto" | ResolvedLocale, acceptedLanguage = ""): ResolvedLocale {
  if (mode !== "auto") return mode;
  return acceptedLanguage.toLowerCase().includes("zh") ? "zh-CN" : "en-US";
}
