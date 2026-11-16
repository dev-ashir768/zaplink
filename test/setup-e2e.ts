// e2e boot environment. Set BEFORE AppModule is imported (setupFiles phase) so the app boots against the
// test PostgreSQL, in the schema global-setup-e2e.ts created for this run, with no Redis/queue and no
// production boot guard. The suites run one at a time (`maxWorkers: 1` in jest-e2e.json) and share that
// schema; every file path below points at a throwaway directory instead of the developer's ./data.
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { testDatabaseEnv } from '../src/test-utils/pg-test-db';
import { Server } from 'http';
import { NestApplication } from '@nestjs/core';

// Put every suite's server on a LOOPBACK port before supertest can start one of its own.
//
// supertest starts a server per request with `listen(0)` and no host (supertest/lib/test.js), which
// binds the wildcard address, and then dials `http://127.0.0.1:<port>` whatever it bound. macOS hands
// out an ephemeral port that an unrelated process already holds on 127.0.0.1 specifically (measured:
// 40 of 40 such ports went to a wildcard listener), permits the overlapping bind, and routes the
// loopback connection to the MORE specific binding. That process then answers, and its status reaches
// the assertion: a captured run took a `501 Not Implemented` from a desktop helper on 127.0.0.1:49657,
// on a machine holding 29 such loopback listeners. That is where this lane's statuses with no matching
// route came from, on a different test each run, and no amount of state isolation could reach it.
//
// The host cannot simply be added to that `listen` call: a host argument routes the bind through
// dns.lookup, so it completes a tick later, and supertest reads `address().port` synchronously.
// Listening here instead means `app.address()` is already set, so supertest reuses this server and
// never opens one. Binding 127.0.0.1 also makes a collision a refused bind rather than a silent
// share, and the allocator skips ports already held on that address.
//
// Boundary worth knowing: this patches a prototype, so a suite that booted an app inside
// `jest.isolateModules` would get a fresh, unpatched `@nestjs/core` and fall back to the exposed
// path. Nothing does that today (the one caller only reads module metadata), but a new one would
// need to listen on loopback itself.
type AutoListened = Server & { __e2eAutoListened?: true };
const nestAppProto = NestApplication.prototype as unknown as {
  init: (...args: unknown[]) => Promise<unknown>;
  listen: (...args: unknown[]) => Promise<unknown>;
  getHttpServer: () => unknown;
  __e2eLoopbackListening?: true;
};
if (!nestAppProto.__e2eLoopbackListening) {
  const originalInit = nestAppProto.init;
  nestAppProto.init = async function (this: typeof nestAppProto, ...args: unknown[]): Promise<unknown> {
    const result = await originalInit.apply(this, args);
    const server = this.getHttpServer() as AutoListened | undefined;
    if (server && typeof server.listen === 'function' && !server.listening) {
      // A failed bind arrives as an 'error' event, not as this callback. Waiting on the callback
      // alone leaves init() pending AND, with nothing listening for 'error', Node throws it detached
      // from the call that caused it. Either half is the unexplained failure this block exists to
      // remove, so the event is what settles the wait.
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      server.__e2eAutoListened = true;
    }
    return result;
  };

  // `listen()` initialises first and then binds the SAME server, so the port taken above would meet it
  // as ERR_SERVER_ALREADY_LISTEN on its own socket. Initialise here, hand that port back, and let the
  // real call bind whatever it was asked for. A hostless port keeps the loopback the lane relies on,
  // since a wildcard bind is exactly what the block above exists to avoid.
  const originalListen = nestAppProto.listen;
  nestAppProto.listen = async function (this: typeof nestAppProto, ...args: unknown[]): Promise<unknown> {
    await this.init();
    const server = this.getHttpServer() as AutoListened | undefined;
    if (server?.__e2eAutoListened && server.listening) {
      delete server.__e2eAutoListened;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    const wantsDefaultHost = args.length <= 1 || typeof args[1] !== 'string';
    return wantsDefaultHost
      ? originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1))
      : originalListen.apply(this, args);
  };
  nestAppProto.__e2eLoopbackListening = true;
}

process.env.NODE_ENV = 'test';
// Keyed per SETUP RUN, not per process: setupFiles executes once per test file.
const e2eRunId = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// The remaining data paths. Each already carries its own knob, and leaving them unset pointed every
// suite at the same `./data/sessions`, `./data/baileys` and `./data/media`: shared between suites
// in a run, and the developer's own directories besides.
for (const [key, name] of [
  ['SESSION_DATA_PATH', 'sessions'],
  ['BAILEYS_AUTH_DIR', 'baileys'],
  ['STORAGE_LOCAL_PATH', 'media'],
] as const) {
  process.env[key] = join(tmpdir(), `zaplink-e2e-${name}-${e2eRunId}`);
}
// The export directory has no knob: each boot sweeps the checkout's ./data/exports and deletes the
// archives older than this, a day-old one the developer kept to export, restart and import included.
process.env.STORAGE_EXPORT_SWEEP_MAX_AGE_MS = String(Number.MAX_SAFE_INTEGER);
process.env.DATABASE_TYPE = 'postgres';
Object.assign(process.env, testDatabaseEnv());
if (!process.env.ZAPLINK_E2E_SCHEMA)
  throw new Error('ZAPLINK_E2E_SCHEMA is unset: run the e2e suites through jest-e2e.json');
process.env.POSTGRES_SCHEMA = process.env.ZAPLINK_E2E_SCHEMA;
// The bootstrap key file is written on first boot (no keys yet — which every e2e run is) and unlinked
// when that key is revoked or deleted. Without a lever it resolves under the repo root, so an e2e run
// rewrote the DEVELOPER'S ./data/.api-key. Point it at a throwaway temp file.
const e2eKeyFile = join(tmpdir(), `zaplink-e2e-key-${process.pid}`);
rmSync(e2eKeyFile, { force: true });
process.env.BOOTSTRAP_KEY_FILE = e2eKeyFile;
process.env.QUEUE_ENABLED = 'false';
// Likewise force Redis off per suite, over an ambient REDIS_ENABLED inherited from the developer's
// shell or the CI env; without this reset a suite would boot with Redis-backed throttling/cache.
process.env.REDIS_ENABLED = 'false';
process.env.AUTO_START_SESSIONS = 'false';
// The schema comes from the migration chains, as in production.
process.env.DATABASE_SYNCHRONIZE = 'false';
// e2e suites burst many requests at the API; relax the per-second rate limit so the
// ThrottlerGuard (still wired) doesn't 429 a normal test run.
process.env.RATE_LIMIT_SHORT_LIMIT = '100000';
process.env.RATE_LIMIT_MEDIUM_LIMIT = '100000';
process.env.RATE_LIMIT_LONG_LIMIT = '100000';
