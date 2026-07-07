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
      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
    >
      {props.isPinned ? "Unpin" : "Pin"}
    </button>
  );
}
