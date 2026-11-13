// The composer's template panel: a stored template of the session is picked and filled, then either sent through
// send-template to the open chat or rendered into the message field.
import '../../test-helpers/register-hooks.ts';
import { chooseOption } from '../../test-helpers/custom-select.ts';
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useState, type ReactNode } from 'react';
import type { Chat } from '../../services/api.ts';
import type { ChatMessageView } from '../../utils/chatMessages.ts';
import type { StagedAttachment } from './ChatComposer.tsx';

let rtl: typeof import('@testing-library/react');
let ChatComposer: (typeof import('./ChatComposer.tsx'))['default'];
let wrap: (children: ReactNode, canWrite: boolean) => ReactNode;

const posts: Array<{ path: string; body: unknown }> = [];
const sent: string[] = [];

const chat: Chat = {
  id: 'alice@c.us',
  name: 'Alice',
  isGroup: false,
  kind: 'individual',
  unreadCount: 0,
  timestamp: 0,
  archived: false,
  pinned: false,
  muted: false,
};

const template = {
  id: 'tpl-1',
  sessionId: 'sess-1',
  name: 'invoice-reminder',
  header: null,
  body: 'Hi {{name}}, invoice {{invoice}} is due',
  footer: 'Billing team',
};

before(async () => {
  const { installJsdomGlobals } = await import('../../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost').pathname;
    const body = path.endsWith('/templates') ? [template] : { messageId: 'wamid-9', timestamp: 1_700_000_000 };
    if (init?.method === 'POST') posts.push({ path, body: JSON.parse(String(init.body)) });
    return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
  }) as typeof fetch;
  const { i18nReady } = await import('../../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { ToastProvider } = await import('../Toast.tsx');
  const { RoleContext } = await import('../../hooks/useRole.tsx');
  wrap = (children, canWrite) =>
    createElement(
      QueryClientProvider,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }) },
      createElement(
        RoleContext.Provider,
        {
          value: {
            role: canWrite ? ('operator' as const) : ('viewer' as const),
            setRole: () => undefined,
            isAdmin: false,
            isOperator: canWrite,
            isViewer: !canWrite,
            canWrite,
            engineType: null,
            setEngineType: () => undefined,
            scoped: false,
            setScoped: () => undefined,
          },
        },
        createElement(ToastProvider, null, children),
      ),
    );
  ({ default: ChatComposer } = await import('./ChatComposer.tsx'));
});

afterEach(() => {
  rtl.cleanup();
  posts.length = 0;
  sent.length = 0;
});

after(() => rtl.cleanup());

function Harness() {
  const [messageInput, setMessageInput] = useState('');
  const [attachment, setAttachment] = useState<StagedAttachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessageView | null>(null);
  return createElement(ChatComposer, {
    selectedSessionId: 'sess-1',
    activeChat: chat,
    replyingTo,
    setReplyingTo,
    onMessageAppended: () => undefined,
    onSent: (_session, _chat, snippet) => sent.push(snippet),
    messageInput,
    setMessageInput,
    attachment,
    setAttachment,
    previewUrl,
    setPreviewUrl,
  });
}

async function openAndFill(): Promise<void> {
  const { screen, fireEvent, waitFor } = rtl;
  rtl.render(wrap(createElement(Harness), true));
  fireEvent.click(screen.getByRole('button', { name: 'Message templates' }));
  await waitFor(() => chooseOption(fireEvent, screen.getByTestId('chat-template-select'), 'tpl-1'));
  fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Ada' } });
}

test('Send template posts send-template to the open chat with the filled variables', async () => {
  const { screen, fireEvent, waitFor } = rtl;
  await openAndFill();
  const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Send template' });
  assert.equal(send.disabled, true, 'held until every variable is filled');
  fireEvent.change(screen.getByLabelText('invoice'), { target: { value: 'INV-7' } });
  fireEvent.click(send);
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0].path, '/api/sessions/sess-1/messages/send-template');
  assert.deepEqual(posts[0].body, {
    chatId: 'alice@c.us',
    templateId: 'tpl-1',
    vars: { name: 'Ada', invoice: 'INV-7' },
  });
  await waitFor(() => assert.deepEqual(sent, ['Hi Ada, invoice INV-7 is due\n\nBilling team']));
  assert.equal(screen.queryByRole('region', { name: 'Message templates' }), null, 'the panel closes on send');
});

test('Insert puts the rendered text into the message field and sends nothing', async () => {
  const { screen, fireEvent } = rtl;
  await openAndFill();
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
  assert.equal(
    (screen.getByPlaceholderText('Type a message...') as HTMLInputElement).value,
    'Hi Ada, invoice {{invoice}} is due Billing team',
  );
  assert.equal(posts.length, 0);
});

test('a viewer has no template button to use', () => {
  rtl.render(wrap(createElement(Harness), false));
  assert.equal(rtl.screen.getByRole<HTMLButtonElement>('button', { name: 'Message templates' }).disabled, true);
});
