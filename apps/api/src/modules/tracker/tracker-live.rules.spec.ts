import { describe, expect, it } from 'vitest';
import { foldLiveState } from './tracker.rules';

describe('foldLiveState — what the task board shows as Running / Paused', () => {
  const out = { status: 'OUT' as const, taskId: null };

  it('punch-in on a task, then a switch, then a break', () => {
    expect(foldLiveState(out, [{ type: 'PUNCH_IN', taskId: 'AT-101' }])).toEqual({ status: 'WORKING', taskId: 'AT-101' });
    expect(foldLiveState(out, [{ type: 'PUNCH_IN', taskId: 'AT-101' }, { type: 'TASK_SWITCH', taskId: 'AT-103' }])).toEqual({ status: 'WORKING', taskId: 'AT-103' });
    expect(foldLiveState(out, [{ type: 'PUNCH_IN', taskId: 'AT-101' }, { type: 'BREAK_START', taskId: 'AT-101' }])).toEqual({ status: 'BREAK', taskId: 'AT-101' });
  });

  it('a switch during a break changes the task but keeps the break', () => {
    expect(foldLiveState({ status: 'BREAK', taskId: 'AT-101' }, [{ type: 'TASK_SWITCH', taskId: 'AT-103' }])).toEqual({ status: 'BREAK', taskId: 'AT-103' });
  });

  it('the board stopping the timer switches to no task', () => {
    expect(foldLiveState({ status: 'WORKING', taskId: 'AT-101' }, [{ type: 'TASK_SWITCH', taskId: null }])).toEqual({ status: 'WORKING', taskId: null });
  });

  it('idle, lock and sleep pause; resume waits for the heartbeat; punch-out and quit stop', () => {
    const w = { status: 'WORKING' as const, taskId: 'AT-101' };
    expect(foldLiveState(w, [{ type: 'IDLE_START', taskId: 'AT-101' }]).status).toBe('IDLE');
    expect(foldLiveState(w, [{ type: 'LOCK' }, { type: 'RESUME' }]).status).toBe('IDLE');
    expect(foldLiveState(w, [{ type: 'LOCK' }, { type: 'UNLOCK', taskId: 'AT-101' }]).status).toBe('WORKING');
    expect(foldLiveState(w, [{ type: 'UNLOCK', taskId: 'AT-101' }, { type: 'IDLE_START', taskId: 'AT-101' }]).status).toBe('IDLE');
    expect(foldLiveState(w, [{ type: 'PUNCH_OUT', taskId: 'AT-101' }]).status).toBe('OUT');
    expect(foldLiveState(w, [{ type: 'APP_QUIT', taskId: 'AT-101' }]).status).toBe('OUT');
    expect(foldLiveState(w, [{ type: 'CLOCK_CHANGE' }])).toEqual(w);
  });
});
