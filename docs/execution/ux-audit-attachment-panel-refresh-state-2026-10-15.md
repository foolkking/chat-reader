# 附件文件面板刷新状态审查（2026-10-15）

## 范围与边界

本批次只审查 Web 附件文件面板在列表刷新、改名、移除和后台数据更新后的本地界面状态。
不启动服务、不登录、不运行浏览器或自动化验证，不修改 API、数据库、缓存策略、上传协议、
附件查看器的网络读取和资源预算。

## 编辑前源码证据

本记录在首次编辑产品源码前建立。编辑前 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `apps/web/features/attachments/conversation-files-panel.tsx` | `8c6035f58add4812a384ae77cfa731a797eb40b77167685ad17126b3541a6efd` |
| `apps/web/features/attachments/offline-conversation-files-panel.tsx` | `1f32b15e79c42a16db9db4d948b4b1c002e71ec652b86e3f20b57273b1bb6173` |
| `apps/web/features/attachments/attachment-viewer.tsx` | `7369d6a3a9717400d95733087067f205c750e9388dbc8acbad0a1c3c66198ef8` |

源码信心：高。证据来自当前渲染和状态代码，不代表真实浏览器运行时结果。

### 发现

`ConversationFilesPanel` 将 `preview`、`details` 保存为 `AttachmentRead` 快照：

```tsx
const [preview, setPreview] = useState<AttachmentRead | null>(null);
const [details, setDetails] = useState<AttachmentRead | null>(null);
```

列表行继续把当次渲染的整条对象写入状态。刷新查询、改名成功后的失效刷新、
上传完成刷新或其他窗口改变列表后，打开的对话框仍使用旧快照，直到用户关闭并重新打开。
当附件已从列表移除时，旧详情/预览也没有由列表状态主动关闭。

同一面板的 `selected` 只在显式 detach 成功时删除 ID。后台刷新或其他操作移除附件后，
选择集合可能包含不可见 ID；工具栏仍显示选择数量，但 `selectedFiles()` 已无法返回对应文件，
使下载、插入和移除按钮出现无效操作。

`OfflineConversationFilesPanel` 使用查询结果直接渲染，当前没有批量选择或详情快照；
本批不改变它，避免扩大范围。

## 修复决策

1. 将在线面板的预览和详情状态改为附件 ID，渲染时从最新查询结果解析对象。
2. 对查询刷新后的选择集合按当前附件 ID 裁剪。
3. 若已打开的附件从最新列表消失，关闭对应的预览/详情；若仍存在，则自动使用最新对象。
4. 不在刷新期间强制关闭仍存在的对话框，不改变查看器自身会话、网络请求和资源限制。

## 验证边界

本批次按用户要求只做源码审查与局部实现。未启动本地服务、未登录、未使用浏览器、
未运行测试、构建、CI 或部署。实现后的源码哈希和差异检查将在修复后补记。

## 实现后记录

在线附件文件面板现在只保存 `previewId` 和 `detailsId`，每次渲染都从最新查询结果
解析当前 `AttachmentRead`。列表刷新后，已打开的预览/详情会自动显示最新名称、状态、
大小和引用信息；如果附件已不在列表中，对应表面会关闭。

选择集合也会在查询结果变化后按当前附件 ID 裁剪，避免外部移除或刷新后工具栏保留
不可执行的选择。离线文件面板没有批量选择和详情快照，本批未改动。

实现后源码 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `apps/web/features/attachments/conversation-files-panel.tsx` | `e6271291348bbf2e137bdaac561ede6b1e2904910409606314338e5f62ae60b8` |

本哈希包含本工作树中该文件此前已有的附件上传恢复改动；本批新增的状态收敛仅限
预览/详情按 ID 解析和选择裁剪。未改变附件请求、缓存、查看器会话、权限、上传协议
或资源预算。
