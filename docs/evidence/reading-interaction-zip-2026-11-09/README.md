# 阅读交互 / 缺附件 ZIP — 本地合成证据

- `reader-browser.json`：13组浏览器结果，含6组完整帧间隔/滚动位置数组、
  实际Markdown流水线解析次数、布局统计、长任务、挂载块数与MathML检查。
  没有删除异常帧；性能门槛仍为P95≤34ms、单长任务≤150ms、总长任务≤250ms。
- 四张PNG只包含本轮生成的公式/标题/标签，不含用户对话、凭据或生产资料。
- `verification.json`：本地检查结果与相关源码SHA；不是Git提交或部署回执。
- `build-source-snapshot.json`：最终完整Next隔离构建输入的工作树源码SHA。
  临时生成的Next类型入口与类型缓存不作为手写源码；没有更改应用/依赖版本。
- `viewer-browser.json`：独立12组移动Viewer/文件面板Escape、触摸及焦点恢复检查。

浏览器依赖真实组件和明确的合成网络/偏好适配器；并非完整Next应用验收。
assistant-ui原语以ReactMarkdown源透传适配，Next动态加载以React lazy替代；
公式配置、KaTeX、虚拟化、选择复制及Reader工具仍来自实际源码。
早期跨盘输出/依赖的构建失败保留在实施记录，最终同源码同依赖的完整隔离构建已通过；
PWA、原64条CI轨迹、Linux内存与生产验收仍待后续单独授权。
没有提交、CI、部署或用户ZIP自动回放。详细边界见
[实施记录](../../execution/READING_INTERACTION_ZIP_FIXES_2026-11-09.md)。
# 后续审查补测

`reader-audit-browser.json` 为完整375/800/1440×两语言×两主题交互
及原六性能/真实计时共19组补测，原始逐帧数据完整保留。
`audit-verification.json` 记录接线修正后的源码摘要及本地检查。
新增截图 `header-375-en-US-dark.png`、`focus-search-800-zh-CN-light.png`
补充原配对组合未覆盖的状态；只含合成内容。
正式CI已新增必跑脚本与证据上传，不代替原14门禁/64+12+4轨迹。
以下原实施数据不覆盖、不重写为CI或生产验收。

## 正式 CI 首轮（未验收）

`ci-attempt-1.json` 记录精确提交、50分钟首次回查时间、官方制品摘要、
通过/失败计数及选择器修正边界。不包含用户正文或认证资料。
此轮失败，未生成发布镜像；新增19组通过不能替代未执行的后续门禁。
