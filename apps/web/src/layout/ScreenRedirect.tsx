import { Navigate, useParams } from 'react-router-dom';
import { navItemById } from '@lexisora/shared';

/** Resolves wireframe screen ids (flow-map links) to real routes. */
export function ScreenRedirect() {
  const { screen } = useParams();
  const item = screen ? navItemById(screen) : undefined;
  const special: Record<string, string> = { profile: '/me', login: '/login' };
  return <Navigate to={item?.path ?? special[screen ?? ''] ?? '/dashboard'} replace />;
}
