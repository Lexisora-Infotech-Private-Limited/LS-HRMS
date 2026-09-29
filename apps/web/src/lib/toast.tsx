import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { HttpError } from './api';

type Toast = { id: number; text: string; error?: boolean };
type ToastApi = {
  /** Brief confirmation, bottom-center, 2.6 s (wireframe toast). */
  toast: (text: string) => void;
  /** Show an error (accepts an HttpError / Error / string). */
  toastError: (e: unknown) => void;
};

const Ctx = createContext<ToastApi | null>(null);
let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = seq++;
    setItems((x) => [...x.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.error ? 4500 : 2600);
  }, []);
  const api: ToastApi = {
    toast: useCallback((text: string) => push({ text }), [push]),
    toastError: useCallback(
      (e: unknown) => push({ text: e instanceof HttpError || e instanceof Error ? e.message : String(e), error: true }),
      [push],
    ),
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.error ? ' error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}
