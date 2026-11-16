// The admin owner filter (?owner=) on the pages that pick a session: it lists every operator and viewer key with a
// session count, narrows the session picker to the picked owner's sessions, and moves the selection into it.
import '../test-helpers/register-hooks.ts';
import { chooseOption, optionEntries, selectedValue } from '../test-helpers/custom-select.ts';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type RTL = typeof import('@testing-library/react');
let rtl: RTL;
let RoleProvider: typeof import('../components/RoleProvider.tsx').RoleProvider;
let ToastProvider: (typeof import('../components/Toast.tsx'))['ToastProvider'];
let MessageTester: typeof import('./MessageTester.tsx').MessageTester;
let Webhooks: typeof import('./Webhooks.tsx').Webhooks;

const keys = [
  { id: 'k-root', name: 'Root', role: 'admin', keyPrefix: 'r', isActive: true, usageCount: 0, createdAt: '' },
  { id: 'k-zain', name: 'Zain', role: 'viewer', keyPrefix: 'z', isActive: true, usageCount: 0, createdAt: '' },
  { id: 'k-arham', name: 'Arham', role: 'operator', keyPrefix: 'a', isActive: true, usageCount: 0, createdAt: '' },
];
const sessions = [
  { id: 's-admin', name: 'Office', status: 'ready', phone: '15550000001', ownerKeyId: null },
  { id: 's-arham1', name: 'Arham one', status: 'ready', phone: '15550000002', ownerKeyId: 'k-arham' },
  { id: 's-arham2', name: 'Arham two', status: 'ready', phone: '15550000003', ownerKeyId: 'k-arham' },
];
const webhooks = [
  { id: 'w1', sessionId: 's-admin', url: 'https://a.example/hook', events: ['message.received'], isActive: true },
  { id: 'w2', sessionId: 's-arham1', url: 'https://b.example/hook', events: ['message.received'], isActive: true },
];

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  globalThis.fetch = ((input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/auth/api-keys')) return Promise.resolve(json(keys));
    if (url.endsWith('/sessions')) return Promise.resolve(json(sessions));
    if (url.endsWith('/webhooks')) return Promise.resolve(json(webhooks));
    return Promise.resolve(json([]));
  }) as typeof fetch;
  const { i18nReady } = await import('../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  ({ RoleProvider } = await import('../components/RoleProvider.tsx'));
  ({ ToastProvider } = await import('../components/Toast.tsx'));
  ({ MessageTester } = await import('./MessageTester.tsx'));
  ({ Webhooks } = await import('./Webhooks.tsx'));
});

afterEach(() => {
  rtl.cleanup();
  window.sessionStorage.removeItem('zaplink_user_role');
  window.history.replaceState(null, '', '/');
});

function render(page: ReactElement, role = 'admin'): void {
  window.sessionStorage.setItem('zaplink_user_role', role);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 1_000 } } });
  rtl.render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(RoleProvider, null, createElement(ToastProvider, null, page)),
    ),
  );
}

async function ownerTrigger(): Promise<HTMLElement> {
  return rtl.screen.findByRole('button', { name: /^Filter by owner/ });
}

test('Message Tester: the owner filter lists every operator and viewer key with counts and narrows the picker', async () => {
  render(createElement(MessageTester));
  const owner = await ownerTrigger();
  await rtl.waitFor(() =>
    assert.deepEqual(
      optionEntries(rtl.fireEvent, owner).map(([, label]) => label),
      ['All owners (3)', 'Admin (1)', 'Arham · Operator (2)', 'Zain · Viewer (0)'],
    ),
  );
  const picker = document.getElementById('mt-1') as HTMLElement;
  await rtl.waitFor(() => assert.equal(selectedValue(picker), 's-admin'));
  chooseOption(rtl.fireEvent, owner, 'k-arham');
  // The admin-owned session left the picker, so the first of Arham's is selected.
  await rtl.waitFor(() => assert.equal(selectedValue(picker), 's-arham1'));
  assert.deepEqual(
    optionEntries(rtl.fireEvent, picker).map(([value]) => value),
    ['s-arham1', 's-arham2'],
  );
  assert.equal(new URLSearchParams(window.location.search).get('owner'), 'k-arham');
});

test('Message Tester: a non-admin key never sees the owner filter', async () => {
  render(createElement(MessageTester), 'operator');
  await rtl.screen.findByText(/^Office/, { selector: '.custom-select-label' });
  assert.equal(rtl.screen.queryByTestId('owner-filter'), null);
});

test('Webhooks: the owner filter narrows the webhook list and the session picker', async () => {
  render(createElement(Webhooks));
  await rtl.screen.findByText('https://b.example/hook');
  assert.ok(rtl.screen.getByText('https://a.example/hook'));
  chooseOption(rtl.fireEvent, await ownerTrigger(), 'k-arham');
  await rtl.waitFor(() => assert.equal(rtl.screen.queryByText('https://a.example/hook'), null));
  assert.ok(rtl.screen.getByText('https://b.example/hook'));
  rtl.fireEvent.click(rtl.screen.getByRole('button', { name: /Add Webhook/i }));
  const picker = (await rtl.screen.findByRole('dialog')).querySelector('#wh-1') as HTMLElement;
  assert.deepEqual(
    optionEntries(rtl.fireEvent, picker).map(([value]) => value),
    ['', 's-arham1', 's-arham2'],
  );
});
