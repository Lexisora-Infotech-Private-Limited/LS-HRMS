/**
 * Dashboard widgets owned by Leave (implemented by the Leavepay module).
 *  - LeaveBalanceCard: "Leave balance" card with type rows "left / total" + "Apply time off"
 *  - LeaveHistoryList: "Leave history" list on the dashboard's right column
 */
export function LeaveBalanceCard() {
  return null;
}
export function LeaveHistoryList() {
  return null;
}
export function useLeaveBalances() {
  return { data: [] as { leaveTypeId: string; code: string; name: string; available: number; total: number }[], isLoading: false };
}
