# Stage Roadmap

## Stage 00：项目骨架与基础设施

建立 monorepo、Next.js、FastAPI、PostgreSQL、Alembic、Docker Compose、测试框架。

## Stage 01：来源识别与 Raw Artifact

实现上传、source detector、raw artifact 保存、import preview 基础结构。

## Stage 02：ChatGPT Exporter JSON + Markdown 导入

实现 Exporter JSON parser、Markdown parser、aligner、thinking summary cleaner、canonicalizer。

## Stage 03：官方 conversations.json 导入

实现 official parser、mapping graph builder、primary path resolver、source_message_refs。

## Stage 04：Canonical 存储、搜索、目录

实现 block builder、heading builder、search builder、conversation/message APIs。

## Stage 05：基础阅读器前端

实现 sidebar、topbar、conversation reader、block renderer、import preview UI。

## Stage 06：Project / Pin / Reading Position

实现 Project、Pin、最近打开、继续阅读、阅读范围。

## Stage 07：性能优化与虚拟滚动

实现消息级虚拟滚动、block 懒加载、高度缓存、批量 blocks。

## Stage 08：编辑、版本、Undo

实现 message edit、delete/restore、version history、split/merge、UndoToast。

## Stage 09：分享与导出

实现 share token、Markdown/HTML/Canonical JSON 导出、Project 导出。

## Stage 10：安全、测试、发布硬化

完善安全、错误状态、性能测试、大文件测试、文档、发布准备。
