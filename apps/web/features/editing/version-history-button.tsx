"use client";

export function VersionHistoryButton({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="min-h-10 rounded-full border border-[#d1d5db] bg-white/90 px-3 text-xs font-medium text-[#374151] hover:bg-[#f7f7f8]"
    >
      {isOpen ? "Hide versions" : "Versions"}
    </button>
  );
}
