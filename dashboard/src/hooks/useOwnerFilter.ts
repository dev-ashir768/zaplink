import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRole } from './useRole';
import { useApiKeysQuery } from './queries';
import {
  filterSessionsByOwner,
  ownerFilterOptions,
  ownerTransferOptions,
  reconcileSessionSelection,
  OWNER_ALL,
  OWNER_PARAM,
  type OwnedSession,
  type OwnerOption,
} from '../utils/sessionOwner';

const NO_SESSIONS: ReadonlyArray<OwnedSession> = [];

function readOwnerParam(): string {
  try {
    return new URLSearchParams(window.location.search).get(OWNER_PARAM) ?? OWNER_ALL;
  } catch {
    return OWNER_ALL;
  }
}

/**
 * The admin owner filter, shared by every page that lists or picks sessions. Persisted in the URL
 * (`?owner=`) with history.replaceState, so a reload or a shared link keeps it without depending on a router
 * context. Only an unscoped admin gets one; for every other key `enabled` is false and the filter reads as
 * "all" (the API already fenced the list). The options come from the API key list (every operator and viewer
 * key, with or without sessions) and `sessions`, the page's own session list (the per-owner counts, and owners
 * whose key is gone); the hook reads no list of its own.
 */
export function useOwnerFilter(sessions: ReadonlyArray<OwnedSession & { ownerName?: string | null }> = NO_SESSIONS) {
  const { t } = useTranslation();
  const { isAdmin, scoped } = useRole();
  const enabled = isAdmin && !scoped;
  const [value, setValue] = useState(readOwnerParam);
  const { data: keys = [] } = useApiKeysQuery(enabled);
  const setOwner = useCallback((next: string) => {
    setValue(next || OWNER_ALL);
    try {
      const url = new URL(window.location.href);
      if (!next || next === OWNER_ALL) url.searchParams.delete(OWNER_PARAM);
      else url.searchParams.set(OWNER_PARAM, next);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // No URL to persist into (a test DOM without a location): the filter still works for this view.
    }
  }, []);
  const owner = enabled ? value : OWNER_ALL;

  const labels = useMemo(
    () => ({
      all: t('owner.filter.all'),
      admin: t('owner.admin'),
      unknown: t('owner.unknown'),
      role: (role: string) => (role === 'operator' || role === 'viewer' ? t(`owner.role.${role}`) : ''),
    }),
    [t],
  );

  const options = useMemo<OwnerOption[]>(() => {
    if (!enabled) return [];
    const list = ownerFilterOptions(keys, sessions, labels);
    // A key id from an old link that no longer exists still shows, rather than an empty select.
    if (!list.some(o => o.value === owner)) list.push({ value: owner, label: `${labels.unknown} (0)` });
    return list;
  }, [enabled, keys, sessions, labels, owner]);

  const transferOptions = useCallback(
    (session: OwnedSession & { ownerName?: string | null }) =>
      ownerTransferOptions(keys, session.ownerKeyId, { ...labels, currentName: session.ownerName }),
    [keys, labels],
  );

  const filter = useCallback(
    <T extends OwnedSession>(list: readonly T[]): T[] => filterSessionsByOwner(list, owner),
    [owner],
  );

  return { enabled, owner, setOwner, keys, options, transferOptions, filter };
}

export type OwnerFilterState = ReturnType<typeof useOwnerFilter>;

/**
 * Keeps a session picker's selection inside its (owner-narrowed) options: when the selected session is no
 * longer listed, the first listed one is selected, or none.
 */
export function useReconcileSessionSelection(
  listedIds: readonly string[],
  selected: string,
  setSelected: (id: string) => void,
  active = true,
): void {
  const key = listedIds.join('\u0000');
  useEffect(() => {
    if (!active) return;
    const next = reconcileSessionSelection(listedIds, selected);
    if (next !== selected) setSelected(next);
    // listedIds is read through its joined key, so a new array with the same ids does not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, selected, setSelected, active]);
}
