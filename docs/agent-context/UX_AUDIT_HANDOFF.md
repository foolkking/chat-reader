# UX 调研交接

最后核验日期：2026-07-26

本文件只定义下一阶段调研范围和可用事实，不包含体验结论。

## 调研对象

- 在线资料管理壳：全量对话、Project、归档、选择模式、导入、任务、偏好。
- 在线长对话 Reader：header/actions、正文渲染、对话 TOC、章节 TOC、搜索、批注、Share、Export、编辑/版本。
- 公开 Share Reader：需要合成或授权测试 token。
- `/library`：壳准备、catalog、下载/删除、空间提示、离线 Reader、在线/离线互跳。
- 桌面 1440x900 与移动 390x844；真实设备离线/PWA 安装另做专项。

## 已确认身份与入口

- 本地资料拥有者：无登录，直接进入 `/`；所有管理 API 当前无账号 ACL。
- Share 访客：有效 token URL，只读且受 include/allow_export 限制。
- 可用生产入口：`https://chat.king.2bd.net`。不得在证据中保存真实 token、ID、标题或正文。

## 可验证流程

进入系统、打开/切换对话、Project/归档选择、全局搜索、长文本滚动、两个 TOC、偏好、批注管理 UI、Share/Export 配置 UI、资料库管理、在线/离线 Reader 互跳、移动 Bottom Sheets、无效 conversation 错误状态。完整流程见 `USER_FLOWS.md`。

需要隔离测试数据才能安全完整验证：实际导入、消息编辑/恢复、拆分/合并、删除、Share token 访客、批注冲突、离线 outbox 同步、artifact 下载。

## 页面和证据

- 页面地图：`docs/system/PAGE_AND_ROUTE_MAP.md`。
- 21 张已脱敏现状截图：`docs/evidence/README.md`。
- 已覆盖首页、导入、偏好、Project、归档/选择、搜索空态、在线 Reader、批注/管理、Share panel、library/离线 Reader、移动首页/侧栏/Reader/actions/TOC、offline 页和 invalid reader。
- 未截图：`/recent` 有数据态、有效 `/share/[token]`、实际导出面板、编辑/版本对话框、任务失败态、PWA quota/staging failure。

## 当前无法完整核验

- 账号/会员/admin 页面：当前系统不包含，不应假设只是缺权限。
- 登录前/后差异：当前无登录状态，截图身份统一写“本地资料拥有者”。
- 有效 Share 页面：本次遵守 token 隐私边界。
- 离线失败注入：本次未切断生产网络或清理浏览器存储。
- 写操作失败/回滚 UX：本次未修改生产业务数据。
- TLS/代理管理页：生产配置仓库外且不属于产品 UI。

## 必须避免的错误假设

- 不把 Chat Reader 当作可发送消息的聊天客户端。
- 不虚构普通用户/会员/管理员角色。
- 不把 `/offline` 当作 `/library` SW 的 fallback；library navigation fallback 是缓存的 `/library`。
- 不把“当前屏幕未出现表格/公式/图片”写成 renderer 不支持；先看渲染代码和带对应数据的样本。
- 不把生产快照中的数量、大小、标题或窗口挂载数当成固定规格。
- 不把存在 API/组件直接等同于生产端到端已验证。
- 不把未发现入口等同于功能不存在；`/recent` 是已知示例。
- 不在 UX 截图中暴露私有聊天或 token。

## 后续优先覆盖（仅范围）

1. 逐页建立桌面/移动截图矩阵并补足未截图页面。
2. 使用隔离数据验证导入到 Reader 的完整流程。
3. 使用超长对话核验窗口加载、TOC、搜索、批注目标定位和阅读位置。
4. 使用测试 Share token 核验访客 scope/include/export。
5. 在可清理的浏览器 profile 中核验安装、离线冷启动、升级、quota/staging failure。
6. 对所有可调 pane、Bottom Sheet、loading/empty/error/conflict 状态做页面级记录。

调研结论应另建文档；若发现事实变化，先按 `DOCUMENT_MAINTENANCE.md` 更新事实基线和证据索引。

