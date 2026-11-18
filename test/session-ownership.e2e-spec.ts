import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { dataOf } from './helpers/envelope';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { applyGlobalValidation } from './../src/config/app-validation';
import { AuthService } from './../src/modules/auth/auth.service';
import { ApiKeyRole } from './../src/modules/auth/entities/api-key.entity';

/**
 * Session ownership, through the real HTTP stack: two operators each create a session and see only
 * their own (list, get, messages, webhooks, templates, stats); the admin sees both and filters by
 * owner; a transfer moves visibility; deleting a key hands its sessions back to the admins; a viewer
 * sees only what it is assigned and cannot mutate; assigned and owned sessions combine.
 */
describe('Session ownership (e2e)', () => {
  let app: INestApplication<App>;
  let authService: AuthService;
  let adminKey: string;
  let arham: { id: string; raw: string };
  let zain: { id: string; raw: string };
  let sessA: string; // created by Arham
  let sessZ: string; // created by Zain
  let sessAdmin: string; // created by the admin
  const stamp = Date.now();

  const http = () => request(app.getHttpServer());
  const ids = (body: unknown) => (body as Array<{ id: string }>).map(s => s.id);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    applyGlobalValidation(app);
    await app.init();
    authService = app.get(AuthService);

    adminKey = (await authService.createApiKey({ name: `own-admin-${stamp}`, role: ApiKeyRole.ADMIN })).rawKey;
    const a = await authService.createApiKey({ name: `Arham-${stamp}`, role: ApiKeyRole.OPERATOR });
    const z = await authService.createApiKey({ name: `Zain-${stamp}`, role: ApiKeyRole.OPERATOR });
    arham = { id: a.apiKey.id, raw: a.rawKey };
    zain = { id: z.apiKey.id, raw: z.rawKey };
  });

  afterAll(async () => {
    await app?.close();
  });

  it('an operator with no sessions sees an empty list but can create one, which it then owns', async () => {
    await http()
      .get('/api/sessions')
      .set('X-API-Key', arham.raw)
      .expect(200, { success: true, message: 'OK', data: [] });

    const created = await http()
      .post('/api/sessions')
      .set('X-API-Key', arham.raw)
      .send({ name: `own-a-${stamp}` })
      .expect(201);
    sessA = (dataOf(created) as { id: string }).id;
    expect(dataOf(created)).toMatchObject({ ownerKeyId: arham.id, ownerName: `Arham-${stamp}` });

    const z = await http()
      .post('/api/sessions')
      .set('X-API-Key', zain.raw)
      .send({ name: `own-z-${stamp}` })
      .expect(201);
    sessZ = (dataOf(z) as { id: string }).id;

    const adm = await http()
      .post('/api/sessions')
      .set('X-API-Key', adminKey)
      .send({ name: `own-admin-${stamp}` })
      .expect(201);
    sessAdmin = (dataOf(adm) as { id: string }).id;
    expect(dataOf(adm)).toMatchObject({ ownerKeyId: null, ownerName: null });
  });

  it("each operator lists only its own session; the other's is 403 on every session route", async () => {
    expect(ids(dataOf(await http().get('/api/sessions').set('X-API-Key', arham.raw).expect(200)))).toEqual([sessA]);
    expect(ids(dataOf(await http().get('/api/sessions').set('X-API-Key', zain.raw).expect(200)))).toEqual([sessZ]);

    await http().get(`/api/sessions/${sessA}`).set('X-API-Key', arham.raw).expect(200);
    for (const path of [
      `/api/sessions/${sessZ}`,
      `/api/sessions/${sessZ}/messages`,
      `/api/sessions/${sessZ}/webhooks`,
      `/api/sessions/${sessZ}/templates`,
    ]) {
      await http().get(path).set('X-API-Key', arham.raw).expect(403);
    }
    await http().delete(`/api/sessions/${sessZ}`).set('X-API-Key', arham.raw).expect(403);
    await http()
      .post(`/api/sessions/${sessZ}/templates`)
      .set('X-API-Key', arham.raw)
      .send({ name: 'x', body: 'y' })
      .expect(403);
  });

  it('an operator can manage templates and webhooks of its own session', async () => {
    await http()
      .post(`/api/sessions/${sessA}/templates`)
      .set('X-API-Key', arham.raw)
      .send({ name: `tpl-${stamp}`, body: 'Hello' })
      .expect(201);
    await http().get(`/api/sessions/${sessA}/templates`).set('X-API-Key', arham.raw).expect(200);
    await http().get(`/api/sessions/${sessA}/webhooks`).set('X-API-Key', arham.raw).expect(200);
  });

  it("aggregate stats count only the caller's sessions", async () => {
    const a = await http().get('/api/sessions/stats/overview').set('X-API-Key', arham.raw).expect(200);
    expect((dataOf(a) as { total: number }).total).toBe(1);
  });

  it('the admin sees every session and can filter by owner', async () => {
    const all = ids(dataOf(await http().get('/api/sessions').set('X-API-Key', adminKey).expect(200)));
    expect(all).toEqual(expect.arrayContaining([sessA, sessZ, sessAdmin]));

    expect(
      ids(dataOf(await http().get(`/api/sessions?owner=${arham.id}`).set('X-API-Key', adminKey).expect(200))),
    ).toEqual([sessA]);
    const adminOwned = ids(
      dataOf(await http().get('/api/sessions?owner=admin').set('X-API-Key', adminKey).expect(200)),
    );
    expect(adminOwned).toContain(sessAdmin);
    expect(adminOwned).not.toContain(sessA);
    expect(adminOwned).not.toContain(sessZ);
    const everyOwner = ids(dataOf(await http().get('/api/sessions?owner=all').set('X-API-Key', adminKey).expect(200)));
    expect(everyOwner).toEqual(expect.arrayContaining([sessA, sessZ, sessAdmin]));
  });

  it('refuses the owner filter and the transfer route to an operator', async () => {
    await http().get(`/api/sessions?owner=${zain.id}`).set('X-API-Key', arham.raw).expect(403);
    await http()
      .patch(`/api/sessions/${sessA}/owner`)
      .set('X-API-Key', arham.raw)
      .send({ ownerKeyId: zain.id })
      .expect(403);
  });

  it('a transfer moves visibility at once', async () => {
    const res = await http()
      .patch(`/api/sessions/${sessA}/owner`)
      .set('X-API-Key', adminKey)
      .send({ ownerKeyId: zain.id })
      .expect(200);
    expect(dataOf(res)).toMatchObject({ ownerKeyId: zain.id, ownerName: `Zain-${stamp}` });
    await http().get(`/api/sessions/${sessA}`).set('X-API-Key', arham.raw).expect(403);
    await http().get(`/api/sessions/${sessA}`).set('X-API-Key', zain.raw).expect(200);

    // Back to Arham for the rest of the suite; a transfer to an admin key is refused.
    await http()
      .patch(`/api/sessions/${sessA}/owner`)
      .set('X-API-Key', adminKey)
      .send({ ownerKeyId: arham.id })
      .expect(200);
    const adminId = (await authService.findAll()).find(k => k.role === ApiKeyRole.ADMIN)!.id;
    await http()
      .patch(`/api/sessions/${sessA}/owner`)
      .set('X-API-Key', adminKey)
      .send({ ownerKeyId: adminId })
      .expect(400);
  });

  it('an operator with assigned sessions sees owned ∪ assigned', async () => {
    await authService.update(arham.id, { allowedSessions: [sessAdmin] });
    const seen = ids(dataOf(await http().get('/api/sessions').set('X-API-Key', arham.raw).expect(200)));
    expect(seen.sort()).toEqual([sessA, sessAdmin].sort());
    await authService.update(arham.id, { allowedSessions: [] });
  });

  it('a viewer sees only assigned sessions and cannot mutate them', async () => {
    const viewer = await authService.createApiKey({
      name: `viewer-${stamp}`,
      role: ApiKeyRole.VIEWER,
      allowedSessions: [sessZ],
    });
    expect(ids(dataOf(await http().get('/api/sessions').set('X-API-Key', viewer.rawKey).expect(200)))).toEqual([sessZ]);
    await http().get(`/api/sessions/${sessA}`).set('X-API-Key', viewer.rawKey).expect(403);
    await http()
      .post('/api/sessions')
      .set('X-API-Key', viewer.rawKey)
      .send({ name: `v-${stamp}` })
      .expect(403);
    await http().delete(`/api/sessions/${sessZ}`).set('X-API-Key', viewer.rawKey).expect(403);

    const bare = await authService.createApiKey({ name: `viewer-bare-${stamp}`, role: ApiKeyRole.VIEWER });
    await http()
      .get('/api/sessions')
      .set('X-API-Key', bare.rawKey)
      .expect(200, { success: true, message: 'OK', data: [] });
  });

  it("deleting an operator's key hands its sessions to the admins (not deleted) and the key list counts them", async () => {
    const keys = await http().get('/api/auth/api-keys').set('X-API-Key', adminKey).expect(200);
    const row = (dataOf(keys) as Array<{ id: string; ownedSessions: number }>).find(k => k.id === arham.id);
    expect(row?.ownedSessions).toBe(1);

    await http().delete(`/api/auth/api-keys/${arham.id}`).set('X-API-Key', adminKey).expect(204);
    const res = await http().get(`/api/sessions/${sessA}`).set('X-API-Key', adminKey).expect(200);
    expect(dataOf(res)).toMatchObject({ id: sessA, ownerKeyId: null, ownerName: null });
    expect(ids(dataOf(await http().get('/api/sessions?owner=admin').set('X-API-Key', adminKey).expect(200)))).toContain(
      sessA,
    );
  });
});
