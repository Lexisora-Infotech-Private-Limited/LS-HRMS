import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Placeholder } from '@/components/Placeholder';

/** tracker domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'devices', element: guard('devices.manage', <Placeholder title='Tracker devices' screen='devices' />) },
];
