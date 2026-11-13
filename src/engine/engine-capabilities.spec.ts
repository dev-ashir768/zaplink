/* eslint-disable @typescript-eslint/unbound-method -- handlers are passed as metadata targets, never called */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { engineCapabilityMatrix } from './engine-capability-matrix';
import {
  capabilityReport,
  CAPABILITY_LABELS,
  DEFAULT_ENGINE,
  engineSpecificCapabilities,
  isCapabilitySupported,
  README_MATRIX_END,
  README_MATRIX_START,
  renderEngineMatrixMarkdown,
  resolveEngineId,
  supportedEngines,
} from './engine-capabilities';
import {
  ENGINE_CAPABILITY_KEY,
  EngineCapabilityInterceptor,
  RequiresEngineCapability,
} from './requires-engine-capability';

const ROOT = join(__dirname, '..', '..');
const normalizeTable = (md: string) =>
  md
    .split('\n')
    .filter(l => l.trim().startsWith('|') && !/^\|\s*-/.test(l.trim()))
    .map(l =>
      l
        .split('|')
        .map(c => c.trim())
        .join('|'),
    );

describe('engine capabilities (runtime view of the matrix)', () => {
  it('defaults to Baileys and falls back to it for an unknown engine value', () => {
    expect(DEFAULT_ENGINE).toBe('baileys');
    expect(resolveEngineId(undefined)).toBe('baileys');
    expect(resolveEngineId('nope')).toBe('baileys');
    expect(resolveEngineId('whatsapp-web.js')).toBe('whatsapp-web.js');
  });

  it('agrees with the fully derived matrix for every interface method', () => {
    const matrix = engineCapabilityMatrix();
    for (const [method, row] of Object.entries(matrix)) {
      expect([method, isCapabilitySupported(method, 'baileys')]).toEqual([method, row.baileys.status === 'supported']);
      expect([method, isCapabilitySupported(method, 'whatsapp-web.js')]).toEqual([
        method,
        row.wwjs.status === 'supported',
      ]);
    }
  });

  it('keeps no capability that neither engine supports (such routes are removed, not advertised)', () => {
    const none = Object.keys(engineCapabilityMatrix()).filter(m => supportedEngines(m).length === 0);
    expect(none).toEqual([]);
  });

  it('labels every engine-specific capability', () => {
    for (const { capability } of engineSpecificCapabilities()) expect(CAPABILITY_LABELS[capability]).toBeDefined();
  });

  it('splits the engine-specific rows into supported and unsupported per engine', () => {
    const b = capabilityReport('baileys');
    expect(b.supported).toContain('upsertLabel');
    expect(b.unsupported).toContainEqual({ capability: 'getLabels', supportedBy: ['whatsapp-web.js'] });
    const w = capabilityReport('whatsapp-web.js');
    expect(w.supported).toContain('getLabels');
    expect(w.unsupported.map(u => u.capability)).toContain('rejectCall');
  });

  it('README engine table matches the matrix (regenerate with npm run docs:engine-matrix)', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const start = readme.indexOf(README_MATRIX_START);
    const end = readme.indexOf(README_MATRIX_END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(normalizeTable(readme.slice(start, end))).toEqual(normalizeTable(renderEngineMatrixMarkdown()));
  });

  it('the dashboard mirror (dashboard/src/utils/engineCapabilities.ts) matches the matrix', () => {
    const src = readFileSync(join(ROOT, 'dashboard', 'src', 'utils', 'engineCapabilities.ts'), 'utf8');
    const block = src.slice(
      src.indexOf('ENGINE_SPECIFIC_CAPABILITIES'),
      src.indexOf('};', src.indexOf('ENGINE_SPECIFIC_CAPABILITIES')),
    );
    const mirror: Record<string, string[]> = {};
    for (const m of block.matchAll(/^\s{2}(\w+): \[([^\]]*)\]/gm)) {
      mirror[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]).sort();
    }
    const expected: Record<string, string[]> = {};
    for (const { capability, supportedBy } of engineSpecificCapabilities())
      expected[capability] = [...supportedBy].sort();
    expect(mirror).toEqual(expected);
  });
});

describe('RequiresEngineCapability + EngineCapabilityInterceptor', () => {
  class Ctl {
    @RequiresEngineCapability('getLabels')
    labels() {}
    plain() {}
  }

  const ctx = (handler: () => void) =>
    ({ getHandler: () => handler, getClass: () => Ctl }) as unknown as ExecutionContext;
  const interceptor = (engine: string | undefined) =>
    new EngineCapabilityInterceptor(new Reflector(), { get: () => engine } as never);
  const next = { handle: () => of('ok') };

  it('records the capability and the x-engines extension on the handler', () => {
    expect(Reflect.getMetadata(ENGINE_CAPABILITY_KEY, Ctl.prototype.labels)).toBe('getLabels');
    expect(Reflect.getMetadata('swagger/apiExtension', Ctl.prototype.labels)).toMatchObject({
      'x-engines': ['whatsapp-web.js'],
    });
  });

  it('passes a route the active engine supports', async () => {
    await expect(
      lastValueFrom(interceptor('whatsapp-web.js').intercept(ctx(Ctl.prototype.labels), next)),
    ).resolves.toBe('ok');
  });

  it('passes an unannotated route on any engine', async () => {
    await expect(lastValueFrom(interceptor('baileys').intercept(ctx(Ctl.prototype.plain), next))).resolves.toBe('ok');
  });

  it('answers 501 ENGINE_NOT_SUPPORTED before the handler on the other engine (and on the default)', () => {
    for (const engine of ['baileys', undefined]) {
      let thrown: unknown;
      try {
        interceptor(engine).intercept(ctx(Ctl.prototype.labels), next);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      const ex = thrown as HttpException;
      expect(ex.getStatus()).toBe(501);
      expect(ex.getResponse()).toMatchObject({
        code: 'ENGINE_NOT_SUPPORTED',
        engine: 'baileys',
        capability: 'getLabels',
        supportedBy: ['whatsapp-web.js'],
      });
    }
  });
});
