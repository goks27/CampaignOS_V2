import { Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui";
import { ADDABLE_KINDS, KIND_META, type NodeKind } from "./graph";
import { KIND_ICON } from "./nodes";

/** "+ Add": a logic step, an end, or a note. It lands in the middle of what you are looking at. Screens come from designs. */
export function AddMenu({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-9 items-center gap-1.5 rounded-box border border-line-strong bg-surface px-3 text-sm font-medium shadow-sm hover:border-text-2" aria-label="Add a step to the canvas" data-testid="add-step"><Plus className="size-4" />Add</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[280px]">
        <DropdownMenuLabel>Add a step</DropdownMenuLabel>
        {ADDABLE_KINDS.map((k) => {
          const Icon = KIND_ICON[k];
          return (
            <DropdownMenuItem key={k} onSelect={() => onAdd(k)}>
              <Icon /><span className="min-w-0 flex-1"><span className="block">{KIND_META[k].label}</span><span className="block truncate text-xs text-muted">{KIND_META[k].hint}</span></span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
