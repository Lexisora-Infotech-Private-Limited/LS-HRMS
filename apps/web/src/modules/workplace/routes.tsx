import type { RouteObject } from 'react-router-dom';
import { guard } from '@/layout/Guard';
import { Placeholder } from '@/components/Placeholder';

/** workplace domain routes (relative to the app shell). Collected automatically by App.tsx. */
export const routes: RouteObject[] = [
  { path: 'dashboard', element: guard('dashboard.view', <Placeholder title='Dashboard' screen='dashboard' />) },
  { path: 'feed', element: guard('feed.view', <Placeholder title='Company feed' screen='feed' />) },
  { path: 'notices', element: guard('notices.view', <Placeholder title='Notice board' screen='notices' />) },
  { path: 'chat', element: guard('chat.use', <Placeholder title='Comms hub' screen='chat' />) },
  { path: 'policies', element: guard('policies.view', <Placeholder title='Policies & rulebook' screen='policies' />) },
  { path: 'helpdesk', element: guard('helpdesk.use', <Placeholder title='Helpdesk' screen='helpdesk' />) },
  { path: 'learning', element: guard('lms.view', <Placeholder title='Learning' screen='lms' />) },
  { path: 'kudos', element: guard('kudos.view', <Placeholder title='Kudos & Employee of the Month' screen='kudos' />) },
  { path: 'facility', element: guard('facility.use', <Placeholder title='Rooms & visitors' screen='facility' />) },
  { path: 'cctv', element: guard('cctv.view', <Placeholder title='CCTV' screen='cctv' />) },
  { path: 'wellness', element: guard('wellness.play', <Placeholder title='Wellness games' screen='wellness' />) },
];
