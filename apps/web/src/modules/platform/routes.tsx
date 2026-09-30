import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Loading } from '@/components/ui';
import { Placeholder } from '@/components/Placeholder';

const RolesPage = lazy(() => import('./pages/RolesPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));

const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

/** platform domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'roles', element: guard('roles.manage', s(<RolesPage />)) },
  { path: 'audit', element: guard('audit.view', s(<AuditPage />)) },
  { path: 'alerts', element: guard('alerts.view', s(<AlertsPage />)) },
  // Header search "See all results" — every signed-in user; each provider applies its own permissions.
  { path: 'search', element: s(<SearchPage />) },
  // SaaS screens ship in the next platform release (spec M9–M13).
  { path: 'billing', element: guard('billing.manage', <Placeholder title='Subscription & billing' screen='billing' />) },
  { path: 'branding', element: guard('branding.manage', <Placeholder title='Branding' screen='whitelabel' />) },
  { path: 'tenants', element: guard('tenants.manage', <Placeholder title='Tenants' screen='tenants' />) },
  { path: 'privacy', element: guard('privacy.view', <Placeholder title='Data privacy guarantee' screen='privacy' />) },
  { path: 'support', element: guard('support.use', <Placeholder title='Lexisora support' screen='support' />) },
];
