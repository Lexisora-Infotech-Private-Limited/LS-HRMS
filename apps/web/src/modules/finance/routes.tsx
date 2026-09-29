import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Placeholder } from '@/components/Placeholder';

/** finance domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'ledger', element: guard('ledger.manage', <Placeholder title='Ledger' screen='ledger' />) },
  { path: 'invoices', element: guard('invoices.manage', <Placeholder title='GST invoices' screen='invoices' />) },
  { path: 'purchases', element: guard('purchases.manage', <Placeholder title='Purchases & input GST' screen='purchases' />) },
  { path: 'filing', element: guard('filing.manage', <Placeholder title='Filing cabinet' screen='filing' />) },
];
