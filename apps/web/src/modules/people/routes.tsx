import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Placeholder } from '@/components/Placeholder';

/** people domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'employees', element: guard('employees.view', <Placeholder title='Employees' screen='employees' />) },
  { path: 'employees/:id', element: guard('employees.view', <Placeholder title='Employee profile' screen='profile' />) },
  { path: 'me', element: guard('dashboard.view', <Placeholder title='My profile' screen='me' />) },
  { path: 'onboarding', element: guard('onboarding.self', <Placeholder title='Paperless onboarding' screen='onboarding' />) },
  { path: 'appraisals', element: guard('appraisal.view', <Placeholder title='Appraisals' screen='appraisal' />) },
  { path: 'jobs', element: guard('jobs.manage', <Placeholder title='Jobs' screen='jobs' />) },
  { path: 'candidates', element: guard('candidates.view', <Placeholder title='Candidates & interview vault' screen='candidates' />) },
  { path: 'interviews', element: guard('interviews.view', <Placeholder title='Interviews' screen='interviews' />) },
  { path: 'vault', element: guard('vault.self', <Placeholder title='My digital vault' screen='vault' />) },
  { path: 'id-card', element: guard('idcard.manage', <Placeholder title='ID card designer' screen='idcard' />) },
  { path: 'visiting-card', element: guard('vcard.self', <Placeholder title='Digital visiting card' screen='vcard' />) },
  { path: 'assets', element: guard('assets.manage', <Placeholder title='Assets & inventory' screen='assets' />) },
  { path: 'welcome-kits', element: guard('welcomekit.manage', <Placeholder title='Welcome kits' screen='welcomekit' />) },
];
