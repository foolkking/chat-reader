"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setConversationGlobalPin, setProjectConversationPin } from "../../lib/api";

type PinButtonProps =
  | {
      scope: "global";
      conversationId: string;
      isPinned: boolean;
    }
  | {
      scope: "project";
      projectId: string;
      conversationId: string;
      isPinned: boolean;
    };

export function PinButton(props: PinButtonProps) {
  const queryClient = useQueryClient();
  const mutation = useMutation<unknown>({
    mutationFn: () =>
      props.scope === "global"
        ? setConversationGlobalPin(props.conversationId, !props.isPinned)
        : setProjectConversationPin(props.projectId, props.conversationId, !props.isPinned),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project-conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["conversation", props.conversationId] });
    },
  });

  return (
    <button
      type="button"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      className="inline-flex h-9 items-center rounded-xl border border-[#d1d5db] bg-white px-3 text-xs font-medium text-[#374151] shadow-sm hover:bg-[#f7f7f8] disabled:cursor-not-allowed disabled:text-[#9ca3af]"
    >
      {props.isPinned ? "Unpin" : "Pin"}
    </button>
  );
}
