"use client";

import { EditorSelection } from "@codemirror/state";
import { useCodeMirror, type ReactCodeMirrorProps } from "@uiw/react-codemirror";
import { useState } from "react";

type SourceCodeEditorProps = Pick<ReactCodeMirrorProps,
  "height" | "extensions" | "theme" | "basicSetup" | "onCreateEditor" | "onUpdate" | "onChange" | "className"
> & { initialText: string };

export default function SourceCodeEditor({ initialText, className, theme = "light", ...options }: SourceCodeEditorProps) {
  const [initialState] = useState(() => ({
    json: { doc: initialText, selection: EditorSelection.single(0).toJSON() },
  }));
  // Never supply a controlled value, including during creation. The wrapper's
  // typing latch can otherwise replay that seed after an onCreateEditor edit.
  const { setContainer } = useCodeMirror({ ...options, theme, initialState });
  const themeClass = typeof theme === "string" ? `cm-theme-${theme}` : "cm-theme";
  return <div ref={setContainer} className={`${themeClass}${className ? ` ${className}` : ""}`} />;
}
