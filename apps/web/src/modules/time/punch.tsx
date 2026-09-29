/**
 * Punch controls owned by Time (implemented by the Time module):
 *  - PunchButton: header "Punch in / Punch out" button
 *  - PunchCard: dashboard "Today" card (state, live elapsed timer, shift, mode note, button)
 *  - usePunch(): shared state/actions
 */
export function PunchButton() {
  return null;
}
export function PunchCard() {
  return null;
}
export function usePunch() {
  return { punchedIn: false, toggle: async () => {}, label: 'Punch in' };
}
