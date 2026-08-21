type RenderedBlockEntry = {
  messageId: string;
  blockIndex: number;
  element: HTMLElement;
  markdown: string;
};

type RegistryListener = () => void;

const renderedBlocks = new Map<string, Set<HTMLElement>>();
const renderedBlockMarkdown = new WeakMap<HTMLElement, string>();
const listeners = new Set<RegistryListener>();

function blockKey(messageId: string, blockIndex: number): string {
  return `${messageId}:${blockIndex}`;
}

function notifyListeners() {
  for (const listener of listeners) listener();
}

export function registerRenderedBlock(messageId: string, blockIndex: number, element: HTMLElement, markdown = ""): () => void {
  const key = blockKey(messageId, blockIndex);
  const entries = renderedBlocks.get(key) ?? new Set<HTMLElement>();
  entries.add(element);
  renderedBlockMarkdown.set(element, markdown);
  renderedBlocks.set(key, entries);
  notifyListeners();

  return () => {
    const current = renderedBlocks.get(key);
    if (!current?.delete(element)) return;
    renderedBlockMarkdown.delete(element);
    if (current.size === 0) renderedBlocks.delete(key);
    notifyListeners();
  };
}

export function getRenderedBlockMarkdown(element: HTMLElement): string | null {
  return renderedBlockMarkdown.get(element) ?? null;
}

export function subscribeRenderedBlocks(listener: RegistryListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRenderedBlockElements(messageId: string, blockIndex: number): HTMLElement[] {
  const entries = renderedBlocks.get(blockKey(messageId, blockIndex));
  if (!entries) return [];
  return Array.from(entries).filter((element) => element.isConnected);
}

export function getRenderedBlocks(): RenderedBlockEntry[] {
  const result: RenderedBlockEntry[] = [];
  for (const [key, elements] of renderedBlocks) {
    const separator = key.lastIndexOf(":");
    const messageId = key.slice(0, separator);
    const blockIndex = Number.parseInt(key.slice(separator + 1), 10);
    if (!messageId || !Number.isFinite(blockIndex)) continue;
    for (const element of elements) {
      if (element.isConnected) result.push({ messageId, blockIndex, element, markdown: renderedBlockMarkdown.get(element) ?? "" });
    }
  }
  return result;
}
