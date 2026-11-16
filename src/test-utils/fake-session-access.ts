import { SessionAccessService } from '../modules/auth/session-access.service';

/**
 * A SessionAccessService over an in-memory sessions table: `owners` maps a session id to the key id
 * that owns it (null = admin-owned). The fence logic under test is the real one.
 */
export function fakeSessionAccess(owners: Record<string, string | null> = {}): SessionAccessService {
  const repo = {
    find: ({ where }: { where: { ownerKeyId?: string } }) =>
      Promise.resolve(
        Object.entries(owners)
          .filter(([, owner]) => where.ownerKeyId === undefined || owner === where.ownerKeyId)
          .map(([id]) => ({ id })),
      ),
    update: (where: { id?: string; ownerKeyId?: string }, patch: { ownerKeyId: string | null }) => {
      let affected = 0;
      for (const [id, owner] of Object.entries(owners)) {
        if (
          (where.id !== undefined && where.id === id) ||
          (where.ownerKeyId !== undefined && owner === where.ownerKeyId)
        ) {
          owners[id] = patch.ownerKeyId;
          affected++;
        }
      }
      return Promise.resolve({ affected });
    },
  };
  return new SessionAccessService(repo as never);
}
