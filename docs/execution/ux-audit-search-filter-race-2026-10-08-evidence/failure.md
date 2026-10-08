# Synthetic CI failure excerpt

Source: `b18aced88997845f40ed825c24406994624c1387`.
Run: `37754402200`; Web job: `113235275013`.
Gate: `source-editor-mutation`; test:
`search pagination resets with filters while date controls retain focus`.

The test fills From with `2099-01-01`, confirms its focus, then fills To with
`2020-01-01`. The invalid-range alert was not found within the assertion timeout.
The original artifact's `error-context.md` includes this page snapshot excerpt:

```yaml
- text: From
- textbox "From"
- text: To
- textbox "To": 2020-01-01
- text: No results. Clear filters or try another query.
```

Only the relevant synthetic excerpt is retained; unrelated sidebar/test fixture
data and the copied test source are omitted. This is recorded failed browser
evidence, not a new local reproduction or a screenshot-based layout review.
