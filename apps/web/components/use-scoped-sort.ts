"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { changeConversationOrder, getConversationOrder, getProjects, updateProject } from "../lib/api";
import type { ConversationSortMode, SortDirection } from "../lib/types";
import { usePreferences } from "./preferences-provider";
import { authenticationGeneration } from "../lib/offline-access";

export type SortScope = "all" | "unclassified" | "project_default" | `project:${string}`;

export function useScopedSort(scope: SortScope = "all", { orderVisible = true }: { orderVisible?: boolean } = {}) {
  const preferences = usePreferences();
  const client = useQueryClient();
  const generation = authenticationGeneration();
  const assertAccount = () => {
    if (generation !== authenticationGeneration()) throw new Error("Account changed. Reopen this directory.");
  };
  const projectId = scope.startsWith("project:") ? scope.slice(8) : null;
  const projects = useQuery({
    queryKey: ["projects", preferences.projectSortMode, preferences.projectSortDirection],
    queryFn: ({ signal }) => getProjects({ sort: preferences.projectSortMode, direction: preferences.projectSortDirection }, signal),
    enabled: !!projectId || scope === "project_default",
  });
  const project = projects.data?.find(item => item.id === projectId);
  const sort = projectId ? project?.conversation_sort ?? preferences.navigationSort.project_default
    : preferences.navigationSort[scope as "all" | "unclassified" | "project_default"];
  const orderScope = projectId ? { scope: "project" as const, project_id: projectId }
    : { scope: scope === "unclassified" ? "unclassified" as const : "all" as const };
  const order = useQuery({
    queryKey: ["conversation-order", scope], queryFn: ({ signal }) => getConversationOrder(orderScope, signal),
    // Automatic/closed directories need no full-scope ordering snapshot.
    // initialize() explicitly obtains a fresh snapshot before the first write.
    enabled: scope !== "project_default" && sort.mode === "custom" && orderVisible, staleTime: 0,
  });
  const initialize = async (rebuild = false) => {
    assertAccount();
    if (scope === "project_default") return;
    const snapshot = await order.refetch();
    assertAccount();
    if (snapshot.error || !snapshot.data) throw new Error("Order unavailable");
    if (!snapshot.data.initialized || rebuild) await changeConversationOrder({
      ...orderScope, expected_version: snapshot.data.version, initialize_from: sort, rebuild,
    });
    await client.invalidateQueries({ queryKey: ["conversation-order", scope] });
  };
  const setSort = async (mode: ConversationSortMode, direction: SortDirection) => {
    assertAccount();
    if (mode === "custom" && sort.mode !== "custom") await initialize();
    if (mode === "custom" && scope === "project_default") {
      const fresh = await projects.refetch();
      assertAccount();
      if (fresh.error || !fresh.data) throw new Error("Project defaults unavailable.");
      for (const item of fresh.data.filter(item => !item.is_default && !item.conversation_sort)) {
        const target = { scope: "project" as const, project_id: item.id };
        const snapshot = await getConversationOrder(target);
        assertAccount();
        if (!snapshot.initialized) await changeConversationOrder({
          ...target, expected_version: snapshot.version, initialize_from: sort,
        });
      }
    }
    assertAccount();
    if (projectId) {
      if (!project) throw new Error("Refresh projects before changing sorting.");
      await updateProject(projectId, { conversation_sort: { mode, direction }, expected_sort_revision: project.sort_revision ?? 1 });
      await client.invalidateQueries({ queryKey: ["projects"] });
    } else await preferences.setNavigationSort({ ...preferences.navigationSort, [scope]: { mode, direction } });
  };
  const inherit = async () => {
    assertAccount();
    if (!projectId || !project) return;
    if (preferences.navigationSort.project_default.mode === "custom") await initialize();
    assertAccount();
    await updateProject(projectId, { conversation_sort: null, expected_sort_revision: project.sort_revision ?? 1 });
    await client.invalidateQueries({ queryKey: ["projects"] });
  };
  const place = async (id: string, before: string | null, after: string | null, expectedVersion: string | undefined) => {
    assertAccount();
    if (!expectedVersion || order.isError) throw new Error("Order unavailable. Refresh before moving.");
    await changeConversationOrder({ ...orderScope, expected_version: expectedVersion, conversation_id: id,
      before_id: sort.direction === "asc" ? before : after, after_id: sort.direction === "asc" ? after : before });
    await Promise.all([
      client.invalidateQueries({ queryKey: ["conversation-order"] }),
      client.invalidateQueries({ queryKey: ["conversations"] }),
      client.invalidateQueries({ queryKey: ["project-conversations"] }),
    ]);
  };
  return { conversationSortMode: sort.mode, conversationSortDirection: sort.direction, setSort, inherit, place,
    orderVersion: order.isError || order.isFetching ? undefined : order.data?.version,
    ready: !projectId || !!project,
    rebuild: () => initialize(true), inherited: !!projectId && !project?.conversation_sort };
}
