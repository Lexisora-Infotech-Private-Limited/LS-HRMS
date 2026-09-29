import { QueryClient, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useToast } from './toast';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});

/**
 * Mutation helper used across screens: runs `fn`, shows a success toast, invalidates
 * the given query keys, and toasts errors.
 */
export function useAction<TArgs, TResult = unknown>(
  fn: (args: TArgs) => Promise<TResult>,
  opts: { success?: string | ((r: TResult, args: TArgs) => string); invalidate?: QueryKey[]; onSuccess?: (r: TResult, args: TArgs) => void } = {},
) {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, args) => {
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: k });
      const msg = typeof opts.success === 'function' ? opts.success(r, args) : opts.success;
      if (msg) toast(msg);
      opts.onSuccess?.(r, args);
    },
    onError: (e) => toastError(e),
  });
}
