/** "all" is the default for type/project, but NOT for archive status. */
export function activeSearchFilter(key: string, value: string): boolean {
  return key === "status_scope" ? Boolean(value && value !== "active") : Boolean(value && value !== "all");
}
