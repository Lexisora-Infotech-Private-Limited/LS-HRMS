import { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Loading } from '@/components/ui';

const DevicesAdminPage = lazy(() => import('./pages/DevicesAdminPage'));

/** tracker domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  {
    path: 'devices',
    element: guard(
      'devices.manage',
      <Suspense fallback={<Loading />}>
        <DevicesAdminPage />
      </Suspense>,
    ),
  },
];
