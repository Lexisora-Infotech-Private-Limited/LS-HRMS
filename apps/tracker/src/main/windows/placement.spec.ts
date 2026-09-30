import { describe, expect, it } from 'vitest';
import { anchorToTray, isPositionVisible, taskbarEdge, type DisplayArea } from './placement';

const FHD: DisplayArea['bounds'] = { x: 0, y: 0, width: 1920, height: 1080 };
const SIZE = { width: 260, height: 200 };

describe('tray widget placement (spec T7 §1, §8)', () => {
  it('bottom taskbar: centred on the tray icon, just above the taskbar', () => {
    const d: DisplayArea = { bounds: FHD, workArea: { x: 0, y: 0, width: 1920, height: 1032 } };
    expect(taskbarEdge(d)).toBe('bottom');
    expect(anchorToTray(d, { x: 1700, y: 1040, width: 24, height: 32 }, SIZE)).toEqual({ x: 1582, y: 820, width: 260, height: 200 });
    // icon near the right edge → clamped inside the work area
    expect(anchorToTray(d, { x: 1900, y: 1040, width: 16, height: 32 }, SIZE).x).toBe(1920 - 260 - 12);
  });

  it('top, left and right taskbars', () => {
    const top: DisplayArea = { bounds: FHD, workArea: { x: 0, y: 48, width: 1920, height: 1032 } };
    expect(anchorToTray(top, { x: 1700, y: 8, width: 24, height: 32 }, SIZE)).toMatchObject({ x: 1582, y: 60 });
    const left: DisplayArea = { bounds: FHD, workArea: { x: 60, y: 0, width: 1860, height: 1080 } };
    expect(taskbarEdge(left)).toBe('left');
    expect(anchorToTray(left, { x: 10, y: 900, width: 32, height: 24 }, SIZE)).toMatchObject({ x: 72, y: 812 });
    const right: DisplayArea = { bounds: FHD, workArea: { x: 0, y: 0, width: 1860, height: 1080 } };
    expect(taskbarEdge(right)).toBe('right');
    expect(anchorToTray(right, { x: 1880, y: 1000, width: 32, height: 24 }, SIZE)).toMatchObject({ x: 1860 - 260 - 12, y: 1080 - 200 - 12 });
  });

  it('unknown tray position (overflow flyout) or auto-hidden taskbar → bottom-right of the work area', () => {
    const d: DisplayArea = { bounds: FHD, workArea: FHD };
    expect(anchorToTray(d, null, SIZE)).toEqual({ x: 1648, y: 868, width: 260, height: 200 });
    expect(anchorToTray(d, { x: 0, y: 0, width: 0, height: 0 }, SIZE)).toMatchObject({ x: 1648, y: 868 });
  });

  it('second monitor to the left (negative coordinates)', () => {
    const d: DisplayArea = { bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1040 } };
    expect(anchorToTray(d, { x: -300, y: 1045, width: 24, height: 32 }, SIZE)).toMatchObject({ x: -418, y: 828 });
  });

  it('a remembered position is reused only while it is still on a screen', () => {
    const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }];
    expect(isPositionVisible({ x: 1500, y: 700 }, SIZE, areas)).toBe(true);
    expect(isPositionVisible({ x: 2500, y: 700 }, SIZE, areas)).toBe(false); // monitor unplugged
    expect(isPositionVisible({ x: 1500, y: -150 }, SIZE, areas)).toBe(false); // drag handle off-screen
    expect(isPositionVisible({ x: 1800, y: 700 }, SIZE, areas)).toBe(false); // less than half visible
  });
});
