"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { usePreferences } from "../../components/preferences-provider";

type MergeConversation = { id: string; title: string; display_title: string };

export function MergeOrderList({
  conversations,
  disabled,
  onReorder,
}: {
  conversations: MergeConversation[];
  disabled: boolean;
  onReorder: (ids: string[]) => void;
}) {
  const ids = conversations.map((conversation) => conversation.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeSize, setActiveSize] = useState<{ width: number; height: number } | null>(null);

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = ids.indexOf(String(event.active.id));
    const to = ids.indexOf(String(event.over.id));
    if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(event: DragStartEvent) => { setActiveId(String(event.active.id)); const initial = event.active.rect.current.initial; setActiveSize(initial ? { width: initial.width, height: initial.height } : null); }} onDragCancel={() => { setActiveId(null); setActiveSize(null); }} onDragEnd={(event) => { setActiveId(null); setActiveSize(null); handleDragEnd(event); }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="mt-2 space-y-1">
          {conversations.map((conversation, index) => (
            <SortableMergeRow key={conversation.id} conversation={conversation} index={index} disabled={disabled} last={index === conversations.length - 1} onMove={(delta) => onReorder(arrayMove(ids, index, index + delta))} />
          ))}
        </div>
      </SortableContext>
      <DragOverlay adjustScale={false}>{activeId ? <div className="reader-drag-overlay px-4 py-3 text-sm font-semibold text-primary" style={activeSize ? { width: activeSize.width, height: activeSize.height } : undefined} aria-hidden="true">{conversations.find((item) => item.id === activeId)?.display_title || conversations.find((item) => item.id === activeId)?.title}</div> : null}</DragOverlay>
    </DndContext>
  );
}

function SortableMergeRow({ conversation, index, disabled, last, onMove }: { conversation: MergeConversation; index: number; disabled: boolean; last: boolean; onMove: (delta: number) => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const title = conversation.display_title || conversation.title;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: conversation.id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-state={isDragging ? "dragging" : undefined}
      className="reader-interactive-row grid grid-cols-[44px_minmax(0,1fr)_88px] items-center gap-1 rounded-lg border border-ui bg-surface px-1 py-1"
    >
      <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled} aria-label={zh ? `拖动排序：${title}` : `Drag to reorder: ${title}`} className="flex h-11 w-11 cursor-grab items-center justify-center rounded text-secondary active:cursor-grabbing disabled:opacity-40"><GripVertical size={16} /></button>
      <span className="min-w-0 truncate text-sm text-primary" title={title} data-merge-order-title={title}><span className="mr-2 text-xs text-secondary" aria-hidden="true">{index + 1}</span>{title}</span>
      <div className="flex"><button type="button" disabled={disabled || index === 0} onClick={() => onMove(-1)} aria-label={zh ? `上移：${title}` : `Move up: ${title}`} className="flex h-11 w-11 items-center justify-center rounded text-secondary hover:bg-subtle disabled:opacity-30"><ArrowUp size={16} /></button><button type="button" disabled={disabled || last} onClick={() => onMove(1)} aria-label={zh ? `下移：${title}` : `Move down: ${title}`} className="flex h-11 w-11 items-center justify-center rounded text-secondary hover:bg-subtle disabled:opacity-30"><ArrowDown size={16} /></button></div>
    </div>
  );
}
