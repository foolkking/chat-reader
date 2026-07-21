export type ResolvedLocale = "zh-CN" | "en-US";

const zh = {
  conversations: "对话", allConversations: "全部对话", search: "搜索", archived: "已归档", projects: "项目", importData: "导入数据",
  appearanceLanguage: "外观与语言", theme: "主题", language: "语言", readerWidth: "正文宽度", compact: "窄", standard: "标准", wide: "宽",
  light: "浅色", dark: "深色", system: "跟随系统", automatic: "自动", chinese: "简体中文", english: "English", close: "关闭", retry: "重试",
  connectionFailed: "无法连接服务器", connectionHint: "请检查网络连接后重试。", dialogueIndex: "对话索引", sectionToc: "章节目录", aroundCurrent: "围绕当前",
  allIndex: "全部索引", customRange: "自定义范围", jumpToNumber: "跳转到消息编号", jump: "跳转", currentNoSections: "当前对话无章节",
  showMessages: "显示 {shown} / {total} 条消息", loadingIndex: "正在加载对话索引", indexFailed: "对话索引加载失败", noMessages: "暂无对话消息",
  previous: "上一段", next: "下一段", indexRange: "索引范围", hideBefore: "隐藏前 N 条", hideAfter: "隐藏后 N 条", noPreview: "无预览",
  pinIndex: "固定对话索引", unpinIndex: "取消固定", openIndex: "展开对话索引", shareConversation: "分享对话", createShare: "创建分享链接",
  creating: "正在创建…", createdLinks: "已创建的链接", open: "打开", copyLink: "复制链接", save: "保存", revoke: "撤销", revoked: "已撤销",
  expiry: "有效期", sevenDays: "7 天", thirtyDays: "30 天", never: "永不过期", custom: "自定义", shareTheme: "分享主题", shareLanguage: "分享语言",
  readerDescription: "浏览、搜索和整理你的 ChatGPT 对话", restoreDescription: "恢复对话，或在确认后永久删除",
  serverFileNotice: "文件会在服务器中解析并保存到私有数据库。", openSidebar: "打开侧栏", closeSidebar: "收起侧栏", createProject: "创建项目",
  projectName: "项目名称", loadingProjects: "正在加载项目…", loadingConversations: "正在加载对话…", viewAll: "查看全部", dragHere: "拖动对话到这里",
  conversationHistory: "对话记录", readerNavigation: "阅读导航", locating: "定位中…", locateFailed: "未能定位，请重试。", dialogueTab: "对话", sectionsTab: "章节",
  more: "更多", you: "你", messageActions: "消息操作", select: "选择", edit: "编辑", closeEdit: "关闭编辑", split: "拆分", closeSplit: "关闭拆分",
  versions: "版本", hideVersions: "收起版本", splitting: "正在拆分…", splitMessage: "拆分消息", splitOffset: "拆分位置", splitReason: "拆分原因",
  manualSplit: "手动拆分", messageLengthHint: "消息共 {count} 个字符，拆分位置必须位于正文内部。", cancel: "取消", saving: "正在保存…",
  editReason: "编辑原因", versionHistory: "版本历史", loadingVersions: "正在加载版本…", noVersions: "暂无历史版本。", current: "当前版本",
  unknownTime: "时间未知", restore: "恢复", restoring: "正在恢复…", restoreVersionTitle: "恢复版本 {version}？",
  restoreVersionDescription: "系统会创建一个新的当前版本，并保留现有历史。", noDisplayableContent: "暂无可显示内容。",
  invalidSplitPosition: "拆分位置无效", splitPositionHint: "拆分位置必须在 1 到 {max} 之间。", loadPreviousBlocks: "加载前文内容",
  loadingPreviousBlocks: "正在加载前文内容…", unableSaveEdit: "无法保存编辑。", unableRestoreVersion: "无法恢复版本。",
  loadingFullContent: "正在加载完整内容…", longContentHint: "长内容将在进入阅读区域时自动加载", expandNow: "立即展开", expandLoaded: "展开已加载内容",
  expandNearby: "展开附近内容", expandNearbyHint: "完整展开前 2 轮、当前轮和后 10 轮", expandingNearby: "正在展开 {current} / {total}",
  expandNearbyFailed: "附近内容展开失败", collapseActions: "收起操作", share: "分享", export: "导出", navigationTitle: "阅读导航", mergeSelected: "合并所选",
  splitToNewConversation: "拆分为新对话", continueLoading: "继续滚动以加载后续内容", loadingMore: "正在加载更多内容…", loadingEarlier: "正在加载上文…",
  loadingLater: "正在加载下文…", retryEarlier: "重新加载上文", retryLater: "重新加载下文", loadingMessages: "正在加载消息", loadFailed: "消息加载失败",
  noConversationMessages: "这个对话还没有可阅读的消息。", conversationUnavailable: "对话暂时不可用", noConversationPayload: "服务器没有返回对话内容。",
  loadingInitialMessages: "正在获取首屏对话内容。", noMessagesTitle: "暂无消息",
} as const;

