"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

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
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = ids.indexOf(String(event.active.id));
    const to = ids.indexOf(String(event.over.id));
    if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="mt-2 space-y-1">
          {conversations.map((conversation, index) => (
            <SortableMergeRow key={conversation.id} conversation={conversation} index={index} disabled={disabled} />
          ))}
        </div>
      </SortableContext>
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
      className={`grid grid-cols-[28px_24px_minmax(0,1fr)] items-center gap-2 rounded-lg border bg-white px-2 py-1.5 ${
        isDragging ? "border-[#10a37f] shadow-lg" : "border-transparent"
      }`}
    >
      <button
        type="button"
        disabled={disabled}
        className="flex h-7 w-7 touch-none items-center justify-center rounded-md text-[#9ca3af] hover:bg-[#f3f4f6] hover:text-[#374151] disabled:opacity-40"
        aria-label={`Reorder ${conversation.display_title || conversation.title}`}
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="text-xs font-semibold text-[#6b7280]">{index + 1}</span>
      <span className="truncate text-sm text-[#111827]">{conversation.display_title || conversation.title}</span>
    </div>
  );
}
