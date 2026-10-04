import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Loading } from '@/components/ui';

const LedgerPage = lazy(() => import('./pages/LedgerPage'));
const InvoicesPage = lazy(() => import('./pages/InvoicesPage'));
const PurchasesPage = lazy(() => import('./pages/PurchasesPage'));
const FilingPage = lazy(() => import('./pages/FilingPage'));

const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

/**
 * finance domain routes (relative to the app shell). Collected automatically by App.tsx.
 * Ledger: admins (`ledger.manage`) see every tab; HR holding only `ledger.hrvoucher` sees the
 * HR vouchers tab (D23).
 */
export const routes: RouteObject[] = [
  { path: 'ledger', element: guard(['ledger.manage', 'ledger.hrvoucher'], s(<LedgerPage />)) },
  { path: 'invoices', element: guard('invoices.manage', s(<InvoicesPage />)) },
  { path: 'purchases', element: guard('purchases.manage', s(<PurchasesPage />)) },
  { path: 'filing', element: guard('filing.manage', s(<FilingPage />)) },
];
