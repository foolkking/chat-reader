# UX audit — Inline attachment asset state — 2026-10-15

## 范围与判断

本次只检查本地源码中的 Reader 内联附件组，不启动服务、不登录、不运行浏览器或自动化验证。
来源置信度为高：问题由当前组件的 state key、effect 依赖和渲染计划直接推导。

## 编辑前证据

涉及文件编辑前 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `apps/web/features/attachments/attachment-block.tsx` | `ea1bb77f60562a27c3aa90207c8db7c8b20d67e5` |
| `apps/web/features/attachments/attachment-inline-layout.tsx` | `8cda8469e730d813381e0949f4dda7efea88ebba` |
| `apps/web/features/attachments/attachment-viewer.tsx` | `468406579d582d3049612fb472764e3713f33e53` |

源码证据：

- `AttachmentInlineGroup` 的 `runtimeByItem`、runtime callback 和
  `JustifiedImageGallery` 的比例表都只用 `itemKey` 作为本地状态边界。
- `buildAttachmentRenderPlan` 会把 `runtime.status === "failed"` 映射为
  `file-row`/`preview-failed`。同一 item 位置替换为新资产后，旧失败状态可能继续
  把新资产显示成文件行，直到另一次运行时事件覆盖它。
- 图片比例也按 `itemKey` 保存；同一位置换成不同尺寸图片时，旧比例会继续参与
  justified gallery 排版，造成新图片行高和宽度不准确。
- `InlineTextPreview` 的读取 effect 只依赖 `attachment.content_url`。同一附件
  ID 资产被替换但内容 URL 保持不变时，effect 不会重新清空并读取，组件可能保留
  旧文本和展开状态。

## 本地实现与边界

已在共享附件预览 registry 中加入统一资产身份函数，使用附件 ID 加
`asset_object.sha256`，无哈希时回退 `content_url`。内联组的运行时失败状态和
gallery 比例表现在同时记录该身份；资产身份变化时，旧状态不再参与新的渲染计划
或排版。`InlineTextPreview` 将资产身份加入读取 effect，并在新读取开始时清空
旧文本和展开状态。复杂附件查看器也复用同一身份函数，避免局部身份规则分叉。

不增加网络请求、不扩大预加载范围、不改变 API、权限、缓存、布局算法或资源上限。

编辑后 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `apps/web/features/attachments/attachment-block.tsx` | `32379bc1a97fa9df8c0b6d73c02ac9d535a4883a` |
| `apps/web/features/attachments/attachment-inline-layout.tsx` | `264987e099727eb13b7ae7603721d1d1c2c2fa63` |
| `apps/web/features/attachments/attachment-viewer.tsx` | `d8e02ea4c01403f7b9b41c6a4697630c7603185b` |
| `apps/web/features/attachments/complex-attachment-viewer.tsx` | `b81524beee6d86ba2c27603091c09b030f7ac176` |
| `apps/web/features/attachments/preview-adapter-registry.ts` | `65316192a15f9d8092fa583f86ca9827c0673226` |

## 验收边界

应满足：

1. 同一 `itemKey` 换资产后，旧失败状态不再决定新附件的内联呈现。
2. 同一位置换不同尺寸图片后，旧比例不再用于新资产的 gallery 排版。
3. 同一 URL 但资产哈希变化时，短文本预览清空并重新读取，且展开状态重置。
4. 现有请求、懒加载、取消、下载、查看器打开和资源预算保持不变。

本报告记录的是本地源码修复；按用户当前要求，本次不执行运行时验证、CI 或部署。