const en: Record<keyof typeof zh, string> = {
  conversations: "Conversations", allConversations: "All conversations", search: "Search", archived: "Archived", projects: "Projects", importData: "Import data",
  appearanceLanguage: "Appearance & language", theme: "Theme", language: "Language", readerWidth: "Reading width", compact: "Narrow", standard: "Standard", wide: "Wide",
  light: "Light", dark: "Dark", system: "System", automatic: "Automatic", chinese: "Simplified Chinese", english: "English", close: "Close", retry: "Retry",
  connectionFailed: "Unable to connect to the server", connectionHint: "Check your connection and try again.", dialogueIndex: "Dialogue index", sectionToc: "Section contents", aroundCurrent: "Around current",
  allIndex: "All messages", customRange: "Custom range", jumpToNumber: "Jump to message number", jump: "Jump", currentNoSections: "No sections in the current message",
  showMessages: "Showing {shown} / {total} messages", loadingIndex: "Loading dialogue index", indexFailed: "Failed to load dialogue index", noMessages: "No messages",
  previous: "Previous", next: "Next", indexRange: "Index range", hideBefore: "Hide before N", hideAfter: "Hide after N", noPreview: "No preview",
  pinIndex: "Pin dialogue index", unpinIndex: "Unpin index", openIndex: "Open dialogue index", shareConversation: "Share conversation", createShare: "Create share link",
  creating: "Creating…", createdLinks: "Created links", open: "Open", copyLink: "Copy link", save: "Save", revoke: "Revoke", revoked: "Revoked",
  expiry: "Expiry", sevenDays: "7 days", thirtyDays: "30 days", never: "Never", custom: "Custom", shareTheme: "Share theme", shareLanguage: "Share language",
  readerDescription: "Browse, search, and organize your ChatGPT conversations", restoreDescription: "Restore conversations or permanently delete them after confirmation",
  serverFileNotice: "Files are parsed on the server and stored in the private database.", openSidebar: "Open sidebar", closeSidebar: "Collapse sidebar", createProject: "Create project",
  projectName: "Project name", loadingProjects: "Loading projects…", loadingConversations: "Loading conversations…", viewAll: "View all", dragHere: "Drag conversations here",
  conversationHistory: "Conversation history", readerNavigation: "Reader navigation", locating: "Locating…", locateFailed: "Unable to locate the target. Try again.", dialogueTab: "Dialogue", sectionsTab: "Sections",
  more: "More", you: "You", messageActions: "Message actions", select: "Select", edit: "Edit", closeEdit: "Close edit", split: "Split", closeSplit: "Close split",
  versions: "Versions", hideVersions: "Hide versions", splitting: "Splitting…", splitMessage: "Split message", splitOffset: "Split position", splitReason: "Reason",
  manualSplit: "Manual split", messageLengthHint: "The message has {count} characters. The split position must be inside the content.", cancel: "Cancel", saving: "Saving…",
  editReason: "Edit reason", versionHistory: "Version history", loadingVersions: "Loading versions…", noVersions: "No versions found.", current: "Current",
  unknownTime: "Unknown time", restore: "Restore", restoring: "Restoring…", restoreVersionTitle: "Restore version {version}?",
  restoreVersionDescription: "A new current version will be created while preserving the existing history.", noDisplayableContent: "No displayable content.",
  invalidSplitPosition: "Invalid split position", splitPositionHint: "The split position must be between 1 and {max}.", loadPreviousBlocks: "Load previous content",
  loadingPreviousBlocks: "Loading previous content…", unableSaveEdit: "Unable to save edit.", unableRestoreVersion: "Unable to restore version.",
  loadingFullContent: "Loading the full content…", longContentHint: "Long content loads automatically as it enters the reading area", expandNow: "Expand now", expandLoaded: "Expand loaded content",
  expandNearby: "Expand nearby content", expandNearbyHint: "Fully expand the previous 2 turns, current turn, and next 10 turns", expandingNearby: "Expanding {current} / {total}",
  expandNearbyFailed: "Failed to expand nearby content", collapseActions: "Collapse actions", share: "Share", export: "Export", navigationTitle: "Reader navigation", mergeSelected: "Merge selected",
  splitToNewConversation: "Split into new conversation", continueLoading: "Keep scrolling to load the remaining content", loadingMore: "Loading more content…", loadingEarlier: "Loading earlier messages…",
  loadingLater: "Loading later messages…", retryEarlier: "Retry earlier messages", retryLater: "Retry later messages", loadingMessages: "Loading messages", loadFailed: "Failed to load messages",
  noConversationMessages: "This conversation has no readable messages yet.", conversationUnavailable: "Conversation unavailable", noConversationPayload: "The server returned no conversation content.",
  loadingInitialMessages: "Fetching the initial conversation content.", noMessagesTitle: "No messages",
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
