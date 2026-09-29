import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Placeholder } from '@/components/Placeholder';

/** time domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'attendance', element: guard('attendance.self', <Placeholder title='Attendance' screen='attendance' />) },
  { path: 'timesheet', element: guard('timesheet.self', <Placeholder title='My timesheet' screen='timesheet' />) },
  { path: 'approvals', element: guard(['timesheet.approve.l1','timesheet.approve.l2'], <Placeholder title='Timesheet approvals' screen='approvals' />) },
  { path: 'id-compliance', element: guard('idcompliance.manage', <Placeholder title='ID card compliance' screen='idcompliance' />) },
  { path: 'locations', element: guard('locations.manage', <Placeholder title='Work locations' screen='locations' />) },
  { path: 'shifts', element: guard('shifts.manage', <Placeholder title='Shifts' screen='shifts' />) },
  { path: 'attendance-policy', element: guard('settings.attendance', <Placeholder title='Attendance policy' screen='settings' />) },
];
