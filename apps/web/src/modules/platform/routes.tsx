import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Loading } from '@/components/ui';

const RolesPage = lazy(() => import('./pages/RolesPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const BillingPage = lazy(() => import('./pages/BillingPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const BrandingPage = lazy(() => import('./pages/BrandingPage'));
const TenantsPage = lazy(() => import('./pages/TenantsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const SupportPage = lazy(() => import('./pages/SupportPage'));

const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

/** platform domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'roles', element: guard('roles.manage', s(<RolesPage />)) },
  { path: 'audit', element: guard('audit.view', s(<AuditPage />)) },
  { path: 'alerts', element: guard('alerts.view', s(<AlertsPage />)) },
  // Header search "See all results" — every signed-in user; each provider applies its own permissions.
  { path: 'search', element: s(<SearchPage />) },
  // SaaS (spec M9–M13).
  { path: 'billing', element: guard('billing.manage', s(<BillingPage />)) },
  { path: 'billing/checkout/:orderId', element: guard('billing.manage', s(<CheckoutPage />)) },
  { path: 'branding', element: guard('branding.manage', s(<BrandingPage />)) },
  // Platform administrators only (User.isPlatformAdmin); other admins see an explanation.
  { path: 'tenants', element: guard('tenants.manage', s(<TenantsPage />)) },
  { path: 'privacy', element: guard('privacy.view', s(<PrivacyPage />)) },
  { path: 'support', element: guard('support.use', s(<SupportPage />)) },
];
