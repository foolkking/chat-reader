// The view may contain just a window. A new sort is not an edit to the user's list.
export function selectionOrder(previous: Iterable<string>, requested: Set<string>, visible: readonly string[]) {
  const ordered = new Set<string>();
  for (const id of previous) if (requested.has(id)) ordered.add(id);
  for (const id of visible) if (requested.has(id)) ordered.add(id);
  return [...ordered];
}
