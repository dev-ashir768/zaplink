import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '../session/entities/session.entity';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import { normalizeScopeList } from './api-key-authorization';

/**
 * A session id no session can carry (the nil UUID; POST /sessions refuses it). A non-admin key whose
 * fence is empty gets `[NO_SESSIONS]` rather than `[]`, because every enforcement site reads an empty
 * list as "unrestricted": the sentinel keeps the fence closed through all of them unchanged.
 */
export const NO_SESSIONS = '00000000-0000-0000-0000-000000000000';

/** The stored allowlist behind each effective-scope copy, for the few readers that need the row's own value. */
const storedScopes = new WeakMap<object, string[] | null>();

/**
 * The key's STORED allowedSessions, also when `key` is the guard's effective-scope copy. Used where the
 * question is "is this key restricted by its row" (the @RequireUnscopedKey routes, POST /auth/validate's
 * `scoped`), as opposed to "which sessions may it reach".
 */
export function storedAllowedSessions(key: Pick<ApiKey, 'allowedSessions'>): string[] | null {
  return storedScopes.has(key) ? (storedScopes.get(key) ?? null) : key.allowedSessions;
}

export type SessionScopeKey = Pick<ApiKey, 'id' | 'role' | 'allowedSessions'>;

/**
 * The single source of a key's session fence ("effective sessions").
 *
 *  - ADMIN: its allowedSessions when it has one (a scoped admin), otherwise null = unrestricted.
 *  - OPERATOR / VIEWER: always fenced, to allowedSessions ∪ the sessions it owns (sessions.ownerKeyId).
 *    An empty fence is `[NO_SESSIONS]`, never null.
 *
 * Ownership is read from the database on every call (the ApiKeyGuard calls once per request and keeps
 * the result on the request), so a transfer or a key deletion applies to the very next request.
 */
@Injectable()
export class SessionAccessService {
  constructor(
    @InjectRepository(Session, 'data')
    private readonly sessionRepository: Repository<Session>,
  ) {}

  async effectiveSessions(key: SessionScopeKey | null | undefined): Promise<string[] | null> {
    if (!key) return null;
    const assigned = normalizeScopeList(key.allowedSessions) ?? [];
    if (key.role === ApiKeyRole.ADMIN) return assigned.length > 0 ? assigned : null;
    const owned = await this.sessionRepository.find({ select: { id: true }, where: { ownerKeyId: key.id } });
    const all = [...new Set([...assigned, ...owned.map(s => s.id)])];
    return all.length > 0 ? all : [NO_SESSIONS];
  }

  /**
   * A copy of `key` whose allowedSessions is its effective fence, for the request-scoped surfaces that
   * read `apiKey.allowedSessions` (resolveSessionScope, sessionScopeVisible, service findAll filters).
   * The stored row is never written with it.
   */
  withEffectiveScope<T extends SessionScopeKey>(key: T, effective: string[] | null): T {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(key) as object) as T, key);
    storedScopes.set(copy, key.allowedSessions);
    copy.allowedSessions = effective;
    return copy;
  }

  /** How many sessions each key owns; keys owning none are absent. */
  async ownedCounts(keyIds?: string[]): Promise<Map<string, number>> {
    const qb = this.sessionRepository
      .createQueryBuilder('s')
      .select('s.ownerKeyId', 'ownerKeyId')
      .addSelect('COUNT(*)', 'count')
      .where('s.ownerKeyId IS NOT NULL')
      .groupBy('s.ownerKeyId');
    if (keyIds) {
      if (keyIds.length === 0) return new Map();
      qb.andWhere('s.ownerKeyId IN (:...keyIds)', { keyIds });
    }
    const rows = await qb.getRawMany<{ ownerKeyId: string; count: string | number }>();
    return new Map(rows.map(r => [r.ownerKeyId, Number(r.count)]));
  }

  /** Hand a key's sessions back to the admins (ownerKeyId NULL). Returns how many moved. */
  async releaseOwnedBy(keyId: string): Promise<number> {
    const result = await this.sessionRepository.update({ ownerKeyId: keyId }, { ownerKeyId: null });
    return result.affected ?? 0;
  }

  async setOwner(sessionId: string, ownerKeyId: string | null): Promise<void> {
    await this.sessionRepository.update({ id: sessionId }, { ownerKeyId });
  }
}
