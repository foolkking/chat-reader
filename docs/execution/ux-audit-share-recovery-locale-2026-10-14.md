# UX audit — public Share recovery language

2026-10-14（本地日期）。本轮检查公开 Share 阅读器最近加入的首屏恢复状态，
没有启动本地服务、登录或访问线上页面。用户要求本批不做本地验证，后续由用户自行验收。

## 修复前证据

目标文件 `apps/web/features/sharing/share-readonly-reader.tsx` 在本轮修改前的
SHA-256：

`2B1E890F3CF588E5E1A0B14081E5B8BBAA30270F40B89E67F4D8DEF0B99B1729`

源码中的 Share 元数据错误、首个正文窗口错误及 ShareState 重试控件使用固定中文；
重试控件则无论访客使用哪种语言都同时显示中英文。页面正常读取后会将
`document.documentElement.lang` 设置为 Share 自身的 `locale`。因此英文分享在首屏
或正文读取失败时会出现中文／混合语言恢复状态，与该分享的正常阅读语言不一致。

## 修复范围

新增的 Share 加载和恢复状态在已有 Share payload 时采用分享配置的语言；payload
尚未读取时采用访客当前界面语言。重试动作仍只重新读取当前 GET；不改变权限、
token、密码解锁、阅读位置、API 请求和重试资格。

## 本地实现

`ShareReadonlyReader` 现在优先使用已读取 Share 的 `locale`，此前退回
`PreferencesProvider` 的访客 `resolvedLocale`。分享元数据和首个正文窗口的加载、
失败及重试中状态都使用这一语言，按钮不再同时显示双语。只修改文案选择，没有
增加请求或轮询。

随后发现并一并修复了同一页面的密码保护页、顶部只读标识和移动导航
accessible name 的固定语言；解锁失败现在按 429 与普通失败给出稳定提示，不再
直接展示底层异常文本。追加修复前源文件 SHA-256：

`BEC6337F1625067303175AD6500ABC74B0D996880D2EC86B193C715539667D4D`

## 验证边界

没有运行浏览器、脚本测试、lint、typecheck、build、CI 或部署。源码修复后的
中文／英文视觉与键盘验收留给用户执行。
