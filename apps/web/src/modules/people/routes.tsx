import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Placeholder } from '@/components/Placeholder';
import { Loading } from '@/components/ui';

const EmployeesPage = lazy(() => import('./pages/EmployeesPage'));
const MastersPage = lazy(() => import('./pages/MastersPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const VaultPage = lazy(() => import('./pages/VaultPage'));

const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

/** people domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'employees', element: guard('employees.view', s(<EmployeesPage />)) },
  // Profile access is scoped by relationship on the server (self / reports / HR).
  { path: 'employees/:id', element: s(<ProfilePage />) },
  { path: 'me', element: guard('dashboard.view', s(<ProfilePage self />)) },
  { path: 'masters', element: guard('masters.manage', s(<MastersPage />)) },
  { path: 'onboarding', element: guard(['onboarding.self', 'onboarding.manage'], s(<OnboardingPage />)) },
  { path: 'vault', element: guard('vault.self', s(<VaultPage />)) },
  // Deferred to the next release (see people spec): still reachable, clearly labelled.
  { path: 'appraisals', element: guard('appraisal.view', <Placeholder title='Appraisals' screen='appraisal' />) },
  { path: 'jobs', element: guard('jobs.manage', <Placeholder title='Jobs' screen='jobs' />) },
  { path: 'candidates', element: guard('candidates.view', <Placeholder title='Candidates & interview vault' screen='candidates' />) },
  { path: 'interviews', element: guard('interviews.view', <Placeholder title='Interviews' screen='interviews' />) },
  { path: 'id-card', element: guard('idcard.manage', <Placeholder title='ID card designer' screen='idcard' />) },
  { path: 'visiting-card', element: guard('vcard.self', <Placeholder title='Digital visiting card' screen='vcard' />) },
  { path: 'assets', element: guard('assets.manage', <Placeholder title='Assets & inventory' screen='assets' />) },
  { path: 'welcome-kits', element: guard('welcomekit.manage', <Placeholder title='Welcome kits' screen='welcomekit' />) },
];
