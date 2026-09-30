/**
 * electron-builder configuration for the Windows NSIS installer.
 *
 *   pnpm --filter @lexisora/tracker dist:win
 *
 * Environment (all optional):
 *   LEXISORA_UPDATE_URL   generic auto-update feed (e.g. https://lexisora.hrms.app/api/v1/tracker/updates/win32-x64/stable)
 *                         — written into app-update.yml as a placeholder for a future electron-updater
 *                         integration. The app itself checks GET /api/v1/tracker/releases/latest.
 *   CSC_LINK / CSC_KEY_PASSWORD   Authenticode certificate for signing (CI only; dev builds are unsigned).
 */
/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'in.lexisora.tracker',
  productName: 'Lexisora Tracker',
  copyright: 'Copyright © 2026 Lexisora Infotech',
  directories: { output: 'dist', buildResources: 'build' },
  // Main, preload and renderer are fully bundled by electron-vite (see electron.vite.config.ts),
  // so no node_modules are shipped.
  files: ['out/**/*', 'package.json', '!**/node_modules/**/*', '!**/*.map'],
  asar: true,
  npmRebuild: false,
  extraMetadata: { main: 'out/main/index.js' },
  // Hardening (spec T7): no ELECTRON_RUN_AS_NODE / NODE_OPTIONS / --inspect, asar integrity, load only from app.asar.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    artifactName: 'Lexisora-Tracker-Setup-${version}-${arch}.${ext}',
    executableName: 'Lexisora Tracker',
  },
  nsis: {
    // Per-user one-click install to %LOCALAPPDATA%\Programs\Lexisora Tracker — no admin rights needed.
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    createStartMenuShortcut: true,
    createDesktopShortcut: false,
    shortcutName: 'Lexisora Tracker',
    uninstallDisplayName: 'Lexisora Tracker',
    // Keep the encrypted offline queue on uninstall so unsynced time survives a reinstall.
    deleteAppDataOnUninstall: false,
    artifactName: 'Lexisora-Tracker-Setup-${version}-${arch}.${ext}',
  },
  publish: process.env.LEXISORA_UPDATE_URL
    ? [{ provider: 'generic', url: process.env.LEXISORA_UPDATE_URL, channel: 'latest' }]
    : null,
};

module.exports = config;
