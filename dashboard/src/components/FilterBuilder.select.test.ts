import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decl, readRules } from '../test-helpers/css-rules.ts';

// The webhook filter row's selects are CustomSelects in their compact field variant: the chevron is a 16px flex
// item after the label (0.5rem gap) inside 0.5rem of padding a side, not a background image the text runs under.
// The bases leave the text box the labels of the shipped locales need; a longer one ends in an ellipsis.
const filter = readRules(new URL('./FilterBuilder.css', import.meta.url));
const select = readRules(new URL('./CustomSelect.css', import.meta.url));
const body = (rules: ReturnType<typeof readRules>, selector: string, media = ''): string =>
  rules.find(r => r.media === media && r.selectors.includes(selector))?.body ?? '';

const REM = 16;
const px = (value: string | undefined): number => {
  assert.ok(value, 'a length is missing');
  const m = /^(-?[\d.]+)(rem|px)\b/.exec(value);
  assert.ok(m, `not a length: ${value}`);
  return m[2] === 'rem' ? Number(m[1]) * REM : Number(m[1]);
};

const compact = () => body(select, '.custom-select.field.compact .custom-select-trigger');

test('a label the filter row cannot show whole ends in an ellipsis', () => {
  assert.equal(decl(body(select, '.custom-select-label'), 'text-overflow'), 'ellipsis');
});

// Widest option, in px at 13px text, across the 15 shipped locales, measured in a browser: 134 for the field
// (Italian "Corpo del messaggio" is 133; French and Turkish have one label over 170px that ends in an ellipsis)
// and 83 for the operator (Indonesian and Korean).
test('the field and the operator selects leave room for the labels of the shipped locales', () => {
  assert.equal(decl(compact(), 'font-size'), '0.8125rem');
  const padding = px(decl(compact(), 'padding')?.split(/\s+/)[1]) * 2;
  const gap = px(decl(body(select, '.custom-select-trigger'), 'gap'));
  const chrome = padding + gap + 16 + 2;
  const text = (selector: string): number => px(decl(body(filter, selector), 'flex')?.split(/\s+/)[2]) - chrome;
  assert.ok(text('.filter-field') >= 133, `${text('.filter-field')}px of text in the field select`);
  assert.ok(text('.filter-operator') >= 83, `${text('.filter-operator')}px of text in the operator select`);
});

// The flex basis a selector ends up with at a viewport width: the last rule that sets it among those whose
// max-width media query admits the width. This is where the phone rule's 6rem overrode the bases measured above.
function flexBasisAt(selector: string, width: number): string | undefined {
  let basis: string | undefined;
  for (const rule of filter) {
    const max = /^@media \(max-width: (\d+)px\)$/.exec(rule.media)?.[1];
    if (rule.media && !(max && width <= Number(max))) continue;
    if (!rule.selectors.includes(selector)) continue;
    basis = decl(rule.body, 'flex-basis') ?? decl(rule.body, 'flex')?.split(/\s+/)[2] ?? basis;
  }
  return basis;
}

// Two selects side by side leave the field select 100px of text at 341px and 109px at 360px, under the 133px the
// longest label that fits needs (Italian "Corpo del messaggio", German "Nachrichteninhalt" at 341px): in a phone
// row the field takes a row of its own. From 421px the equal share leaves it 139px, which holds every label that
// the desktop bases hold, so the two share a row up to 600px, where the 6rem bases still grow to fill it.
test('the field select has a row of its own on every phone width up to 420px', () => {
  for (const width of [320, 340, 341, 360, 375, 390, 414, 420]) {
    assert.equal(flexBasisAt('.filter-field', width), '100%', `${width}px`);
  }
});

test('the field and the operator share a row from 421px up to the phone breakpoint', () => {
  for (const width of [421, 450, 500, 600]) {
    assert.equal(flexBasisAt('.filter-field', width), '6rem', `${width}px`);
    assert.equal(flexBasisAt('.filter-operator', width), '6rem', `${width}px`);
  }
  assert.equal(flexBasisAt('.filter-field', 601), '11rem');
});
