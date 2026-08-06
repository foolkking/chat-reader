export type BatchSelectionResult = {
  succeededIds: string[];
  failedIds: string[];
};

export async function runBatchSelection(
  ids: string[],
  operation: (id: string) => Promise<unknown>,
  concurrency = 4,
): Promise<BatchSelectionResult> {
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      const index = cursor;
      cursor += 1;
      const id = ids[index];
      try {
        await operation(id);
        succeededIds.push(id);
      } catch {
        failedIds.push(id);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
  return { succeededIds, failedIds };
}
