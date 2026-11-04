import * as React from "react";

/** J/K or arrow keys move the selection, Enter opens. Ignored while typing in a field. */
export function useListKeys<T>(items: T[], onOpen: (item: T) => void, extra?: Record<string, (item: T) => void>) {
  const [index, setIndex] = React.useState(-1); // nothing highlighted until the keyboard is used
  React.useEffect(() => {
    if (index >= items.length) setIndex(items.length - 1);
  }, [items.length, index]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!items.length) return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
      else if (e.key === "Enter") { const it = items[index]; if (it) { e.preventDefault(); onOpen(it); } }
      else if (extra && extra[e.key]) { const it = items[index]; if (it) { e.preventDefault(); extra[e.key]!(it); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, index, onOpen, extra]);
  return { index, setIndex };
}
