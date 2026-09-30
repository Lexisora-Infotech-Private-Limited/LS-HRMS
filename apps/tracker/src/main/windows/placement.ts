/**
 * Pure window placement for the tray widget and the screenshot toast (spec T7 §1, §8):
 * anchor next to the tray icon on the display that holds the tray, inside its work area
 * (so auto-hidden / top / side taskbars and multi-monitor setups all work).
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayArea {
  /** Full display bounds. */
  bounds: Rect;
  /** Bounds minus the taskbar. */
  workArea: Rect;
}

export type TaskbarEdge = 'top' | 'bottom' | 'left' | 'right';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Which edge the taskbar sits on (the side where the work area is inset); auto-hide → bottom. */
export function taskbarEdge(d: DisplayArea): TaskbarEdge {
  const { bounds: b, workArea: w } = d;
  if (w.y > b.y) return 'top';
  if (w.x > b.x) return 'left';
  if (w.x + w.width < b.x + b.width) return 'right';
  return 'bottom';
}

/**
 * Rectangle of `size` next to the tray icon: centred on the icon along the taskbar and
 * `margin` px away from it; bottom-right of the work area when the tray position is unknown
 * (icon hidden in the overflow flyout → Electron reports an empty rectangle).
 */
export function anchorToTray(display: DisplayArea, tray: Rect | null, size: { width: number; height: number }, margin = 12): Rect {
  const wa = display.workArea;
  const { width, height } = size;
  const minX = wa.x + margin;
  const maxX = wa.x + wa.width - width - margin;
  const minY = wa.y + margin;
  const maxY = wa.y + wa.height - height - margin;
  let x = maxX;
  let y = maxY;
  if (tray && tray.width > 0 && tray.height > 0) {
    const cx = tray.x + tray.width / 2;
    const cy = tray.y + tray.height / 2;
    const edge = taskbarEdge(display);
    if (edge === 'top' || edge === 'bottom') {
      x = clamp(Math.round(cx - width / 2), minX, maxX);
      y = edge === 'top' ? minY : maxY;
    } else {
      y = clamp(Math.round(cy - height / 2), minY, maxY);
      x = edge === 'left' ? minX : maxX;
    }
  }
  return { x: Math.round(x), y: Math.round(y), width, height };
}

/** A remembered widget position is reused only if the widget would still be mostly visible on some display. */
export function isPositionVisible(pos: { x: number; y: number }, size: { width: number; height: number }, workAreas: readonly Rect[]): boolean {
  return workAreas.some((wa) => {
    const visibleW = Math.min(pos.x + size.width, wa.x + wa.width) - Math.max(pos.x, wa.x);
    const visibleH = Math.min(pos.y + size.height, wa.y + wa.height) - Math.max(pos.y, wa.y);
    // the drag handle (top 40 px) must be on screen, and at least half the width
    return visibleW >= size.width / 2 && visibleH >= Math.min(40, size.height) && pos.y >= wa.y && pos.y <= wa.y + wa.height - 40;
  });
}
