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
  const tags = [...document.querySelectorAll('.dev-group-name')].map(h => h.textContent?.trim());
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

test('search shortcut, arrow-key navigation, collapsible tags and a remembered Getting started toggle', async () => {
  window.localStorage.removeItem('zaplink_dev_intro_collapsed');
  renderAt('/developer', 'admin');
  await rtl.waitFor(() => assert.ok(document.querySelector('.dev-op')), { timeout: 10_000 });
  const search = document.querySelector<HTMLInputElement>('.dev-search input')!;
  rtl.fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  assert.equal(document.activeElement, search, 'Ctrl+K focuses the search');
  search.blur();
  rtl.fireEvent.keyDown(document.body, { key: '/' });
  assert.equal(document.activeElement, search, '"/" focuses the search');

  const nav = document.querySelector('.dev-sidebar')!;
  const ops = [...nav.querySelectorAll<HTMLButtonElement>('.dev-op')];
  ops[0].focus();
  rtl.fireEvent.keyDown(ops[0], { key: 'ArrowDown' });
  assert.equal(document.activeElement, ops[1]);
  rtl.fireEvent.keyDown(ops[1], { key: 'ArrowUp' });
  assert.equal(document.activeElement, ops[0]);

  const group = nav.querySelector('.dev-group')!;
  const before = group.querySelectorAll('.dev-op').length;
  assert.ok(before > 0);
  rtl.fireEvent.click(group.querySelector('.dev-group-btn')!);
  assert.equal(group.querySelectorAll('.dev-op').length, 0, 'a tag group collapses');
  rtl.fireEvent.change(search, { target: { value: 'send-text' } });
  assert.ok(
    [...document.querySelectorAll('.dev-op-path')].some(p => p.textContent?.includes('send-text')),
    'searching filters and expands matches',
  );

  const toggle = document.querySelector<HTMLButtonElement>('.dev-intro-toggle')!;
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  rtl.fireEvent.click(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(window.localStorage.getItem('zaplink_dev_intro_collapsed'), '1');
  window.localStorage.removeItem('zaplink_dev_intro_collapsed');
});

test('response status tabs switch the schema shown and the code panel offers every language', async () => {
  renderAt('/developer?op=MessageController_sendText', 'admin');
  await rtl.waitFor(() => assert.ok(document.querySelector('#dev-detail-title')), { timeout: 10_000 });
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.dev-status-tab')];
  assert.ok(tabs.length > 1);
  assert.equal(tabs.find(b => b.getAttribute('aria-selected') === 'true')?.textContent?.[0], '2');
  const other = tabs.find(b => !b.textContent?.startsWith('2'))!;
  rtl.fireEvent.click(other);
  assert.equal(other.getAttribute('aria-selected'), 'true');
  const langs = [...document.querySelectorAll('.dev-panel .dev-tab')].map(b => b.textContent);
  for (const l of ['cURL', 'JavaScript', 'Python', 'PHP']) assert.ok(langs.includes(l), l);
  assert.ok(document.querySelector('.dev-path-param')?.textContent === '{sessionId}');
});
