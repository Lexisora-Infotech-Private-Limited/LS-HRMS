import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Placeholder } from '@/components/Placeholder';

/** work domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'projects', element: guard('projects.view', <Placeholder title='Projects' screen='projects' />) },
  { path: 'board', element: guard('tasks.board', <Placeholder title='Task board' screen='kanban' />) },
  { path: 'archive', element: guard('archive.view', <Placeholder title='Project archive & client vault' screen='archive' />) },
  { path: 'interns', element: guard('interns.manage', <Placeholder title='Intern task sheets' screen='interns' />) },
];
