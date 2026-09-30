import { hostname, release, type } from 'node:os';

/** "Windows 11 (build 26200)" — builds ≥ 22000 are Windows 11 even though the kernel still says 10.0. */
export function osLabel(platform: string = process.platform, rel: string = release()): string {
  if (platform === 'win32') {
    const build = Number(rel.split('.')[2] ?? 0);
    const name = build >= 22000 ? 'Windows 11' : 'Windows 10';
    return build ? `${name} (build ${build})` : name;
  }
  if (platform === 'darwin') return `macOS (Darwin ${rel})`;
  return `${type()} ${rel}`;
}

export function deviceIdentity(): { hostname: string; os: string } {
  const host = (hostname() || 'THIS-PC').trim().toUpperCase().slice(0, 120);
  return { hostname: host, os: osLabel().slice(0, 120) };
}
