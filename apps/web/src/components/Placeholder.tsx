import { PageHeader } from './ui';

/** Temporary screen used until a domain module implements the route. */
export function Placeholder({ title, screen }: { title: string; screen: string }) {
  return (
    <div className="stack" data-screen-label={title}>
      <PageHeader title={title} sub={`Screen “${screen}” is being built.`} />
    </div>
  );
}
