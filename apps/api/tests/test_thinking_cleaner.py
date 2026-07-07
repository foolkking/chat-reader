from app.services.import_pipeline.thinking_cleaner import clean_thinking_summary


def test_assistant_opening_thinking_summary_removed() -> None:
    result = clean_thinking_summary(
        "assistant",
        """> 考虑提出的生活建议
> 思考了 13s

当然可以。""",
    )

    assert result.removed is True
    assert "思考了 13s" not in result.text
    assert result.text == "当然可以。"


def test_user_text_not_cleaned() -> None:
    text = "思考了 13s\n这是用户原文"
    result = clean_thinking_summary("user", text)

    assert result.removed is False
    assert result.text == text


def test_middle_thinking_text_not_removed() -> None:
    text = "正式回答。\n思考了 13s\n继续回答。"
    result = clean_thinking_summary("assistant", text)

    assert result.removed is False
    assert result.text == text


def test_normal_assistant_answer_not_removed() -> None:
    text = "考虑到你的目标，我们可以先从练习倾听开始。"
    result = clean_thinking_summary("assistant", text)

    assert result.removed is False
    assert result.text == text
