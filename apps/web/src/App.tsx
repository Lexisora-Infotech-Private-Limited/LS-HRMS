import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useLocation, type RouteObject } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Loading } from '@/components/ui';
import { AppShell } from '@/layout/AppShell';
import { LoginPage } from '@/pages/Login';
import { AcceptInvitePage, ChangePasswordPage, ForgotPasswordPage, NotFoundPage, ResetPasswordPage } from '@/pages/AuthPages';

// Each domain exports `routes` from src/modules/<domain>/routes.tsx.
const moduleRoutes = Object.values(
  import.meta.glob<{ routes: RouteObject[] }>('./modules/*/routes.tsx', { eager: true }),
).flatMap((m) => m.routes);

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Loading label="Loading your workspace…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Wireframe deep links: /#screen=approvals&role=lead → /approvals */
function LegacyHashRedirect() {
  const p = new URLSearchParams(window.location.hash.slice(1));
  const screen = p.get('screen');
  return <Navigate to={screen && screen !== 'login' ? `/s/${screen}` : '/dashboard'} replace />;
}

const router = createBrowserRouter([
  { path: '/login', element: <PublicOnly><LoginPage /></PublicOnly> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/accept-invite', element: <AcceptInvitePage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <LegacyHashRedirect /> },
      { path: 's/:screen', lazy: async () => ({ Component: (await import('./layout/ScreenRedirect')).ScreenRedirect }) },
      { path: 'change-password', element: <ChangePasswordPage /> },
      ...moduleRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
