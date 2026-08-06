export type ReaderBlockLease = {
  targetId: string;
  release: () => void;
};

type AcquireBlockLease = (blockIndex: number) => Promise<ReaderBlockLease | null>;

const blockMountRegistry = new Map<string, AcquireBlockLease>();
export const READER_WINDOW_LAYOUT_EVENT = "chat-reader:reader-window-layout";

export function notifyReaderWindowLayoutChanged(): void {
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event(READER_WINDOW_LAYOUT_EVENT));
  });
}

export function registerVirtualMessage(
  messageId: string,
  acquireBlockLease: AcquireBlockLease,
): () => void {
  blockMountRegistry.set(messageId, acquireBlockLease);
  return () => {
    if (blockMountRegistry.get(messageId) === acquireBlockLease) {
      blockMountRegistry.delete(messageId);
    }
  };
}

export async function acquireReaderBlockLease(
  messageId: string,
  blockIndex: number,
  tokenIsCurrent: () => boolean = () => true,
  timeoutMs = 3000,
): Promise<ReaderBlockLease | null> {
  const targetId = `block-${messageId}-${blockIndex}`;
  const deadline = window.performance.now() + timeoutMs;

  while (tokenIsCurrent() && window.performance.now() < deadline) {
    const acquire = blockMountRegistry.get(messageId);
    if (acquire) {
      const lease = await acquire(blockIndex);
      if (!lease) {
        await nextFrame();
        continue;
      }
      if (!tokenIsCurrent()) {
        lease.release();
        return null;
      }
      if (document.getElementById(targetId)) return lease;
      lease.release();
    } else {
      const target = document.getElementById(targetId);
      if (target && !target.closest('[data-virtualized-block-list="true"]')) {
        return { targetId, release: () => undefined };
      }
    }
    await nextFrame();
  }
  return null;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
