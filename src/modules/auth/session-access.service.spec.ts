import { ApiKeyRole } from './entities/api-key.entity';
import { NO_SESSIONS } from './session-access.service';
import { fakeSessionAccess } from '../../test-utils/fake-session-access';

describe('SessionAccessService.effectiveSessions', () => {
  const owners = { s1: 'op-a', s2: 'op-b', s3: null };
  const key = (id: string, role: ApiKeyRole, allowedSessions: string[] | null = null) => ({
    id,
    role,
    allowedSessions,
  });

  it('leaves an unscoped admin unrestricted, and a scoped admin to its allowlist alone', async () => {
    const access = fakeSessionAccess({ ...owners });
    await expect(access.effectiveSessions(key('adm', ApiKeyRole.ADMIN))).resolves.toBeNull();
    await expect(access.effectiveSessions(key('adm', ApiKeyRole.ADMIN, ['s2']))).resolves.toEqual(['s2']);
  });

  it('fences an operator to the sessions it owns', async () => {
    const access = fakeSessionAccess({ ...owners });
    await expect(access.effectiveSessions(key('op-a', ApiKeyRole.OPERATOR))).resolves.toEqual(['s1']);
  });

  it('fences an operator to owned ∪ assigned sessions', async () => {
    const access = fakeSessionAccess({ ...owners });
    const fence = await access.effectiveSessions(key('op-a', ApiKeyRole.OPERATOR, ['s3', 's1']));
    expect([...(fence ?? [])].sort()).toEqual(['s1', 's3']);
  });

  it('closes the fence of a key with nothing owned or assigned (never an empty, i.e. unrestricted, list)', async () => {
    const access = fakeSessionAccess({ ...owners });
    await expect(access.effectiveSessions(key('op-c', ApiKeyRole.OPERATOR))).resolves.toEqual([NO_SESSIONS]);
    await expect(access.effectiveSessions(key('v', ApiKeyRole.VIEWER))).resolves.toEqual([NO_SESSIONS]);
    await expect(access.effectiveSessions(key('v', ApiKeyRole.VIEWER, ['s2']))).resolves.toEqual(['s2']);
  });

  it("hands a released key's sessions back to admin ownership", async () => {
    const table: Record<string, string | null> = { ...owners };
    const access = fakeSessionAccess(table);
    await expect(access.releaseOwnedBy('op-a')).resolves.toBe(1);
    expect(table.s1).toBeNull();
    await expect(access.effectiveSessions(key('op-a', ApiKeyRole.OPERATOR))).resolves.toEqual([NO_SESSIONS]);
  });
});
