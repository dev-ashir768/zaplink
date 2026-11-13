// The Developer Center through the real App: the sidebar entry sits next to API Keys for every role, the
// /developer route renders the reference from the bundled spec, a ?op= deep link opens that operation, and a
// viewer cannot send a mutating request from "Try it".
import '../test-helpers/register-hooks.ts';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';

const SPEC_URL = '/assets/openapi-test.json';
const spec = readFileSync(new URL('../../../openapi.json', import.meta.url), 'utf8');
let role = 'admin';

function installFetchStub(): void {
  globalThis.fetch = ((input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const json = (body: string, status = 200) =>
      Promise.resolve(new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));
    if (path === SPEC_URL) return json(spec);
    if (path === '/api/auth/validate') return json(JSON.stringify({ valid: true, role }));
    if (path === '/api/sessions') return json('[]');
    return json(JSON.stringify({ message: `unstubbed ${path}` }), 404);
  }) as typeof fetch;
}

let rtl: typeof import('@testing-library/react');
let App: (typeof import('../App.tsx'))['default'];

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals('http://localhost/developer');
  const g = globalThis as Record<string, unknown>;
  g.__APP_VERSION__ = '0.0.0-test';
  g.__BUILD_TIME__ = new Date(0).toISOString();
  g.__OPENAPI_SPEC_URL__ = SPEC_URL;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  installFetchStub();
  const { timeoutManager } = await import('@tanstack/react-query');
  const unref = (id: ReturnType<typeof setTimeout>): ReturnType<typeof setTimeout> => id.unref();
  timeoutManager.setTimeoutProvider({
    setTimeout: (callback, delay) => unref(setTimeout(callback, delay)),
    clearTimeout: id => clearTimeout(id),
    setInterval: (callback, delay) => unref(setInterval(callback, delay)),
    clearInterval: id => clearInterval(id),
  });
  const { i18nReady } = await import('../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  ({ default: App } = await import('../App.tsx'));
});

afterEach(() => rtl.cleanup());

function renderAt(path: string, as: string): void {
  role = as;
  window.history.replaceState(null, '', path);
  window.sessionStorage.setItem('zaplink_api_key', 'test-key');
  window.sessionStorage.setItem('zaplink_user_role', as);
  rtl.render(createElement(App));
}

test('the sidebar lists Developer Center right after API Keys, and /developer renders every tag', async () => {
  renderAt('/developer', 'admin');
  await rtl.waitFor(() => assert.ok(document.querySelector('a[href="/developer"]')), { timeout: 10_000 });
  const hrefs = [...document.querySelectorAll('.sidebar-nav a')].map(a => a.getAttribute('href'));
  assert.equal(hrefs[hrefs.indexOf('/api-keys') + 1], '/developer');
  await rtl.waitFor(() => assert.ok(document.querySelector('.dev-op')), { timeout: 10_000 });
  assert.equal(window.location.pathname, '/developer');
  const tags = [...document.querySelectorAll('.dev-group-title')].map(h => h.firstChild?.textContent?.trim());
  for (const tag of ['auth', 'sessions', 'messages', 'groups', 'webhooks', 'health'])
    assert.ok(tags.includes(tag), tag);
  assert.ok(document.body.textContent?.includes('923001234567@c.us'), 'the intro shows the chatId format');
});

test('a viewer sees the entry too; ?op= opens the operation and Try it blocks a POST', async () => {
  renderAt('/developer?op=MessageController_sendText', 'viewer');
  await rtl.waitFor(() => assert.ok(document.querySelector('a[href="/developer"]')), { timeout: 10_000 });
  await rtl.waitFor(() => assert.ok(document.querySelector('#dev-detail-title')), { timeout: 10_000 });
  const detail = document.querySelector('.dev-detail')!;
  assert.ok(detail.textContent?.includes('/api/sessions/{sessionId}/messages/send-text'));
  assert.ok(detail.textContent?.includes('YOUR_API_KEY'));
  assert.ok(!detail.textContent?.includes('test-key'), 'the real key never appears in samples');
  const open = [...detail.querySelectorAll('button')].find(b => /request builder/i.test(b.textContent ?? ''))!;
  rtl.fireEvent.click(open);
  const send = await rtl.waitFor(() => {
    const b = [...detail.querySelectorAll('button')].find(x => /send request/i.test(x.textContent ?? ''));
    assert.ok(b);
    return b as HTMLButtonElement;
  });
  assert.equal(send.disabled, true, 'a viewer cannot send a POST');
});
