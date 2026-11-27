import { sidebarForeground } from '@lexisora/shared';

/**
 * Tenant white-label, applied at runtime exactly like the Branding page preview:
 *  - primary colour (`accent`)  → accent ramp (links, tags, highlights) and filled primary buttons;
 *  - secondary colour (`accent2`) → the sidebar, with readable text picked by contrast.
 * Ramps are derived with color-mix so every component that uses the tokens follows the palette.
 * The default gold palette (or no branding) clears every override and keeps the stock look.
 */
export function applyBranding(b: { accent: string; accent2: string } | null | undefined) {
  const root = document.documentElement.style;
  if (!b || b.accent.toLowerCase() === '#b68235') {
    for (const k of BRAND_KEYS) root.removeProperty(k);
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

  // Filled primary buttons ("Primary action" in the preview).
  root.setProperty('--color-btn-primary', a);

  // Sidebar in the secondary colour ("Secondary (sidebar)" in the preview).
  const s = b.accent2;
  const fg = sidebarForeground(s);
  root.setProperty('--color-sidebar-bg', s);
  root.setProperty('--color-sidebar-text', `color-mix(in srgb, ${fg} 92%, ${s})`);
  root.setProperty('--color-sidebar-text-muted', `color-mix(in srgb, ${fg} 62%, ${s})`);
  root.setProperty('--color-sidebar-active-text', fg);
  root.setProperty('--color-sidebar-hover', `color-mix(in srgb, ${fg} 10%, transparent)`);
  root.setProperty('--color-sidebar-active-bg', `color-mix(in srgb, ${fg} 16%, transparent)`);
  root.setProperty('--color-sidebar-border', `color-mix(in srgb, ${fg} 14%, transparent)`);
}

const BRAND_KEYS = [
  '--color-accent',
  '--color-accent-2',
  ...[100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => `--color-accent-${n}`),
  '--color-btn-primary',
  '--color-sidebar-bg',
  '--color-sidebar-text',
  '--color-sidebar-text-muted',
  '--color-sidebar-active-text',
  '--color-sidebar-hover',
  '--color-sidebar-active-bg',
  '--color-sidebar-border',
];
