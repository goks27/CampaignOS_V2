import * as React from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { errorMessage } from "@/lib/utils";

type Toast = { id: number; kind: "success" | "error"; text: string };
type Ctx = { success: (t: string) => void; error: (e: unknown, prefix?: string) => void };

const ToastCtx = React.createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const remove = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));
  const push = React.useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, kind, text }]);
    setTimeout(() => remove(id), kind === "error" ? 8000 : 3500);
  }, []);
  const value = React.useMemo<Ctx>(() => ({
    success: (t) => push("success", t),
    error: (e, prefix) => push("error", prefix ? `${prefix}: ${friendly(e)}` : friendly(e)),
  }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="flex items-start gap-2 rounded-box border border-line bg-surface px-3 py-2.5 text-sm shadow-overlay animate-[toast-in_150ms_ease-out]">
            {t.kind === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-st-green" /> : <AlertCircle className="mt-0.5 size-4 shrink-0 text-st-red" />}
            <p className="flex-1 text-text">{t.text}</p>
            <button onClick={() => remove(t.id)} aria-label="Dismiss" className="text-muted hover:text-text"><X className="size-4" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = React.useContext(ToastCtx);
  if (!c) throw new Error("useToast outside provider");
  return c;
}

/** Turns Postgres / Supabase errors into sentences that say what failed and how to fix it. */
export function friendly(e: unknown): string {
  const msg = errorMessage(e);
  if (msg.startsWith("DUPLICATE_REVIEW")) return "This exact content was already reviewed. Use “Run again” to repeat it.";
  if (/row-level security/i.test(msg)) return "You don’t have permission to do that. Ask a Manager or Admin.";
  if (/JWT expired|Invalid Refresh Token/i.test(msg)) return "Your session expired. Sign in again.";
  if (/Failed to fetch/i.test(msg)) return "Could not reach the server. Check your connection.";
  if (/mime type .* is not supported/i.test(msg)) return "That file type isn’t allowed here.";
  if (/exceeded the maximum allowed size|Payload too large/i.test(msg)) return "That file is too large.";
  return msg;
}
