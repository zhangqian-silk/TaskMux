/**
 * Ordering for interactive Role pickers.
 *
 * Operator and Leader come first because they are the Roles a user reaches for
 * most often in a Task; everything else is alphabetical. This is presentation
 * order only and carries no authority over Role configuration.
 */

export function orderRoleOptions<T extends { kind?: string; name?: string; id?: string }>(
  roles: readonly T[]
): T[] {
  return [...roles].sort((left, right) => {
    const rank = roleRank(left) - roleRank(right);
    if (rank !== 0) return rank;
    return roleName(left).localeCompare(roleName(right));
  });
}

function roleRank(role: { kind?: string; name?: string; id?: string }): number {
  const kind = role.kind?.toLowerCase();
  const name = roleName(role).toLowerCase();
  if (kind === "operator" || name === "operator") return 0;
  if (kind === "leader" || name === "leader") return 1;
  return 2;
}

function roleName(role: { name?: string; id?: string }): string {
  return role.name ?? role.id ?? "";
}
