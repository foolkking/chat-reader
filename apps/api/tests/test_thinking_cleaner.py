from app.services.import_pipeline.thinking_cleaner import clean_thinking_summary


def test_assistant_opening_thinking_summary_removed() -> None:
    result = clean_thinking_summary(
        "assistant",
        "\u5206\u6790\u793e\u4ea4\u6280\u5de7\n\u601d\u8003\u4e86 13s\n\n\u6b63\u5f0f\u56de\u7b54\u5185\u5bb9\u3002",
    )

    assert result.removed is True
    assert result.text == "\u6b63\u5f0f\u56de\u7b54\u5185\u5bb9\u3002"
    assert "\u5206\u6790\u793e\u4ea4\u6280\u5de7" in (result.removed_text or "")


def test_assistant_search_trace_before_duration_removed() -> None:
    result = clean_thinking_summary(
        "assistant",
        """2026/6/19 23:22:36

> **\u63d0\u4f9b npm/pnpm \u5305\u7ba1\u7406\u5668\u6587\u6863\u89e3\u91ca**
>
> [npm | Home](https://www.npmjs.com/)
> package.json
> Dependencies - PNPM
>
> \u5df2\u601d\u8003 7s

\u4e0b\u9762\u6b63\u5f0f\u89e3\u91ca package.json\u3002""",
    )

    assert result.removed is True
    assert result.text == "\u4e0b\u9762\u6b63\u5f0f\u89e3\u91ca package.json\u3002"
    assert "npm | Home" in (result.removed_text or "")


def test_inline_duration_marker_keeps_answer_on_same_quoted_line() -> None:
    result = clean_thinking_summary(
        "assistant",
        """> **搜索当前 Node.js LTS 版本信息**
>
> [Node.js Releases](https://github.com/nodejs/node/releases)
>
> > > > 思考了 1m 2s 下面这条路线建议叫 TypeScript 全栈工程学习路线。

## 正式内容""",
    )

    assert result.removed is True
    assert result.text == "下面这条路线建议叫 TypeScript 全栈工程学习路线。\n\n## 正式内容"
    assert "思考了 1m 2s" in (result.removed_text or "")
    assert "下面这条路线" not in (result.removed_text or "")


def test_long_search_source_list_can_reach_marker_after_forty_lines() -> None:
    sources = "\n".join(
        f"> [Source {index}](https://example.com/{index}/{'x' * 100})" for index in range(45)
    )
    result = clean_thinking_summary(
        "assistant",
        f"> **搜索当前版本**\n{sources}\n> 思考了 1m 2s\n\n正式回答。",
    )

    assert result.removed is True
    assert result.text == "正式回答。"


def test_assistant_exporter_search_narration_before_duration_removed() -> None:
    result = clean_thinking_summary(
        "assistant",
        """我会先核对当前版本，避免给出过时路线。

制定学习计划

我正在考虑使用最新文档来定制学习计划。

查找 Node.js 和 React 最新版本和文档

Node.js Releases
React v19
https://nodejs.org/en

搜索当前 Node.js LTS 版本信息

思考了 1m 2s

下面这条路线建议叫 TypeScript 全栈工程学习路线。""",
    )

    assert result.removed is True
    assert result.text == "下面这条路线建议叫 TypeScript 全栈工程学习路线。"


def test_user_text_is_not_cleaned() -> None:
    text = "\u601d\u8003\u4e86 13s\n\u7528\u6237\u6b63\u6587\u3002"
    result = clean_thinking_summary("user", text)

    assert result.removed is False
    assert result.text == text


def test_middle_thinking_text_not_removed() -> None:
    text = "\u6b63\u5f0f\u56de\u7b54\u3002\n\u601d\u8003\u4e86 13s\n\u7ee7\u7eed\u56de\u7b54\u3002"
    result = clean_thinking_summary("assistant", text)

    assert result.removed is False
    assert result.text == text


def test_normal_assistant_answer_not_removed() -> None:
    text = "\u8fd9\u662f\u6b63\u5f0f\u56de\u7b54\u3002\n\n\u5b83\u63d0\u5230\u5982\u4f55\u601d\u8003\u95ee\u9898\u3002"
    result = clean_thinking_summary("assistant", text)

    assert result.removed is False
    assert result.text == text
