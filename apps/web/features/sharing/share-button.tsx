"use client";

export function ShareButton({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="reader-share-button"
      onClick={onToggle}
      className={`inline-flex h-9 items-center rounded-xl border px-3 text-xs font-medium shadow-sm ${
        isOpen
          ? "border-[#111827] bg-[#111827] text-white"
          : "border-[#d1d5db] bg-white text-[#374151] hover:bg-[#f7f7f8]"
      }`}
    >
      {isOpen ? "Sharing" : "Share"}
    </button>
  );
}
