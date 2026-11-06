export type ReaderBlockLease = {
  targetId: string;
  release: () => void;
};

type AcquireBlockLease = (blockIndex: number) => Promise<ReaderBlockLease | null>;

const blockMountRegistry = new Map<string, AcquireBlockLease>();
const blockRevealRegistry = new Map<string, () => void>();
export function registerReaderBlockReveal(messageId: string, blockIndex: number, reveal: () => void): () => void {
  const key = `block-${messageId}-${blockIndex}`;
  blockRevealRegistry.set(key, reveal);
  return () => { if (blockRevealRegistry.get(key) === reveal) blockRevealRegistry.delete(key); };
}
export function revealReaderBlock(targetId: string): void {
  blockRevealRegistry.get(targetId)?.();
}
export const READER_WINDOW_LAYOUT_EVENT = "chat-reader:reader-window-layout";
let pendingWindowLayoutFrame: number | null = null;

export function notifyReaderWindowLayoutChanged(): void {
  if (pendingWindowLayoutFrame !== null) return;
  pendingWindowLayoutFrame = window.requestAnimationFrame(() => {
    pendingWindowLayoutFrame = null;
    window.dispatchEvent(new Event(READER_WINDOW_LAYOUT_EVENT));
  });
}

export function notifyReaderMessageLayoutChanged(messageId: string): void {
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent(READER_WINDOW_LAYOUT_EVENT, { detail: { messageId } }));
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
    revealReaderBlock(targetId);
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
