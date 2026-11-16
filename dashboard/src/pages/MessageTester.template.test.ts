// Template mode of the Message Tester: pick one of the session's stored templates, fill its variables, see the
// rendered message, and Send posts send-template with the template id and the values.
import '../test-helpers/register-hooks.ts';
import { chooseOption } from '../test-helpers/custom-select.ts';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let rtl: typeof import('@testing-library/react');
let MessageTester: typeof import('./MessageTester.tsx').MessageTester;
let RoleProvider: typeof import('../components/RoleProvider.tsx').RoleProvider;
let client: QueryClient | undefined;
const sends: Array<{ path: string; body: unknown }> = [];
let templates: unknown[] = [];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (path.endsWith('/sessions')) {
      return Promise.resolve(json([{ id: 's1', name: 'Main', status: 'ready', phone: '15550000000' }]));
    }
    if (path.endsWith('/sessions/s1/templates')) return Promise.resolve(json(templates));
    if (init?.method === 'POST' && path.includes('/messages/')) {
      sends.push({ path, body: JSON.parse(String(init.body)) });
      return Promise.resolve(json({ messageId: 'wamid-1', timestamp: 1_700_000_000 }, 201));
    }
    return Promise.resolve(json([]));
  }) as typeof fetch;
  const { i18nReady } = await import('../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  ({ RoleProvider } = await import('../components/RoleProvider.tsx'));
  ({ MessageTester } = await import('./MessageTester.tsx'));
});

afterEach(async () => {
  rtl.cleanup();
  await client?.cancelQueries();
  client?.clear();
  client = undefined;
  sends.length = 0;
  window.sessionStorage.removeItem('zaplink_user_role');
});

async function renderTemplateMode(role = 'operator'): Promise<void> {
  window.sessionStorage.setItem('zaplink_user_role', role);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 1_000 } } });
  rtl.render(
    createElement(QueryClientProvider, { client }, createElement(RoleProvider, null, createElement(MessageTester))),
  );
  await rtl.screen.findByText(/^Main/, { selector: '.custom-select-label' });
  rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Template' }));
}

test('a template send posts send-template with the template id and the filled variables', async () => {
  const { screen, fireEvent, waitFor } = rtl;
  templates = [
    {
      id: 'tpl-1',
      sessionId: 's1',
      name: 'order-shipped',
      header: 'Hi {{name}}',
      body: 'Order {{order}} shipped',
      footer: 'Thanks',
    },
  ];
  await renderTemplateMode();
  const picker = screen.getByLabelText<HTMLButtonElement>('Template');
  await waitFor(() => chooseOption(fireEvent, picker, 'tpl-1'));
  fireEvent.change(screen.getByPlaceholderText('+62812345678'), { target: { value: '15551112222@c.us' } });

  const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Send Message' });
  fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Ada' } });
  assert.equal(send.disabled, true, 'Send waits for every variable');
  fireEvent.change(screen.getByLabelText('order'), { target: { value: '#42' } });
  assert.equal(screen.getByTestId('template-preview').textContent, 'Hi AdaOrder #42 shippedThanks');
  assert.equal(send.disabled, false);

  fireEvent.click(send);
  await waitFor(() => assert.equal(sends.length, 1));
  assert.equal(sends[0].path, '/api/sessions/s1/messages/send-template');
  assert.deepEqual(sends[0].body, {
    chatId: '15551112222@c.us',
    templateId: 'tpl-1',
    vars: { name: 'Ada', order: '#42' },
  });
});

test('a session with no templates links to the Templates page and offers no Send', async () => {
  templates = [];
  await renderTemplateMode();
  const link = await rtl.screen.findByRole('link', { name: 'Create one on the Templates page' });
  assert.equal(link.getAttribute('href'), '/templates');
  assert.equal(rtl.screen.getByRole<HTMLButtonElement>('button', { name: 'Send Message' }).disabled, true);
});

test('a viewer can preview a template but cannot send it', async () => {
  const { screen, fireEvent, waitFor } = rtl;
  templates = [{ id: 'tpl-1', sessionId: 's1', name: 'welcome', body: 'Welcome!' }];
  await renderTemplateMode('viewer');
  await waitFor(() => chooseOption(fireEvent, screen.getByLabelText<HTMLButtonElement>('Template'), 'tpl-1'));
  fireEvent.change(screen.getByPlaceholderText('+62812345678'), { target: { value: '15551112222@c.us' } });
  assert.equal(screen.getByTestId('template-preview').textContent, 'Welcome!');
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: 'View Only' }).disabled, true);
  assert.equal(sends.length, 0);
});
