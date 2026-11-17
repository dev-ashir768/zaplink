import { HttpException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { BullBoardAuthMiddleware } from './bull-board-auth.middleware';
import { AuthService, UnresolvedApiKeyException } from '../../modules/auth/auth.service';
import { ApiKeyRole } from '../../modules/auth/entities/api-key.entity';
import { AuditService } from '../../modules/audit/audit.service';
import { AuditAction } from '../../modules/audit/entities/audit-log.entity';
import { KeyRateLimiter } from '../throttler/key-rate-limit';
import { allowUnauthenticatedAuditRow } from '../../modules/audit/auth-failure-audit-limiter';
import * as fs from 'fs';
import * as path from 'path';
import { runWithRequestId, getRequestActor } from '../services/request-context';

const res = {} as Response;

const reqFromIp = (ip: string, headers: Record<string, unknown> = {}): Request =>
  ({ headers, query: {}, ip, socket: { remoteAddress: ip } }) as unknown as Request;

describe('BullBoardAuthMiddleware', () => {
  let mw: BullBoardAuthMiddleware;
  let authService: { validateApiKey: jest.Mock; hasPermission: jest.Mock };
  let configService: { get: jest.Mock };

  const reqWith = (headers: Record<string, unknown> = {}, query: Record<string, unknown> = {}): Request =>
    ({ headers, query, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } }) as unknown as Request;

  beforeEach(() => {
    authService = { validateApiKey: jest.fn(), hasPermission: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) }; // no trusted proxies by default
    mw = new BullBoardAuthMiddleware(authService as unknown as AuthService, configService as unknown as ConfigService);
  });

  it('rejects when no API key is provided', async () => {
    const next = jest.fn();
    await mw.use(reqWith({}), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    expect(authService.validateApiKey).not.toHaveBeenCalled();
  });

  it('propagates an invalid-key rejection', async () => {
    authService.validateApiKey.mockRejectedValue(new UnauthorizedException('Invalid API key'));
    const next = jest.fn();
    await mw.use(reqWith({ 'x-api-key': 'bad' }), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
  });

  it('forbids a valid non-admin key', async () => {
    authService.validateApiKey.mockResolvedValue({ role: ApiKeyRole.OPERATOR });
    authService.hasPermission.mockReturnValue(false);
    const next = jest.fn();
    await mw.use(reqWith({ 'x-api-key': 'op' }), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
  });

  it('allows a valid ADMIN key via X-API-Key', async () => {
    authService.validateApiKey.mockResolvedValue({ role: ApiKeyRole.ADMIN });
    authService.hasPermission.mockReturnValue(true);
    const next = jest.fn();
    await mw.use(reqWith({ 'x-api-key': 'admin' }), res, next);
    expect(next).toHaveBeenCalledWith();
    expect(authService.validateApiKey).toHaveBeenCalledWith('admin', '127.0.0.1');
  });

  it('rejects an ADMIN key that is restricted to specific sessions', async () => {
    authService.validateApiKey.mockResolvedValue({
      id: 'key-1',
      name: 'scoped-admin',
      role: ApiKeyRole.ADMIN,
      allowedSessions: ['session-a'],
    });
    authService.hasPermission.mockReturnValue(true);

    const req = reqWith({ 'x-api-key': 'raw-key' });
    const next = jest.fn();

    await mw.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = (next.mock.calls as Array<Array<unknown>>)[0]?.[0];
    expect(forwarded).toBeInstanceOf(ForbiddenException);
    expect((forwarded as ForbiddenException).message).toContain('restricted');
  });

  it('rejects an ADMIN key that is restricted to specific chats', async () => {
    authService.validateApiKey.mockResolvedValue({
      id: 'key-chat',
      name: 'chat-scoped-admin',
      role: ApiKeyRole.ADMIN,
      allowedSessions: null,
      allowedChats: ['123@g.us'],
    });
    authService.hasPermission.mockReturnValue(true);

    const req = reqWith({ 'x-api-key': 'raw-key' });
    const next = jest.fn();

    await mw.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = (next.mock.calls as Array<Array<unknown>>)[0]?.[0];
    expect(forwarded).toBeInstanceOf(ForbiddenException);
    expect((forwarded as ForbiddenException).message).toContain('restricted to selected chats');
  });

  it('admits an ADMIN key with an empty allowedSessions list', async () => {
    authService.validateApiKey.mockResolvedValue({
      id: 'key-2',
      name: 'unscoped-admin',
      role: ApiKeyRole.ADMIN,
      allowedSessions: [],
    });
    authService.hasPermission.mockReturnValue(true);

    const next = jest.fn();
    await mw.use(reqWith({ 'x-api-key': 'raw-key' }), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('admits an ADMIN key with a null allowedSessions list', async () => {
    authService.validateApiKey.mockResolvedValue({
      id: 'key-3',
      name: 'null-scope-admin',
      role: ApiKeyRole.ADMIN,
      allowedSessions: null,
    });
    authService.hasPermission.mockReturnValue(true);

    const next = jest.fn();
    await mw.use(reqWith({ 'x-api-key': 'raw-key' }), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('accepts a Bearer token', async () => {
    authService.validateApiKey.mockResolvedValue({ role: ApiKeyRole.ADMIN });
    authService.hasPermission.mockReturnValue(true);

    await mw.use(reqWith({ authorization: 'Bearer abc' }), res, jest.fn());
    expect(authService.validateApiKey).toHaveBeenCalledWith('abc', '127.0.0.1');
  });

  it('accepts the Bearer scheme in any case', async () => {
    authService.validateApiKey.mockResolvedValue({ role: ApiKeyRole.ADMIN });
    authService.hasPermission.mockReturnValue(true);

    await mw.use(reqWith({ authorization: 'bearer abc' }), res, jest.fn());
    expect(authService.validateApiKey).toHaveBeenCalledWith('abc', '127.0.0.1');
  });

  it('honors X-Forwarded-For only behind a configured trusted proxy (allowedIps parity with the guard)', async () => {
    configService.get.mockReturnValue(['127.0.0.1']); // the socket peer is a trusted proxy
    authService.validateApiKey.mockResolvedValue({ role: ApiKeyRole.ADMIN });
    authService.hasPermission.mockReturnValue(true);

    await mw.use(reqWith({ 'x-api-key': 'admin', 'x-forwarded-for': '203.0.113.5' }), res, jest.fn());

    expect(authService.validateApiKey).toHaveBeenCalledWith('admin', '203.0.113.5');
  });

  it('ignores a spoofed X-Forwarded-For when no trusted proxy is configured (uses the socket address)', async () => {
    configService.get.mockReturnValue([]); // no trusted proxies — XFF is attacker-controlled
    authService.validateApiKey.mockResolvedValue({ role: ApiKeyRole.ADMIN });
    authService.hasPermission.mockReturnValue(true);

    await mw.use(reqWith({ 'x-api-key': 'admin', 'x-forwarded-for': '203.0.113.5' }), res, jest.fn());

    expect(authService.validateApiKey).toHaveBeenCalledWith('admin', '127.0.0.1');
  });

  it('rejects an ?apiKey query param (no key in the URL)', async () => {
    const next = jest.fn();
    await mw.use(reqWith({}, { apiKey: 'qkey' }), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    expect(authService.validateApiKey).not.toHaveBeenCalled();
  });
});

// Bull Board is raw Express middleware (outside the Nest guard pipeline) and previously had no pre-auth
// throttle, so a flood of login attempts reached the validateApiKey DB lookup unbounded. The throttle
// mirrors MCP's createIpThrottle: a per-IP sliding window checked BEFORE the credential check.
describe('BullBoardAuthMiddleware pre-auth IP throttle (mirrors MCP createIpThrottle)', () => {
  let authService: { validateApiKey: jest.Mock; hasPermission: jest.Mock };
  let configService: { get: jest.Mock };
  const res = {} as Response;

  beforeEach(() => {
    authService = { validateApiKey: jest.fn(), hasPermission: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };
  });

  const adminMw = (ipLimit: number): BullBoardAuthMiddleware => {
    authService.validateApiKey.mockResolvedValue({ role: ApiKeyRole.ADMIN });
    authService.hasPermission.mockReturnValue(true);
    return new BullBoardAuthMiddleware(
      authService as unknown as AuthService,
      configService as unknown as ConfigService,
      undefined, // no audit service needed for the throttle tests
      new KeyRateLimiter(ipLimit, 60_000),
    );
  };

  // Typed extractor for the first argument passed to a next() mock (avoids unsafe any member access).
  const firstNextArg = (mock: jest.Mock): unknown => (mock.mock.calls as Array<Array<unknown>>)[0]?.[0];

  it('N allowed, the (N+1)th from the same IP rejected with 429 (validateApiKey not reached)', async () => {
    const mw = adminMw(3);
    const headers = { 'x-api-key': 'admin' };

    // 3 allowed
    for (let i = 0; i < 3; i++) {
      const next = jest.fn();
      await mw.use(reqFromIp('198.51.100.4', headers), res, next);
      expect(next).toHaveBeenCalledWith(); // no error
    }
    expect(authService.validateApiKey).toHaveBeenCalledTimes(3);

    // 4th from the same IP → throttled before the credential check
    const next = jest.fn();
    await mw.use(reqFromIp('198.51.100.4', headers), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpException));
    expect((firstNextArg(next) as HttpException).getStatus()).toBe(429);
    // The throttled request never reached the DB lookup
    expect(authService.validateApiKey).toHaveBeenCalledTimes(3);
  });

  it('a second IP has an independent bucket', async () => {
    const mw = adminMw(2);
    const headers = { 'x-api-key': 'admin' };

    // Exhaust the bucket for 198.51.100.4
    for (let i = 0; i < 2; i++) {
      await mw.use(reqFromIp('198.51.100.4', headers), res, jest.fn());
    }
    const throttledNext = jest.fn();
    await mw.use(reqFromIp('198.51.100.4', headers), res, throttledNext);
    expect(firstNextArg(throttledNext)).toBeInstanceOf(HttpException);

    // A different IP is unaffected
    const otherNext = jest.fn();
    await mw.use(reqFromIp('203.0.113.9', headers), res, otherNext);
    expect(otherNext).toHaveBeenCalledWith(); // allowed
    expect(authService.validateApiKey).toHaveBeenCalledWith('admin', '203.0.113.9');
  });

  it('buckets an IPv6 client on its /64 but validates the key against the full address', async () => {
    const mw = adminMw(1);
    const headers = { 'x-api-key': 'admin' };
    const first = jest.fn();
    await mw.use(reqFromIp('2001:db8:1:2::a', headers), res, first);
    expect(first).toHaveBeenCalledWith();
    expect(authService.validateApiKey).toHaveBeenCalledWith('admin', '2001:db8:1:2::a');

    const sameSubnet = jest.fn();
    await mw.use(reqFromIp('2001:db8:1:2::b', headers), res, sameSubnet);
    expect((firstNextArg(sameSubnet) as HttpException).getStatus()).toBe(429);

    const otherSubnet = jest.fn();
    await mw.use(reqFromIp('2001:db8:1:3::a', headers), res, otherSubnet);
    expect(otherSubnet).toHaveBeenCalledWith();
  });

  it('a missing key still consumes a throttle slot (pre-auth gate fires first)', async () => {
    const mw = adminMw(1);
    // First request: no key → Unauthorized, but the throttle slot is consumed (check runs before extractKey).
    const next1 = jest.fn();
    await mw.use(reqFromIp('198.51.100.4', {}), res, next1);
    expect(firstNextArg(next1)).toBeInstanceOf(UnauthorizedException);

    // Second request WITH a valid key from the same IP → throttled (bucket already exhausted by #1)
    const next2 = jest.fn();
    await mw.use(reqFromIp('198.51.100.4', { 'x-api-key': 'admin' }), res, next2);
    expect(firstNextArg(next2)).toBeInstanceOf(HttpException);
    expect((firstNextArg(next2) as HttpException).getStatus()).toBe(429);
  });

  it('the default limiter (no injection) is generous — legit operator usage is never throttled', async () => {
    // Mirrors production wiring (main.ts constructs with 2 args → MCP IP-rate-limit policy, 120/60s).
    // A single legit admin request passes; the bucket is shared across all existing happy-path tests
    // (each uses a fresh middleware instance), proving the default is wired and non-blocking.
    const defaultMw = new BullBoardAuthMiddleware(
      authService as unknown as AuthService,
      configService as unknown as ConfigService,
    );
    authService.validateApiKey.mockResolvedValue({ role: ApiKeyRole.ADMIN });
    authService.hasPermission.mockReturnValue(true);
    const next = jest.fn();
    await defaultMw.use(reqFromIp('203.0.113.9', { 'x-api-key': 'admin' }), res, next);
    expect(next).toHaveBeenCalledWith(); // allowed
  });
});

// The Bull Board mount is raw Express, so the Nest guard's audit trail never sees it. The middleware
// now mirrors it at the boundary: 401/403 → WARN API_KEY_AUTH_FAILED; an authenticated non-GET/HEAD
// request → INFO QUEUE_BOARD_MUTATED. A throttled 429 is NOT audited — the pre-auth IP limiter is the
// flood bound for both the credential check and the audit table.
describe('BullBoardAuthMiddleware audit trail', () => {
  let mw: BullBoardAuthMiddleware;
  let authService: { validateApiKey: jest.Mock; hasPermission: jest.Mock };
  let auditService: { logWarn: jest.Mock; logInfo: jest.Mock };
  const res = {} as Response;

  const adminKey = { id: 'key-1', name: 'Admin', role: ApiKeyRole.ADMIN };

  const reqFor = (
    method: string,
    headers: Record<string, unknown> = {},
    originalUrl = '/api/admin/queues/api/queues/webhookQueue/1/retry',
  ): Request =>
    ({
      headers,
      query: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      method,
      originalUrl,
      url: originalUrl,
    }) as unknown as Request;

  beforeEach(() => {
    authService = { validateApiKey: jest.fn(), hasPermission: jest.fn() };
    auditService = { logWarn: jest.fn(), logInfo: jest.fn() };
    const configService = { get: jest.fn().mockReturnValue(undefined) };
    mw = new BullBoardAuthMiddleware(
      authService as unknown as AuthService,
      configService as unknown as ConfigService,
      auditService as unknown as AuditService,
    );
  });

  it('audits a 401 (missing key) with IP, method and path', async () => {
    const next = jest.fn();
    await mw.use(reqFor('GET', {}, '/api/admin/queues/'), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    expect(auditService.logWarn).toHaveBeenCalledWith(
      AuditAction.API_KEY_AUTH_FAILED,
      expect.objectContaining({
        ipAddress: '127.0.0.1',
        method: 'GET',
        path: '/api/admin/queues/',
        errorMessage: 'API key is required to access the queue dashboard',
      }),
    );
  });

  it('audits a 401 (invalid key) rejection from validateApiKey', async () => {
    authService.validateApiKey.mockRejectedValue(new UnauthorizedException('Invalid API key'));
    const next = jest.fn();
    await mw.use(reqFor('GET', { 'x-api-key': 'bad' }, '/api/admin/queues/'), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    expect(auditService.logWarn).toHaveBeenCalledWith(
      AuditAction.API_KEY_AUTH_FAILED,
      expect.objectContaining({ errorMessage: 'Invalid API key' }),
    );
  });

  it('audits a 403 (valid non-admin key)', async () => {
    authService.validateApiKey.mockResolvedValue({ role: ApiKeyRole.OPERATOR });
    authService.hasPermission.mockReturnValue(false);
    const next = jest.fn();
    await mw.use(reqFor('GET', { 'x-api-key': 'op' }, '/api/admin/queues/'), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
    expect(auditService.logWarn).toHaveBeenCalledWith(
      AuditAction.API_KEY_AUTH_FAILED,
      expect.objectContaining({ errorMessage: 'Admin role required to access the queue dashboard' }),
    );
  });

  it('strips the query string from the audited path', async () => {
    const next = jest.fn();
    await mw.use(reqFor('GET', {}, '/api/admin/queues/?foo=bar'), res, next);

    expect(auditService.logWarn).toHaveBeenCalledWith(
      AuditAction.API_KEY_AUTH_FAILED,
      expect.objectContaining({ path: '/api/admin/queues/' }),
    );
  });

  it('audits an authenticated non-GET request as a queue-board mutation with the actor key and method+path', async () => {
    authService.validateApiKey.mockResolvedValue(adminKey);
    authService.hasPermission.mockReturnValue(true);
    const next = jest.fn();
    await mw.use(reqFor('POST', { 'x-api-key': 'admin' }), res, next);

    expect(next).toHaveBeenCalledWith(); // allowed through
    expect(auditService.logInfo).toHaveBeenCalledWith(
      AuditAction.QUEUE_BOARD_MUTATED,
      expect.objectContaining({
        apiKey: adminKey,
        ipAddress: '127.0.0.1',
        method: 'POST',
        path: '/api/admin/queues/api/queues/webhookQueue/1/retry',
      }),
    );
    expect(auditService.logWarn).not.toHaveBeenCalled();
  });

  it('does not audit GET or HEAD requests (read/poll traffic)', async () => {
    authService.validateApiKey.mockResolvedValue(adminKey);
    authService.hasPermission.mockReturnValue(true);

    await mw.use(reqFor('GET', { 'x-api-key': 'admin' }, '/api/admin/queues/'), res, jest.fn());
    await mw.use(reqFor('HEAD', { 'x-api-key': 'admin' }, '/api/admin/queues/'), res, jest.fn());

    expect(auditService.logInfo).not.toHaveBeenCalled();
    expect(auditService.logWarn).not.toHaveBeenCalled();
  });

  it('does not audit a throttled 429 — the pre-auth IP limiter is the flood bound', async () => {
    const tightMw = new BullBoardAuthMiddleware(
      authService as unknown as AuthService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      auditService as unknown as AuditService,
      new KeyRateLimiter(1, 60_000),
    );
    authService.validateApiKey.mockResolvedValue(adminKey);
    authService.hasPermission.mockReturnValue(true);

    await tightMw.use(reqFor('GET', { 'x-api-key': 'admin' }, '/api/admin/queues/'), res, jest.fn()); // consumes the slot
    const next = jest.fn();
    await tightMw.use(reqFor('GET', { 'x-api-key': 'admin' }, '/api/admin/queues/'), res, next); // throttled

    expect(next).toHaveBeenCalledWith(expect.any(HttpException));
    expect(auditService.logWarn).not.toHaveBeenCalled();
    expect(auditService.logInfo).not.toHaveBeenCalled();
  });

  // Unauthenticated rows are bounded per client IP, on a budget shared with the REST guard. These
  // tests use IPs no other test in this file uses, since the budget is a module-level singleton.
  it('writes at most 10 unauthenticated rows a minute for one IP, while every request still gets its 401', async () => {
    const fromIp = (ip: string): Request =>
      ({ ...reqFor('GET', {}, '/api/admin/queues/'), ip, socket: { remoteAddress: ip } }) as unknown as Request;
    const next = jest.fn();
    for (let i = 0; i < 50; i++) await mw.use(fromIp('198.51.100.81'), res, next);

    expect(next).toHaveBeenCalledTimes(50);
    for (const [err] of next.mock.calls as Array<[unknown]>) expect(err).toBeInstanceOf(UnauthorizedException);
    expect(auditService.logWarn).toHaveBeenCalledTimes(10);

    await mw.use(fromIp('198.51.100.82'), res, jest.fn());
    expect(auditService.logWarn).toHaveBeenCalledTimes(11);
    expect(auditService.logWarn).toHaveBeenLastCalledWith(
      AuditAction.API_KEY_AUTH_FAILED,
      expect.objectContaining({ ipAddress: '198.51.100.82' }),
    );
  });

  it('shares the unauthenticated budget with the REST guard and still records a 403', async () => {
    // Ten rows already written for this IP by the REST guard.
    for (let i = 0; i < 10; i++) expect(allowUnauthenticatedAuditRow('198.51.100.83')).toBe(true);
    const fromIp = (headers: Record<string, unknown>): Request =>
      ({
        ...reqFor('GET', headers, '/api/admin/queues/'),
        ip: '198.51.100.83',
        socket: { remoteAddress: '198.51.100.83' },
      }) as unknown as Request;

    await mw.use(fromIp({}), res, jest.fn());
    expect(auditService.logWarn).not.toHaveBeenCalled();

    authService.validateApiKey.mockResolvedValue({ role: ApiKeyRole.OPERATOR });
    authService.hasPermission.mockReturnValue(false);
    const next = jest.fn();
    await mw.use(fromIp({ 'x-api-key': 'op' }), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
    expect(auditService.logWarn).toHaveBeenCalledTimes(1);
  });

  it('still records a rejected stored key from an IP whose budget is spent, but not an unknown one', async () => {
    for (let i = 0; i < 10; i++) expect(allowUnauthenticatedAuditRow('198.51.100.84')).toBe(true);
    const fromIp = (): Request =>
      ({
        ...reqFor('GET', { 'x-api-key': 'k' }, '/api/admin/queues/'),
        ip: '198.51.100.84',
        socket: { remoteAddress: '198.51.100.84' },
      }) as unknown as Request;

    authService.validateApiKey.mockRejectedValue(new UnresolvedApiKeyException('Invalid API key'));
    await mw.use(fromIp(), res, jest.fn());
    expect(auditService.logWarn).not.toHaveBeenCalled();

    authService.validateApiKey.mockRejectedValue(new UnauthorizedException('API key is revoked'));
    const next = jest.fn();
    await mw.use(fromIp(), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    expect(auditService.logWarn).toHaveBeenCalledWith(
      AuditAction.API_KEY_AUTH_FAILED,
      expect.objectContaining({ ipAddress: '198.51.100.84', errorMessage: 'API key is revoked' }),
    );
  });

  it('degrades gracefully when no audit service is provided (rejections still work)', async () => {
    const noAuditMw = new BullBoardAuthMiddleware(
      authService as unknown as AuthService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );
    const next = jest.fn();
    await noAuditMw.use(reqFor('GET', {}, '/api/admin/queues/'), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
  });
});

/**
 * The queue dashboard is the most privileged UI in the deployment, and its two post-authentication
 * denials wrote an audit row with no credential on it — the same gap ApiKeyGuard had. The fix stamps
 * the resolved actor before those checks, and it works only because requestContextMiddleware is
 * installed ahead of this mount in main.ts. Both halves are pinned here: the stamp, and the ordering
 * it silently depends on.
 */
describe('a queue-dashboard denial is attributable to the credential', () => {
  const denialActor = async (apiKey: Record<string, unknown>, hasPermission: boolean) => {
    const authService = {
      validateApiKey: jest.fn().mockResolvedValue(apiKey),
      hasPermission: jest.fn().mockReturnValue(hasPermission),
    };
    const mw = new BullBoardAuthMiddleware(
      authService as unknown as AuthService,
      { get: () => undefined } as unknown as ConfigService,
    );
    const req = {
      headers: { 'x-api-key': 'k' },
      query: {},
      method: 'GET',
      originalUrl: '/api/admin/queues',
      ip: '203.0.113.44',
      socket: { remoteAddress: '203.0.113.44' },
    } as unknown as Request;
    const next = jest.fn();
    let actor: ReturnType<typeof getRequestActor>;
    await runWithRequestId('req-1', async () => {
      await mw.use(req, {} as Response, next);
      actor = getRequestActor();
    });
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
    return actor;
  };

  it('stamps the key when the role is insufficient', async () => {
    const actor = await denialActor({ id: 'key-1', name: 'Ops key', allowedSessions: [] }, false);
    expect(actor).toMatchObject({ apiKeyId: 'key-1', apiKeyName: 'Ops key' });
  });

  it('stamps the key when a session-scoped key is refused', async () => {
    const actor = await denialActor({ id: 'key-2', name: 'Tenant A', allowedSessions: ['s1'] }, true);
    expect(actor).toMatchObject({ apiKeyId: 'key-2', apiKeyName: 'Tenant A' });
  });

  // The stamp is a no-op outside a request-context scope, so the mount order in main.ts is load
  // bearing. Nothing else binds it; a reordering would silently return the null rows this fixed.
  it('keeps requestContextMiddleware installed ahead of the queue-dashboard mount', () => {
    // The guarantee now spans two files: configure-app.ts installs the middleware, and main.ts
    // calls it before mounting the board. Reading only one of them would leave half the order
    // unbound.
    const read = (...parts: string[]): string => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
    expect(read('configure-app.ts')).toContain('app.use(requestContextMiddleware)');

    const main = read('main.ts');
    const configureAt = main.indexOf('configureApp(app)');
    const boardAt = main.indexOf('new BullBoardAuthMiddleware');
    expect(configureAt).toBeGreaterThan(-1);
    expect(boardAt).toBeGreaterThan(-1);
    expect(configureAt).toBeLessThan(boardAt);
  });
});

// The dashboard trades its ADMIN header key for a short-lived HttpOnly cookie (POST /session) so the board opens
// in a plain browser tab. The cookie carries no key, and every request re-reads the key it names.
describe('BullBoardAuthMiddleware board session cookie', () => {
  const ADMIN = { id: 'key-1', name: 'admin', role: ApiKeyRole.ADMIN, isActive: true, expiresAt: null };
  let mw: BullBoardAuthMiddleware;
  let authService: { validateApiKey: jest.Mock; hasPermission: jest.Mock; findOne: jest.Mock };
  let audit: { logInfo: jest.Mock; logWarn: jest.Mock };

  const response = () => {
    const r = { append: jest.fn(), status: jest.fn(), end: jest.fn() };
    r.status.mockReturnValue(r);
    return r;
  };
  const request = (init: { method?: string; path?: string; headers?: Record<string, unknown>; ip?: string } = {}) =>
    ({
      method: init.method ?? 'GET',
      path: init.path ?? '/',
      originalUrl: `/api/admin/queues${init.path ?? '/'}`,
      headers: init.headers ?? {},
      query: {},
      ip: init.ip ?? '127.0.0.1',
      socket: { remoteAddress: init.ip ?? '127.0.0.1' },
      secure: false,
    }) as unknown as Request;

  /** Issues a session with the admin header key and returns the cookie pair (name=value). */
  const issue = async (): Promise<string> => {
    const r = response();
    const next = jest.fn();
    await mw.use(
      request({ method: 'POST', path: '/session', headers: { 'x-api-key': 'raw-admin' } }),
      r as never,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(204);
    const header = (r.append.mock.calls as unknown[][])[0][1] as string;
    return header.split(';')[0];
  };

  beforeEach(() => {
    authService = {
      validateApiKey: jest.fn().mockResolvedValue(ADMIN),
      hasPermission: jest.fn((key: { role: ApiKeyRole }) => key.role === ApiKeyRole.ADMIN),
      findOne: jest.fn().mockResolvedValue(ADMIN),
    };
    audit = { logInfo: jest.fn().mockResolvedValue(undefined), logWarn: jest.fn().mockResolvedValue(undefined) };
    mw = new BullBoardAuthMiddleware(
      authService as unknown as AuthService,
      { get: jest.fn() } as unknown as ConfigService,
      audit as unknown as AuditService,
    );
  });

  it('issues an HttpOnly, SameSite=Strict cookie scoped to the board that holds no key, and audits it', async () => {
    const r = response();
    await mw.use(
      request({ method: 'POST', path: '/session', headers: { 'x-api-key': 'raw-admin' } }),
      r as never,
      jest.fn(),
    );
    const header = (r.append.mock.calls as unknown[][])[0][1] as string;
    expect(header).toMatch(
      /^zaplink_queue_board=[\w-]+\.[\w-]+; Path=\/api\/admin\/queues; Max-Age=1800; HttpOnly; SameSite=Strict$/,
    );
    expect(header).not.toContain('raw-admin');
    expect(audit.logInfo).toHaveBeenCalledWith(
      AuditAction.QUEUE_BOARD_SESSION_ISSUED,
      expect.objectContaining({ apiKey: ADMIN }),
    );
  });

  it('refuses to issue a session to a non-admin key', async () => {
    authService.validateApiKey.mockResolvedValue({ ...ADMIN, role: ApiKeyRole.OPERATOR });
    const r = response();
    const next = jest.fn();
    await mw.use(request({ method: 'POST', path: '/session', headers: { 'x-api-key': 'op' } }), r as never, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
    expect(r.append).not.toHaveBeenCalled();
  });

  it('accepts a valid cookie without a header key and renews it', async () => {
    const cookie = await issue();
    const r = response();
    const next = jest.fn();
    await mw.use(request({ headers: { cookie: `other=1; ${cookie}` } }), r as never, next);
    expect(next).toHaveBeenCalledWith();
    expect(authService.findOne).toHaveBeenCalledWith('key-1');
    expect(r.append).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('zaplink_queue_board='));
  });

  it.each([
    ['a forged signature', (c: string) => `${c.slice(0, -2)}xx`],
    ['a tampered payload', (c: string) => c.replace('=', '=e')],
  ])('rejects %s', async (_label, mutate) => {
    const cookie = mutate(await issue());
    const next = jest.fn();
    await mw.use(request({ headers: { cookie } }), response() as never, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
  });

  it('rejects an expired cookie', async () => {
    const cookie = await issue();
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000);
    try {
      const next = jest.fn();
      await mw.use(request({ headers: { cookie } }), response() as never, next);
      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    } finally {
      now.mockRestore();
    }
  });

  it('rejects a cookie presented from another IP', async () => {
    const cookie = await issue();
    const next = jest.fn();
    await mw.use(request({ headers: { cookie }, ip: '10.0.0.9' }), response() as never, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
  });

  it.each([
    ['revoked', () => authService.findOne.mockResolvedValue({ ...ADMIN, isActive: false })],
    ['deleted', () => authService.findOne.mockRejectedValue(new Error('not found'))],
    ['expired', () => authService.findOne.mockResolvedValue({ ...ADMIN, expiresAt: new Date(Date.now() - 1000) })],
  ])('rejects the cookie of a key %s after it was issued', async (_label, change) => {
    const cookie = await issue();
    change();
    const next = jest.fn();
    await mw.use(request({ headers: { cookie } }), response() as never, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
  });

  it('forbids the cookie of a key demoted from admin', async () => {
    const cookie = await issue();
    authService.findOne.mockResolvedValue({ ...ADMIN, role: ApiKeyRole.OPERATOR });
    const next = jest.fn();
    await mw.use(request({ headers: { cookie } }), response() as never, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
  });

  it('does not let a cookie mint another session', async () => {
    const cookie = await issue();
    audit.logInfo.mockClear();
    const r = response();
    const next = jest.fn();
    await mw.use(request({ method: 'POST', path: '/session', headers: { cookie } }), r as never, next);
    expect(r.status).not.toHaveBeenCalled();
    expect(audit.logInfo).not.toHaveBeenCalledWith(AuditAction.QUEUE_BOARD_SESSION_ISSUED, expect.anything());
  });
});

describe('BullBoardAuthMiddleware username/password login', () => {
  const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  const makeMw = (settings: Record<string, string | undefined>) => {
    const configService = { get: jest.fn((key: string) => settings[key]) };
    const authService = { validateApiKey: jest.fn(), hasPermission: jest.fn(), findOne: jest.fn() };
    return {
      authService,
      mw: new BullBoardAuthMiddleware(authService as unknown as AuthService, configService as unknown as ConfigService),
    };
  };
  const call = async (mw: BullBoardAuthMiddleware, headers: Record<string, unknown>, method = 'GET') => {
    const setHeader = jest.fn();
    const next = jest.fn();
    const req = {
      headers,
      query: {},
      method,
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.1' },
    } as unknown as Request;
    await mw.use(req, { setHeader } as unknown as Response, next);
    return { next, setHeader };
  };

  it('lets the right username and password through without an API key', async () => {
    const { mw, authService } = makeMw({ BULL_BOARD_USERNAME: 'ops', BULL_BOARD_PASSWORD: 's3cret-pass' });
    const { next } = await call(mw, { authorization: basic('ops', 's3cret-pass') });
    expect(next).toHaveBeenCalledWith();
    expect(authService.validateApiKey).not.toHaveBeenCalled();
  });

  it('defaults the username to admin', async () => {
    const { mw } = makeMw({ BULL_BOARD_PASSWORD: 's3cret-pass' });
    const { next } = await call(mw, { authorization: basic('admin', 's3cret-pass') });
    expect(next).toHaveBeenCalledWith();
  });

  it.each([
    ['wrong password', basic('ops', 'nope')],
    ['wrong username', basic('other', 's3cret-pass')],
    ['no colon', `Basic ${Buffer.from('ops').toString('base64')}`],
  ])('rejects a %s and asks the browser for a login', async (_label, header) => {
    const { mw } = makeMw({ BULL_BOARD_USERNAME: 'ops', BULL_BOARD_PASSWORD: 's3cret-pass' });
    const { next, setHeader } = await call(mw, { authorization: header });
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    expect(setHeader).toHaveBeenCalledWith('WWW-Authenticate', expect.stringContaining('Basic'));
  });

  it('asks for a login when no credential is sent', async () => {
    const { mw } = makeMw({ BULL_BOARD_PASSWORD: 's3cret-pass' });
    const { next, setHeader } = await call(mw, {});
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    expect(setHeader).toHaveBeenCalledWith('WWW-Authenticate', expect.stringContaining('Basic'));
  });

  it('is off when no password is configured: no prompt, Basic credentials refused', async () => {
    const { mw } = makeMw({ BULL_BOARD_USERNAME: 'admin', BULL_BOARD_PASSWORD: '  ' });
    const { next, setHeader } = await call(mw, { authorization: basic('admin', '') });
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    expect(setHeader).not.toHaveBeenCalled();
  });
});
