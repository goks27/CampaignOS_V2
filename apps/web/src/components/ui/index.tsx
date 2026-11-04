/* Small component set in the spirit of shadcn/ui, restyled to DESIGN.md. */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- Button
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white hover:bg-accent/90",
        secondary: "border border-line-strong bg-surface text-text hover:bg-hover",
        ghost: "text-text-2 hover:bg-hover hover:text-text",
        danger: "border border-line-strong bg-surface text-st-red hover:bg-st-red/10",
        link: "text-accent hover:underline px-0 h-auto",
      },
      size: { sm: "h-7 px-2.5 text-xs", md: "h-8 px-3", icon: "h-7 w-7 p-0" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
        {asChild ? children : (
          <>
            {loading && <Loader2 className="animate-spin" />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

// ---------------------------------------------------------------- Inputs
const fieldBase =
  "w-full rounded-ctl border border-line-strong bg-surface px-2.5 text-sm text-text placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(fieldBase, "h-8", className)} {...p} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => <textarea ref={ref} className={cn(fieldBase, "min-h-[72px] py-1.5 leading-5", className)} {...p} />,
);
Textarea.displayName = "Textarea";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  placeholder?: string;
}
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, options, placeholder, ...p }, ref) => (
  <select ref={ref} className={cn(fieldBase, "h-8 pr-7 appearance-none", className)}
    style={{ backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center", backgroundSize: "12px", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%238A8C95' stroke-width='1.6'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")" }}
    {...p}>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map((o) => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
));
Select.displayName = "Select";

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-xs font-medium text-text-2", className)} {...p} />;
}

export function Field({ label, error, hint, children, className }: {
  label: string; error?: string; hint?: string; children: React.ReactNode; className?: string;
}) {
  const autoId = React.useId();
  // Link the label (and hint/error) to the control so screen readers announce them.
  const child = React.isValidElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>(children) ? children : null;
  const id = child?.props.id ?? autoId;
  const msgId = `${id}-msg`;
  const control = child
    ? React.cloneElement(child, { id, "aria-describedby": error || hint ? msgId : undefined, "aria-invalid": error ? true : undefined })
    : children;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={child ? id : undefined}>{label}</Label>
      {control}
      {error ? <p id={msgId} className="text-xs text-st-red">{error}</p> : hint ? <p id={msgId} className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, className, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm text-text cursor-pointer select-none", className)}>
      <input type="checkbox" className="size-3.5 rounded border-line-strong accent-[rgb(var(--accent))]" {...p} />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------- Dialog
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ title, description, children, className, footer }: {
  title: string; description?: string; children: React.ReactNode; className?: string; footer?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/30" />
      <DialogPrimitive.Content
        className={cn("fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 rounded-box border border-line bg-surface shadow-overlay focus:outline-none max-h-[80vh] flex flex-col", className)}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div>
            <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="mt-0.5 text-xs text-muted">{description}</DialogPrimitive.Description>
              : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close"><X /></Button>
          </DialogPrimitive.Close>
        </div>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Right-hand drawer (560px) per DESIGN.md. */
export function Drawer({ open, onOpenChange, title, subtitle, actions, children, width = 560 }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; subtitle?: React.ReactNode;
  actions?: React.ReactNode; children: React.ReactNode; width?: number;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <DialogPrimitive.Content
          style={{ width: `min(${width}px, 100vw)` }}
          className="fixed right-0 top-0 z-50 flex h-full flex-col border-l border-line bg-surface shadow-overlay focus:outline-none data-[state=open]:animate-[drawer-in_200ms_ease-out]">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-lg font-semibold leading-tight truncate">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description asChild><div className="mt-0.5 text-xs text-muted">{subtitle}</div></DialogPrimitive.Description>
            </div>
            <div className="flex items-center gap-1.5">
              {actions}
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close"><X /></Button>
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------- Menus & popovers
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export function DropdownMenuContent({ children, align = "end", className }: { children: React.ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content align={align} sideOffset={4}
        className={cn("z-50 min-w-[180px] rounded-box border border-line bg-surface p-1 shadow-overlay", className)}>
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}
export function DropdownMenuItem({ className, danger, ...p }: DropdownPrimitive.DropdownMenuItemProps & { danger?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn("flex cursor-pointer items-center gap-2 rounded-ctl px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-hover [&_svg]:size-4 [&_svg]:text-muted",
        danger && "text-st-red", className)}
      {...p} />
  );
}
export const DropdownMenuSeparator = () => <DropdownPrimitive.Separator className="my-1 h-px bg-line" />;
export const DropdownMenuLabel = ({ children }: { children: React.ReactNode }) => (
  <DropdownPrimitive.Label className="px-2 py-1 text-xs text-muted">{children}</DropdownPrimitive.Label>
);

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ children, className, align = "end" }: { children: React.ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={6}
        className={cn("z-50 w-72 rounded-box border border-line bg-surface p-3 shadow-overlay focus:outline-none", className)}>
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

// ---------------------------------------------------------------- Tabs (URL-friendly, controlled)
export function Tabs<T extends string>({ value, onChange, tabs, className }: {
  value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[]; className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex gap-1 overflow-x-auto border-b border-line", className)}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cn("relative -mb-px whitespace-nowrap px-2.5 py-2 text-sm text-text-2 hover:text-text",
            value === t.value && "text-text font-medium after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent")}>
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-muted num">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Misc
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted", className)} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-side px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-box border border-line bg-surface", className)} {...p} />;
}
