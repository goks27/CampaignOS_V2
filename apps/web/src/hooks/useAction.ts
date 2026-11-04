import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useToast } from "@/components/toast";

/** Mutation with toast feedback and cache invalidation in one line. */
export function useAction<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string); error?: string; invalidate?: QueryKey[]; onSuccess?: (r: TResult) => void } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      (opts.invalidate ?? []).forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(r) : opts.success);
      opts.onSuccess?.(r);
    },
    onError: (e) => toast.error(e, opts.error),
  });
}
