import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Placeholder } from '@/components/Placeholder';

/** leavepay domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'leave', element: guard('leave.self', <Placeholder title='Time off' screen='leave' />) },
  { path: 'leave-setup', element: guard('leave.manage', <Placeholder title='Leave setup' screen='leaveAdmin' />) },
  { path: 'payslips', element: guard('payslips.self', <Placeholder title='My payslips' screen='payslips' />) },
  { path: 'payroll', element: guard('payroll.manage', <Placeholder title='Payroll run' screen='payroll' />) },
];
