import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Loading } from '@/components/ui';

const AttendancePage = lazy(() => import('./pages/AttendancePage'));
const TimesheetPage = lazy(() => import('./pages/TimesheetPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const ShiftsPage = lazy(() => import('./pages/MastersPages').then((m) => ({ default: m.ShiftsPage })));
const LocationsPage = lazy(() => import('./pages/MastersPages').then((m) => ({ default: m.LocationsPage })));
const IdCompliancePage = lazy(() => import('./pages/IdCompliancePage'));
const PolicyPage = lazy(() => import('./pages/MastersPages').then((m) => ({ default: m.PolicyPage })));

const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

/** time domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'attendance', element: guard('attendance.self', s(<AttendancePage />)) },
  { path: 'timesheet', element: guard('timesheet.self', s(<TimesheetPage />)) },
  // Timesheet approvers (L1/L2) and attendance-correction approvers (managers, HR) share this screen.
  { path: 'approvals', element: guard(['timesheet.approve.l1', 'timesheet.approve.l2', 'attendance.regularize.approve'], s(<ApprovalsPage />)) },
  { path: 'id-compliance', element: guard('idcompliance.manage', s(<IdCompliancePage />)) },
  { path: 'locations', element: guard('locations.manage', s(<LocationsPage />)) },
  { path: 'shifts', element: guard('shifts.manage', s(<ShiftsPage />)) },
  { path: 'attendance-policy', element: guard('settings.attendance', s(<PolicyPage />)) },
];
