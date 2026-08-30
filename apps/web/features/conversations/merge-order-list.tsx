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

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = ids.indexOf(String(event.active.id));
    const to = ids.indexOf(String(event.over.id));
    if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))} onDragCancel={() => setActiveId(null)} onDragEnd={(event) => { setActiveId(null); handleDragEnd(event); }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="mt-2 space-y-1">
          {conversations.map((conversation, index) => (
            <SortableMergeRow key={conversation.id} conversation={conversation} index={index} disabled={disabled} />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>{activeId ? <div className="reader-drag-overlay px-4 py-3 text-sm font-semibold text-primary" aria-hidden="true">{conversations.find((item) => item.id === activeId)?.display_title || conversations.find((item) => item.id === activeId)?.title}</div> : null}</DragOverlay>
    </DndContext>
  );
}

function SortableMergeRow({ conversation, index, disabled }: { conversation: MergeConversation; index: number; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: conversation.id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-state={isDragging ? "dragging" : undefined}
      className={`reader-interactive-row grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-lg border bg-surface px-3 py-2 ${isDragging ? "cursor-grabbing" : disabled ? "" : "cursor-grab"}`}
      {...attributes}
      {...listeners}
    >
      <span className="text-xs font-semibold text-secondary">{index + 1}</span>
      <span className="truncate text-sm text-primary">{conversation.display_title || conversation.title}</span>
    </div>
  );
}
