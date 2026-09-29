import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Placeholder } from '@/components/Placeholder';

/** platform domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'roles', element: guard('roles.manage', <Placeholder title='Roles & access' screen='roles' />) },
  { path: 'audit', element: guard('audit.view', <Placeholder title='Audit log' screen='audit' />) },
  { path: 'alerts', element: guard('alerts.view', <Placeholder title='Alerts' screen='notif' />) },
  { path: 'billing', element: guard('billing.manage', <Placeholder title='Subscription & billing' screen='billing' />) },
  { path: 'branding', element: guard('branding.manage', <Placeholder title='Branding' screen='whitelabel' />) },
  { path: 'tenants', element: guard('tenants.manage', <Placeholder title='Tenants' screen='tenants' />) },
  { path: 'privacy', element: guard('privacy.view', <Placeholder title='Data privacy guarantee' screen='privacy' />) },
  { path: 'support', element: guard('support.use', <Placeholder title='Lexisora support' screen='support' />) },
];
