/**
 * Which ID card template a person's card uses, first match wins:
 *   1. the template chosen for that person,
 *   2. the template set for their role,
 *   3. the company default.
 * A choice that points at a template that no longer exists is ignored. `own` maps employee id → template id and `byRole` maps role key → template id.
 */
export function pickTemplateId(own: Record<string, string>, employeeId: string, byRole: Record<string, string>, roleKey: string | null, available: ReadonlySet<string>, defaultId: string): string {
  const mine = own[employeeId];
  if (mine && available.has(mine)) return mine;
  const forRole = roleKey ? byRole[roleKey] : undefined;
  if (forRole && available.has(forRole)) return forRole;
  return defaultId;
}
