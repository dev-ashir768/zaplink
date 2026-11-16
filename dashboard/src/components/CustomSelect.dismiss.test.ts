// A CustomSelect list is a portal on document.body, so nothing on the page clips it, and nothing on the page closed
// it either: a button that stopped propagation (a session card's Owner button) opened a dialog while the owner
// filter's list stayed floating on top. The list closes on any press outside it, in the capture phase, when focus
// leaves it, when a dialog opens, and on a route change; a dialog starts focus on its first field.
import '../test-helpers/register-hooks.ts';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useState } from 'react';

type RTL = typeof import('@testing-library/react');
let rtl: RTL;
let CustomSelect: (typeof import('./CustomSelect.tsx'))['CustomSelect'];
let Modal: (typeof import('./Modal.tsx'))['Modal'];
let closeAllFloating: (typeof import('./floatingLayer.ts'))['closeAllFloating'];

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  const { i18nReady } = await import('../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  ({ CustomSelect } = await import('./CustomSelect.tsx'));
  ({ Modal } = await import('./Modal.tsx'));
  ({ closeAllFloating } = await import('./floatingLayer.ts'));
});

afterEach(() => rtl.cleanup());

const options = [
  { value: 'all', label: 'All owners' },
  { value: 'admin', label: 'Admin' },
];

function Page() {
  const [value, setValue] = useState('all');
  const [dialog, setDialog] = useState(false);
  return createElement(
    'div',
    null,
    createElement(CustomSelect, { value, onChange: setValue, options, ariaLabel: 'Owner filter' }),
    // Like a card action: it stops the press from reaching anything above it.
    createElement(
      'button',
      {
        type: 'button',
        onPointerDown: (e: { stopPropagation(): void }) => e.stopPropagation(),
        onMouseDown: (e: { stopPropagation(): void }) => e.stopPropagation(),
        onClick: () => setDialog(true),
      },
      'Owner',
    ),
    createElement(Modal, {
      open: dialog,
      onClose: () => setDialog(false),
      title: 'Transfer',
      closeLabel: 'Close',
      children: [
        createElement('label', { key: 'l', htmlFor: 'f' }, 'Name'),
        createElement('input', { key: 'i', id: 'f', type: 'text' }),
      ],
    }),
  );
}

function openList(): HTMLElement {
  const trigger = rtl.screen.getByRole('button', { name: /^Owner filter/ });
  rtl.fireEvent.click(trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  return trigger;
}

test('a press on a button that stops propagation still closes the list', () => {
  rtl.render(createElement(Page));
  const trigger = openList();
  const owner = rtl.screen.getByRole('button', { name: 'Owner' });
  rtl.fireEvent.pointerDown(owner);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(rtl.screen.queryByRole('listbox'), null);
});

test('a press inside the open list does not close it', () => {
  rtl.render(createElement(Page));
  const trigger = openList();
  rtl.fireEvent.pointerDown(rtl.screen.getByRole('option', { name: 'Admin' }));
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
});

test('a dialog opening closes the list, and its focus starts on the first field, not the close button', () => {
  rtl.render(createElement(Page));
  const trigger = openList();
  // A click with no press first (keyboard activation, or a press another handler swallowed).
  rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Owner' }));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(rtl.screen.queryByRole('listbox'), null);
  const dialog = rtl.screen.getByRole('dialog');
  assert.equal(dialog.contains(document.activeElement), true);
  assert.notEqual(document.activeElement?.getAttribute('aria-label'), 'Close');
});

test('focus moving out of the list closes it', () => {
  rtl.render(createElement(Page));
  const trigger = openList();
  rtl.act(() => rtl.screen.getByRole('button', { name: 'Owner' }).focus());
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('a route change (closeAllFloating) closes the list', () => {
  rtl.render(createElement(Page));
  const trigger = openList();
  rtl.act(() => closeAllFloating());
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});
