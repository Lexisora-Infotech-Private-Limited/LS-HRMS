import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Loading } from '@/components/ui';

const LeavePage = lazy(() => import('./pages/LeavePage'));
const LeaveSetupPage = lazy(() => import('./pages/LeaveSetupPage'));
const PayslipsPage = lazy(() => import('./pages/PayslipsPage'));
const PayrollPage = lazy(() => import('./pages/PayrollPage'));

const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

/** leavepay domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'leave', element: guard('leave.self', s(<LeavePage />)) },
  { path: 'leave-setup', element: guard('leave.manage', s(<LeaveSetupPage />)) },
  { path: 'payslips', element: guard('payslips.self', s(<PayslipsPage />)) },
  { path: 'payroll', element: guard('payroll.manage', s(<PayrollPage />)) },
];
