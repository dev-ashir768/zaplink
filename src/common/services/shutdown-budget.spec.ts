import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { CACHE_QUIT_TIMEOUT_MS } from '../cache/cache.service';
import { THROTTLER_REDIS_QUIT_TIMEOUT_MS } from '../throttler/redis-throttler.storage';
import configuration from '../../config/configuration';
import { ApiKeyUsageTracker } from '../../modules/auth/api-key-usage-tracker.service';
import { WS_REDIS_QUIT_TIMEOUT_MS } from '../../modules/events/redis-io.adapter';
import { MAX_WORKER_CLOSE_WAIT_MS } from '../../modules/queue/processors/close-worker';
import { QUEUE_NAMES } from '../../modules/queue/queue-names';
import { QUEUE_CLOSE_TIMEOUT_MS } from '../../modules/queue/shutdown-safe-queue';
import { ENGINE_TEARDOWN_TIMEOUT_MS } from '../../modules/session/session-lifecycle-fences';
import { AUTOSTART_SHUTDOWN_WAIT_MS } from '../../modules/session/session.service';
import {
  DEFAULT_SHUTDOWN_DELAY_MS,
  DEFAULT_WEBHOOK_SHUTDOWN_DRAIN_MS,
  SHUTDOWN_KILL_DEADLINE_MS,
  SHUTDOWN_TEARDOWN_LIMIT_MS,
  shutdownTeardownLimitMs,
} from './shutdown-budget';

/**
 * The bounded teardown stages, summed in Nest destroy order, must fit the shipped kill deadline. The
 * figures come from the constants the stages use, so raising one without raising the deadline (and the
 * table in shutdown-budget.ts) fails here. A new bounded stage has to be added to the sums below.
 */
describe('shutdown time budget', () => {
  const MIN_RESERVE_MS = 5_000;
  const root = join(__dirname, '../../..');
  // Each queue is its own BullModule.registerQueue module, and Nest closes modules one after the other.
  const QUEUE_COUNT = Object.keys(QUEUE_NAMES).length;
  const base =
    DEFAULT_SHUTDOWN_DELAY_MS +
    ENGINE_TEARDOWN_TIMEOUT_MS +
    AUTOSTART_SHUTDOWN_WAIT_MS +
    DEFAULT_WEBHOOK_SHUTDOWN_DRAIN_MS +
    ApiKeyUsageTracker.SHUTDOWN_FLUSH_TIMEOUT_MS;
  const withPlugins = base;
  const clustered =
    withPlugins +
    MAX_WORKER_CLOSE_WAIT_MS +
    QUEUE_CLOSE_TIMEOUT_MS * QUEUE_COUNT +
    THROTTLER_REDIS_QUIT_TIMEOUT_MS +
    CACHE_QUIT_TIMEOUT_MS +
    WS_REDIS_QUIT_TIMEOUT_MS;

  it('sums to the documented totals', () => {
    expect([base, withPlugins, clustered]).toEqual([28_000, 28_000, 46_000]);
  });

  it('registers one queue module per queue name, so the queue stage is counted per queue', () => {
    const source = readFileSync(join(root, 'src/modules/queue/queue.module.ts'), 'utf8');
    expect(source.match(/BullModule\.registerQueue(Async)?\(/g)).toHaveLength(QUEUE_COUNT);
  });

  it('uses the webhook drain default the budget is written for', () => {
    expect(configuration().webhook.shutdownDrainMs).toBe(DEFAULT_WEBHOOK_SHUTDOWN_DRAIN_MS);
  });

  // The reserve pays for the uncapped hooks after the HTTP close. A stage added or raised eats into it; the
  // message names the fix, so the failure does not read as a bare number mismatch.
  it('leaves a reserve for the hooks after the HTTP close, even when every cap is hit at once', () => {
    const reserveMs = SHUTDOWN_TEARDOWN_LIMIT_MS - (clustered - DEFAULT_SHUTDOWN_DELAY_MS);
    expect(
      reserveMs >= MIN_RESERVE_MS
        ? 'ok'
        : `reserve ${reserveMs} ms < ${MIN_RESERVE_MS} ms: raise SHUTDOWN_KILL_DEADLINE_MS, both compose files and the chart in step`,
    ).toBe('ok');
  });

  it('keeps the 67 s teardown limit and the 5 s kill margin the docs quote', () => {
    expect(SHUTDOWN_TEARDOWN_LIMIT_MS).toBe(67_000);
    expect(SHUTDOWN_KILL_DEADLINE_MS - DEFAULT_SHUTDOWN_DELAY_MS - SHUTDOWN_TEARDOWN_LIMIT_MS).toBe(5_000);
  });

  it('moves the teardown limit 1:1 with WEBHOOK_SHUTDOWN_DRAIN_MS and keeps it a valid timer delay', () => {
    expect(shutdownTeardownLimitMs(DEFAULT_WEBHOOK_SHUTDOWN_DRAIN_MS)).toBe(SHUTDOWN_TEARDOWN_LIMIT_MS);
    expect(shutdownTeardownLimitMs(DEFAULT_WEBHOOK_SHUTDOWN_DRAIN_MS + 7_000)).toBe(SHUTDOWN_TEARDOWN_LIMIT_MS + 7_000);
    expect(shutdownTeardownLimitMs(0)).toBe(SHUTDOWN_TEARDOWN_LIMIT_MS - DEFAULT_WEBHOOK_SHUTDOWN_DRAIN_MS);
    expect(shutdownTeardownLimitMs(Number.MAX_SAFE_INTEGER)).toBe(2 ** 31 - 1);
  });

  // dumb-init is PID 1 as root and gosu then runs node as uid 997. A root process without CAP_KILL can only
  // signal its own uid, so a cap_drop ALL stack that does not re-add KILL never delivers SIGTERM to node:
  // every stop waits out the whole kill deadline and ends in SIGKILL with no teardown at all.
  it.each(['docker-compose.yml', 'docker-compose.dev.yml'])('%s re-adds KILL so dumb-init can signal node', file => {
    const compose = yaml.load(readFileSync(join(root, file), 'utf8')) as {
      services: Record<string, { container_name?: string; cap_drop?: string[]; cap_add?: string[] }>;
    };
    const api = Object.values(compose.services).find(service => service.container_name === 'zaplink-api');
    expect(api?.cap_drop).toContain('ALL');
    expect(api?.cap_add).toContain('KILL');
  });

  it('destroys open sockets at the HTTP close, which the table counts as 0 s', () => {
    expect(readFileSync(join(root, 'src/main.ts'), 'utf8')).toMatch(/^\s+forceCloseConnections: true,/m);
  });
});
