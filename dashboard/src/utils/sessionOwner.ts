/**
 * Session ownership in the dashboard. A session belongs to the operator key that created it
 * (`ownerKeyId`), or to the admins (`null`). Operators and viewers only ever receive their own and
 * their assigned sessions from the API, so the owner filter is an admin convenience, applied
 * client-side to the list the API already returned.
 */

/** The URL search parameter the owner filter persists in. */
export const OWNER_PARAM = 'owner';
/** Filter values besides a key id. */
export const OWNER_ALL = 'all';
export const OWNER_ADMIN = 'admin';

export interface OwnedSession {
  ownerKeyId?: string | null;
}

export function filterSessionsByOwner<T extends OwnedSession>(sessions: readonly T[], owner: string): T[] {
  if (!owner || owner === OWNER_ALL) return [...sessions];
  if (owner === OWNER_ADMIN) return sessions.filter(s => !s.ownerKeyId);
  return sessions.filter(s => s.ownerKeyId === owner);
}

export interface OwnerKey {
  id: string;
  name: string;
  role: string;
}

/** The keys a session can be owned by: every non-admin key, by name. */
export function ownerCandidates<T extends OwnerKey>(keys: readonly T[]): T[] {
  return keys.filter(k => k.role !== 'admin').sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export interface OwnerOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface OwnerOptionLabels {
  all: string;
  admin: string;
  /** The name shown for an owner whose key was deleted. */
  unknown: string;
  /** The role hint for a key ('operator' / 'viewer'); omit to show names only. */
  role?: (role: string) => string;
}

function withRole(name: string, role: string | undefined, labels: OwnerOptionLabels): string {
  const hint = role && labels.role ? labels.role(role) : '';
  return hint ? `${name} · ${hint}` : name;
}

/**
 * Filter options with a session count each: All, Admin, then every operator/viewer key by name (A-Z), keys
 * that own no session included, plus any owner that only appears on a session (an admin key that owns one,
 * or a deleted key, shown by the name the session carries or the "Deleted key" label).
 */
export function ownerFilterOptions(
  keys: readonly OwnerKey[],
  sessions: ReadonlyArray<OwnedSession & { ownerName?: string | null }>,
  labels: OwnerOptionLabels,
): OwnerOption[] {
  const counts = new Map<string, number>();
  let adminCount = 0;
  const ownerNames = new Map<string, string>();
  for (const s of sessions) {
    if (!s.ownerKeyId) {
      adminCount++;
      continue;
    }
    counts.set(s.ownerKeyId, (counts.get(s.ownerKeyId) ?? 0) + 1);
    if (s.ownerName && !ownerNames.has(s.ownerKeyId)) ownerNames.set(s.ownerKeyId, s.ownerName);
  }
  const rows: Array<{ value: string; name: string; role?: string }> = ownerCandidates(keys).map(k => ({
    value: k.id,
    name: k.name,
    role: k.role,
  }));
  const known = new Set(keys.map(k => k.id));
  for (const id of counts.keys()) {
    if (known.has(id)) {
      // An admin key that owns a session: listed too, so its sessions can be found.
      const key = keys.find(k => k.id === id);
      if (key && key.role === 'admin') rows.push({ value: id, name: key.name, role: key.role });
      continue;
    }
    rows.push({ value: id, name: ownerNames.get(id) ?? labels.unknown });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value));
  const count = (label: string, n: number) => `${label} (${n})`;
  return [
    { value: OWNER_ALL, label: count(labels.all, sessions.length) },
    { value: OWNER_ADMIN, label: count(labels.admin, adminCount) },
    ...rows.map(r => ({ value: r.value, label: count(withRole(r.name, r.role, labels), counts.get(r.value) ?? 0) })),
  ];
}

/**
 * Owner choices in the transfer dialog: Admin ('' = admin-owned), then every operator/viewer key with its
 * role. A current owner that is not among them (a deleted key) is kept, disabled, so the select shows it.
 */
export function ownerTransferOptions(
  keys: readonly OwnerKey[],
  currentOwnerId: string | null | undefined,
  labels: OwnerOptionLabels & { currentName?: string | null },
): OwnerOption[] {
  const options: OwnerOption[] = [
    { value: '', label: labels.admin },
    ...ownerCandidates(keys).map(k => ({ value: k.id, label: withRole(k.name, k.role, labels) })),
  ];
  if (currentOwnerId && !options.some(o => o.value === currentOwnerId)) {
    const key = keys.find(k => k.id === currentOwnerId);
    options.push({
      value: currentOwnerId,
      label: key ? withRole(key.name, key.role, labels) : (labels.currentName ?? labels.unknown),
      disabled: !key,
    });
  }
  return options;
}

/**
 * The session to keep selected once a picker's options narrow: the current one while it is still listed,
 * else the first listed one, else none ('').
 */
export function reconcileSessionSelection(listedIds: readonly string[], selected: string): string {
  if (selected && listedIds.includes(selected)) return selected;
  return listedIds[0] ?? '';
}

/** The owner badge text: the key's name, a fallback for a deleted key, or the admin label. */
export function ownerLabel(
  session: OwnedSession & { ownerName?: string | null },
  labels: { admin: string; unknown: string },
): string {
  if (!session.ownerKeyId) return labels.admin;
  return session.ownerName || labels.unknown;
}
