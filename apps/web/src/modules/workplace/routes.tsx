import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Loading } from '@/components/ui';
import { Placeholder } from '@/components/Placeholder';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const NoticesPage = lazy(() => import('./pages/NoticesPage'));
const FeedPage = lazy(() => import('./pages/FeedPage'));
const KudosPage = lazy(() => import('./pages/KudosPage'));
const PoliciesPage = lazy(() => import('./pages/PoliciesPage'));
const HelpdeskPage = lazy(() => import('./pages/HelpdeskPage'));

const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

/** workplace domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'dashboard', element: guard('dashboard.view', s(<DashboardPage />)) },
  { path: 'notices', element: guard('notices.view', s(<NoticesPage />)) },
  { path: 'feed', element: guard('feed.view', s(<FeedPage />)) },
  { path: 'kudos', element: guard('kudos.view', s(<KudosPage />)) },
  { path: 'policies', element: guard('policies.view', s(<PoliciesPage />)) },
  { path: 'helpdesk', element: guard('helpdesk.use', s(<HelpdeskPage />)) },
  // Next workplace release (comms hub, learning, rooms & visitors, CCTV, wellness):
  { path: 'chat', element: guard('chat.use', <Placeholder title='Comms hub' screen='chat' />) },
  { path: 'learning', element: guard('lms.view', <Placeholder title='Learning' screen='lms' />) },
  { path: 'facility', element: guard('facility.use', <Placeholder title='Rooms & visitors' screen='facility' />) },
  { path: 'cctv', element: guard('cctv.view', <Placeholder title='CCTV' screen='cctv' />) },
  { path: 'wellness', element: guard('wellness.play', <Placeholder title='Wellness games' screen='wellness' />) },
];
