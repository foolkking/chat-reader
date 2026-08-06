# 2026-07-27 至 2026-07-29 执行与发布档案

| 字段 | 内容 |
| --- | --- |
| 事实基线 | commit `e752e9ddf25595c3f373977a1803956354ca71b0` |
| 执行起点 | commit `175fae3914ad65a9682fa13303b64064507d498c` |
| 最后记录 | 2026-07-29 离线 TOC 补丁与 King Chrome 复验 |
| 状态 | 历史封存；表示对应发布批次，不替代当前重新验证 |

本目录记录改造实施、完整轮次 Reader、63 项复审、离线增量、视觉体验、批量管理、Markdown 排版、批注阅读、测试和生产发布证据。

| 文件 | 内容 |
| --- | --- |
| [IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md) | 文件级任务、补充审计和功能收尾 |
| [TEST_RESULTS.md](TEST_RESULTS.md) | lint/typecheck/pytest/build/Playwright/Chrome 结果 |
| [DEVIATIONS.md](DEVIATIONS.md) | 代码结构、需求覆盖和执行环境事件 |
| [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) | 备份、上传哈希、镜像、migration、smoke 和回退 |
| `screenshots/` | 本地合成数据的桌面/移动验收截图 |

## 最终兼容与数据结论

- 新增 PostgreSQL migrations：`20260728_0015`（Markdown 间距偏好）和 `20260728_0016`（正文字号）。
- Dexie 保持 version 1、stores 不变；现有本地数据不整体重建。
- Offline package 写 v2 conversation delta，浏览器继续读取 v1/v2。
- `.cr` 与 Share token/URL 语义保持兼容；两者与 offline package 是不同协议。
- 发布过程未执行 `docker compose down -v`，没有把 `.env`、storage、日志或私密正文上传为源码。

## 使用限制

- 测试数字、镜像 ID、备份文件名、像素偏差和线上数量都是时间点证据。
- 旧日志中“无 migration”等描述只适用于其所在发布阶段；以 `DEPLOYMENT_CHECKLIST.md` 后续分节为最终批次事实。
- 新发布应创建新的记录，不覆盖本档案来伪装连续验证。
