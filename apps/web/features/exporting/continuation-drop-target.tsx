"use client";
import { useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";

export function ContinuationDropTarget({ children, member, zh, disabled, onFiles }: {
  children: ReactNode; member: "current" | "index"; zh: boolean; disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const filename = member === "current" ? "current.md" : "index.json";
  return <div data-testid="continuation-drop-target" className="relative min-h-[50vh] min-w-0"
    onDragEnter={event => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault(); depth.current += 1;
      if (!disabled) setDragging(true);
    }}
    onDragOver={event => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    }}
    onDragLeave={event => {
      if (!event.dataTransfer.types.includes("Files")) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    }}
    onDrop={event => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false);
      if (!disabled) onFiles(Array.from(event.dataTransfer.files));
    }}>
    {children}
    {dragging ? <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-[var(--accent)] bg-page/95 p-6" role="status">
      <div className="space-y-3 text-center"><Upload className="mx-auto h-7 w-7 text-accent" />
        <p className="text-base font-semibold">{zh ? "松开即可更新" : "Drop to update"}</p>
        <p className="text-sm text-secondary">{filename} {zh ? "或" : "or"} .context.zip</p>
      </div>
    </div> : null}
  </div>;
}
