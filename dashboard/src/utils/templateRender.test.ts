import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filledVars, renderTemplate, renderTemplatePart, templateVariables } from './templateRender.ts';

test('the variables of a template are read from header, body and footer, each once, in order', () => {
  assert.deepEqual(
    templateVariables({
      header: 'Hi {{ name }}',
      body: 'Order {{order.id}} for {{name}} ({legacy})',
      footer: '{{shop}}',
    }),
    ['name', 'order.id', 'legacy', 'shop'],
  );
  assert.deepEqual(templateVariables({ body: 'No variables here', header: null, footer: null }), []);
});

test('a filled variable is substituted; an empty or unknown one stays as written, as on the gateway', () => {
  assert.equal(
    renderTemplatePart('Hi {{name}}, {{missing}} {x}', { name: 'Ada', missing: '' }),
    'Hi Ada, {{missing}} {x}',
  );
  // Only own keys count: a placeholder named like an inherited member is not filled from the prototype.
  assert.equal(renderTemplatePart('{{constructor}}', {}), '{{constructor}}');
});

test('the sent text joins the non-empty rendered parts with a blank line', () => {
  const out = renderTemplate(
    { header: 'Hello {{name}}', body: 'Your code is {{code}}', footer: '' },
    { name: 'Ada', code: '42' },
  );
  assert.deepEqual(out, {
    header: 'Hello Ada',
    body: 'Your code is 42',
    footer: '',
    text: 'Hello Ada\n\nYour code is 42',
  });
  assert.equal(renderTemplate({ body: 'b', footer: 'f' }, {}).text, 'b\n\nf');
});

test('only filled values are sent', () => {
  assert.deepEqual(filledVars({ a: '1', b: '', c: ' ' }), { a: '1', c: ' ' });
});
