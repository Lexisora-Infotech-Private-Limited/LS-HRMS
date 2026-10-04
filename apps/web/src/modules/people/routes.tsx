import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Loading } from '@/components/ui';

const EmployeesPage = lazy(() => import('./pages/EmployeesPage'));
const MastersPage = lazy(() => import('./pages/MastersPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const VaultPage = lazy(() => import('./pages/VaultPage'));
const JobsPage = lazy(() => import('./pages/JobsPage'));
const CandidatesPage = lazy(() => import('./pages/CandidatesPage'));
const InterviewsPage = lazy(() => import('./pages/InterviewsPage'));
const AppraisalsPage = lazy(() => import('./pages/AppraisalsPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const AssetsPage = lazy(() => import('./pages/AssetsPage'));
const WelcomeKitsPage = lazy(() => import('./pages/WelcomeKitsPage'));
const IdCardPage = lazy(() => import('./pages/IdCardPage'));
const VisitingCardPage = lazy(() => import('./pages/VisitingCardPage'));

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
  // Recruitment
  { path: 'jobs', element: guard('jobs.manage', s(<JobsPage />)) },
  { path: 'candidates', element: guard(['candidates.view', 'candidates.manage'], s(<CandidatesPage />)) },
  // Panelists see their own interviews even without the nav entry (audit G2); the API scopes the list.
  { path: 'interviews', element: guard(['interviews.view', 'dashboard.view'], s(<InterviewsPage />)) },
  // Everyone has "My reviews" (self review / reviews owed as a manager); cycles & templates need appraisal.view.
  { path: 'appraisals', element: guard(['appraisal.view', 'dashboard.view'], s(<AppraisalsPage />)) },
  { path: 'appraisals/review/:id', element: guard(['appraisal.view', 'dashboard.view'], s(<ReviewPage />)) },
  // Workplace (people-owned)
  { path: 'assets', element: guard('assets.manage', s(<AssetsPage />)) },
  { path: 'welcome-kits', element: guard('welcomekit.manage', s(<WelcomeKitsPage />)) },
  { path: 'id-card', element: guard('idcard.manage', s(<IdCardPage />)) },
  { path: 'visiting-card', element: guard('vcard.self', s(<VisitingCardPage />)) },
];
