import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { WindowKind } from '@tracker-shared/channels';
import './styles/fonts.css';
import './styles/design-system.css';
import './styles/tracker.css';
import { MainApp } from './MainApp';
import { ToastApp, WidgetApp } from './Mini';

/** One renderer bundle, three windows: main (400×620), tray widget and screenshot toast. */
const param = new URLSearchParams(window.location.search).get('w');
const kind: WindowKind = param === 'widget' || param === 'toast' ? param : 'main';
document.documentElement.dataset.window = kind;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{kind === 'widget' ? <WidgetApp /> : kind === 'toast' ? <ToastApp /> : <MainApp />}</StrictMode>,
);
