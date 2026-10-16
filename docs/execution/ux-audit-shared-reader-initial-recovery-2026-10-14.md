# UX audit — public Share reader initial recovery

2026-10-14（本地日期）。本批检查访客打开公开只读 Share 后的首屏读取、
正文窗口恢复和阅读位置保留。没有登录、没有启动服务、没有使用线上页面；
用户明确要求本批不做本地或浏览器验证，后续由用户自行验收。

## Scope & evidence

范围是 `apps/web/features/sharing/share-readonly-reader.tsx` 的 Share 元数据
读取、首个完整轮次正文窗口读取和 `localStorage` 阅读位置恢复。分享创建、
管理写入、公共 token 权限服务端语义不在本批范围。

修复前源文件 SHA-256：
`72AD6FBBE23E7D76A6E5433C53C91E8D2D3DEC9BFD7F5C3C80FBF0BB99CAA578`

## Findings

### ERR-SHARED-READER-01 · 首个正文窗口失败后显示空正文

| | |
|---|---|
| **Dimension** | Error prevention & recovery / System status |
| **Severity** | High |
| **Confidence** | Observed (source) |
| **Effort** | S |
| **Location** | `apps/web/features/sharing/share-readonly-reader.tsx` |

**Evidence.** `initialWindowQuery` 读取首个完整轮次，但 JSX 只处理
`isLoading`，没有处理 `isError`。失败后 `messages` 仍为空，页面保留标题和
导航框架，却不显示正文、错误原因或 `refetch()` 入口。

**Why it matters.** 访客会看到像“分享没有内容”的空页面，无法区分暂时读取失败、
失效分享或真实空内容，也不能在当前页面恢复。

### ERR-SHARED-READER-02 · Share 元数据错误显示底层文本且没有恢复入口

**Evidence.** 非密码保护的 `shareQuery.isError` 分支直接把
`shareQuery.error.message` 交给 `ShareState`，没有局部重试。API 的错误文本不是
稳定的访客文案，可能包含状态或路径信息。

**Why it matters.** 短暂代理／网络错误会把访客困在错误页；永久失效和暂时不可用
也无法被清晰区分。

### DATA-SHARED-READER-03 · 任何 Share 读取错误都会删除阅读位置

**Evidence.** `shareQuery.isError` 一旦成立，现有 effect 立即删除
`localStorage` 中的 Share 阅读位置，没有区分连接错误、服务器错误和密码保护
的 401。

**Why it matters.** 访客在重试或输入密码后可能从头开始，直接破坏阅读位置恢复；
这也把短暂读取故障扩大成持久的本机状态丢失。

## Implemented narrow repair

首个正文窗口失败现在显示明确的只读恢复状态，并只重试当前 GET；元数据错误
改为稳定的用户文案，只有可重试的网络／超时／服务器失败显示重试按钮。永久
访问失败仍不提供无意义的自动恢复。

阅读位置只在明确的永久客户端访问失败时清除；连接失败、408、429、5xx 和
密码保护 401 均保留位置，供恢复或解锁成功后继续定位。

没有加入轮询、写操作重试、token 改动、缓存格式变化或新的服务器请求。

## Verification boundary

按用户要求，本批不运行服务、浏览器、脚本测试、lint、typecheck、build、CI
或部署。后续人工验收应覆盖：首屏正文读取失败、重试恢复、404/403 等永久
失败、密码解锁后位置仍在，以及网络失败重试不清除位置。
