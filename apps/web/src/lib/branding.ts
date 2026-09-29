/**
 * Tenant white-label: override the accent tokens at runtime. Ramps are derived with
 * color-mix so every component that uses --color-accent-* follows the tenant's palette.
 */
export function applyBranding(b: { accent: string; accent2: string } | null | undefined) {
  const root = document.documentElement.style;
  if (!b || b.accent.toLowerCase() === '#b68235') {
    for (const k of RAMP_KEYS) root.removeProperty(k);
    return;
  }
  const a = b.accent;
  root.setProperty('--color-accent', a);
  root.setProperty('--color-accent-2', b.accent2);
  root.setProperty('--color-accent-100', `color-mix(in srgb, ${a} 10%, white)`);
  root.setProperty('--color-accent-200', `color-mix(in srgb, ${a} 22%, white)`);
  root.setProperty('--color-accent-300', `color-mix(in srgb, ${a} 45%, white)`);
  root.setProperty('--color-accent-400', `color-mix(in srgb, ${a} 70%, white)`);
  root.setProperty('--color-accent-500', a);
  root.setProperty('--color-accent-600', `color-mix(in srgb, ${a} 85%, black)`);
  root.setProperty('--color-accent-700', `color-mix(in srgb, ${a} 70%, black)`);
  root.setProperty('--color-accent-800', `color-mix(in srgb, ${a} 52%, black)`);
  root.setProperty('--color-accent-900', `color-mix(in srgb, ${a} 35%, black)`);
}

const RAMP_KEYS = [
  '--color-accent',
  '--color-accent-2',
  ...[100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => `--color-accent-${n}`),
];
