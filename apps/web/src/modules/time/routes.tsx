import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Placeholder } from '@/components/Placeholder';
import { Loading } from '@/components/ui';

const AttendancePage = lazy(() => import('./pages/AttendancePage'));
const TimesheetPage = lazy(() => import('./pages/TimesheetPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const ShiftsPage = lazy(() => import('./pages/MastersPages').then((m) => ({ default: m.ShiftsPage })));
const LocationsPage = lazy(() => import('./pages/MastersPages').then((m) => ({ default: m.LocationsPage })));
const PolicyPage = lazy(() => import('./pages/MastersPages').then((m) => ({ default: m.PolicyPage })));

const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

/** time domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'attendance', element: guard('attendance.self', s(<AttendancePage />)) },
  { path: 'timesheet', element: guard('timesheet.self', s(<TimesheetPage />)) },
  { path: 'approvals', element: guard(['timesheet.approve.l1', 'timesheet.approve.l2'], s(<ApprovalsPage />)) },
  // ID card compliance is scheduled for the next release (API exists; screen deferred).
  { path: 'id-compliance', element: guard('idcompliance.manage', <Placeholder title='ID card compliance' screen='idcompliance' />) },
  { path: 'locations', element: guard('locations.manage', s(<LocationsPage />)) },
  { path: 'shifts', element: guard('shifts.manage', s(<ShiftsPage />)) },
  { path: 'attendance-policy', element: guard('settings.attendance', s(<PolicyPage />)) },
];
