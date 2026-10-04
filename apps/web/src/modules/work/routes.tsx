import { lazy, Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Loading } from '@/components/ui';

const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const BoardPage = lazy(() => import('./pages/BoardPage'));
const ArchivePage = lazy(() => import('./pages/ArchivePage'));
const InternsPage = lazy(() => import('./pages/InternsPage'));

const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

/** work domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'projects', element: guard('projects.view', s(<ProjectsPage />)) },
  { path: 'projects/:id', element: guard(['projects.view', 'tasks.board'], s(<ProjectDetailPage />)) },
  { path: 'clients', element: guard('clients.manage', s(<ClientsPage />)) },
  { path: 'board', element: guard(['tasks.board', 'tasks.viewAllBoards'], s(<BoardPage />)) },
  // Leads/managers see the whole vault; other employees only items shared with "All developers" (API-scoped).
  { path: 'archive', element: guard(['archive.view', 'archive.manage', 'projects.view'], s(<ArchivePage />)) },
  // Interns reach their own sheet here without a nav item; the API scopes what each user sees.
  { path: 'interns', element: guard(['interns.manage', 'interns.viewAll', 'tasks.board'], s(<InternsPage />)) },
];
