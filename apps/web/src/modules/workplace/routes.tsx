import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Loading } from '@/components/ui';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const NoticesPage = lazy(() => import('./pages/NoticesPage'));
const FeedPage = lazy(() => import('./pages/FeedPage'));
const KudosPage = lazy(() => import('./pages/KudosPage'));
const PoliciesPage = lazy(() => import('./pages/PoliciesPage'));
const HelpdeskPage = lazy(() => import('./pages/HelpdeskPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const LearningPage = lazy(() => import('./pages/LearningPage'));
const FacilityPage = lazy(() => import('./pages/FacilityPage'));
const CctvPage = lazy(() => import('./pages/CctvPage'));
const WellnessPage = lazy(() => import('./pages/WellnessPage'));

const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

/** workplace domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'dashboard', element: guard('dashboard.view', s(<DashboardPage />)) },
  { path: 'notices', element: guard('notices.view', s(<NoticesPage />)) },
  { path: 'feed', element: guard('feed.view', s(<FeedPage />)) },
  { path: 'kudos', element: guard('kudos.view', s(<KudosPage />)) },
  { path: 'policies', element: guard('policies.view', s(<PoliciesPage />)) },
  { path: 'helpdesk', element: guard('helpdesk.use', s(<HelpdeskPage />)) },
  { path: 'chat', element: guard('chat.use', s(<ChatPage />)) },
  { path: 'learning', element: guard('lms.view', s(<LearningPage />)) },
  { path: 'facility', element: guard('facility.use', s(<FacilityPage />)) },
  { path: 'cctv', element: guard('cctv.view', s(<CctvPage />)) },
  { path: 'wellness', element: guard('wellness.play', s(<WellnessPage />)) },
];
