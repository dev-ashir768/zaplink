// Developer Center helpers: $ref/allOf resolution, example generation, code samples, search and deep links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  API_KEY_PLACEHOLDER,
  codeSample,
  deref,
  exampleFromSchema,
  exampleRequest,
  filterEndpoints,
  groupByTag,
  listEndpoints,
  localizeExample,
  mediaExample,
  parseDeepLink,
  requiredRole,
  SAMPLE_LANGUAGES,
  schemaFields,
  tokenizeJson,
  type OpenApiDocument,
} from './openapi.ts';

const doc: OpenApiDocument = {
  tags: [{ name: 'messages' }, { name: 'health' }],
  paths: {
    '/api/sessions/{sessionId}/messages/send-text': {
      post: {
        operationId: 'MessageController_sendText',
        summary: 'Send a text message',
        tags: ['messages'],
        parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Send' } } },
        },
        responses: {
          '201': {
            description: 'Sent',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } },
          },
          '403': { description: 'Key lacks the OPERATOR role' },
        },
      },
    },
    '/api/health': {
      get: {
        operationId: 'HealthController_check',
        summary: 'Basic health check',
        tags: ['health'],
        security: [],
        responses: {},
      },
    },
  },
  components: {
    schemas: {
      Base: {
        type: 'object',
        required: ['chatId'],
        properties: { chatId: { type: 'string', example: '628123456789@c.us' } },
      },
      Send: {
        allOf: [{ $ref: '#/components/schemas/Base' }],
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', example: 'Hi' },
          kind: { type: 'string', enum: ['plain', 'rich'] },
          preview: { description: 'Own preview', allOf: [{ $ref: '#/components/schemas/Preview' }] },
          tags: { type: 'array', items: { $ref: '#/components/schemas/Preview' } },
        },
      },
      Preview: {
        type: 'object',
        required: ['url'],
        properties: { url: { type: 'string', format: 'uri' }, next: { $ref: '#/components/schemas/Preview' } },
      },
      Result: { type: 'object', properties: { messageId: { type: 'string', example: 'true_628123456789@c.us_3EB0' } } },
    },
  },
  security: [{ 'X-API-Key': [] }],
};

test('deref merges allOf and keeps sibling keywords', () => {
  const s = deref(doc, { $ref: '#/components/schemas/Send' });
  assert.deepEqual(Object.keys(s.properties ?? {}).sort(), ['chatId', 'kind', 'preview', 'tags', 'text']);
  assert.deepEqual([...(s.required ?? [])].sort(), ['chatId', 'text']);
});

test('schemaFields flattens nested objects, arrays and enums with required markers, and stops on recursion', () => {
  const rows = schemaFields(doc, { $ref: '#/components/schemas/Send' });
  const by = Object.fromEntries(rows.map(r => [r.path, r]));
  assert.equal(by.chatId.required, true);
  assert.equal(by.kind.required, false);
  assert.deepEqual(by.kind.enumValues, ['plain', 'rich']);
  assert.equal(by.preview.description, 'Own preview');
  assert.equal(by['preview.url'].required, true);
  assert.equal(by['preview.url'].depth, 1);
  assert.ok(by['tags[].url'], 'array item fields are listed');
  assert.ok(rows.length < 40, 'the self-referencing Preview.next did not recurse forever');
});

test('examples prefer the schema example, localize sample numbers to +92, and fill required fields', () => {
  const body = exampleFromSchema(doc, { $ref: '#/components/schemas/Send' }) as Record<string, unknown>;
  assert.equal(body.chatId, '923001234567@c.us');
  assert.equal(body.text, 'Hi');
  assert.equal('kind' in body, false, 'an optional field without an example is left out of a large DTO');
  assert.equal(exampleFromSchema(doc, { type: 'string', enum: ['plain', 'rich'] }), 'plain');
  const res = mediaExample(
    doc,
    doc.paths['/api/sessions/{sessionId}/messages/send-text'].post!.responses!['201'].content!['application/json'],
  );
  assert.deepEqual(res, { messageId: 'true_923001234567@c.us_3EB0' });
  assert.equal(localizeExample('+6281234567890'), '+923001234567');
  assert.equal(localizeExample('hello'), 'hello');
});

test('code samples carry the placeholder key, the current origin, and the example body', () => {
  const [send] = listEndpoints(doc);
  const values = exampleRequest(doc, send);
  assert.equal(values.path.sessionId, 'my-session');
  for (const lang of SAMPLE_LANGUAGES) {
    const code = codeSample(lang, doc, send, 'https://wa.example.pk', values);
    assert.ok(code.includes('https://wa.example.pk/api/sessions/my-session/messages/send-text'), lang);
    assert.ok(code.includes(API_KEY_PLACEHOLDER), `${lang} has the key placeholder`);
    assert.ok(code.includes('923001234567@c.us'), `${lang} has the body`);
  }
  assert.match(codeSample('curl', doc, send, 'http://h'), /^curl -X POST 'http:\/\/h\/api/);
  assert.match(codeSample('python', doc, send, 'http://h'), /requests\.post\(url, headers=headers, json=payload\)/);
  const health = listEndpoints(doc)[1];
  assert.ok(!codeSample('curl', doc, health, 'http://h').includes('X-API-Key'), 'public routes send no key');
});

test('search filters on path, summary, tag and operationId; grouping keeps the tag order', () => {
  const eps = listEndpoints(doc);
  assert.equal(filterEndpoints(eps, '').length, 2);
  assert.deepEqual(
    filterEndpoints(eps, 'send-text').map(e => e.id),
    ['MessageController_sendText'],
  );
  assert.deepEqual(
    filterEndpoints(eps, 'HEALTH basic').map(e => e.id),
    ['HealthController_check'],
  );
  assert.deepEqual(
    filterEndpoints(eps, 'messagecontroller').map(e => e.tag),
    ['messages'],
  );
  assert.equal(filterEndpoints(eps, 'nothing-here').length, 0);
  assert.deepEqual(
    groupByTag(doc, eps).map(g => g.tag),
    ['messages', 'health'],
  );
});

test('required role, deep links and the JSON tokenizer', () => {
  assert.equal(requiredRole(listEndpoints(doc)[0].operation), 'operator');
  assert.equal(requiredRole(listEndpoints(doc)[1].operation), null);
  assert.equal(parseDeepLink('?op=Foo_bar', ''), 'Foo_bar');
  assert.equal(parseDeepLink('', '#messages/Foo_bar'), 'Foo_bar');
  assert.equal(parseDeepLink('', ''), null);
  const kinds = tokenizeJson('{"a": 1, "b": "x", "c": true, "d": null}')
    .filter(t => t.kind !== 'text')
    .map(t => t.kind);
  assert.deepEqual(kinds.slice(0, 4), ['punct', 'key', 'punct', 'number']);
  assert.ok(kinds.includes('string') && kinds.includes('boolean') && kinds.includes('null'));
});

test('the real root openapi.json: every operation lists, renders fields, examples and samples', () => {
  const real = JSON.parse(readFileSync(new URL('../../../openapi.json', import.meta.url), 'utf8')) as OpenApiDocument;
  const eps = listEndpoints(real);
  assert.ok(eps.length >= 170, `only ${eps.length} operations`);
  assert.equal(new Set(eps.map(e => e.id)).size, eps.length, 'operationIds are unique, so deep links are too');
  for (const e of eps) {
    for (const lang of SAMPLE_LANGUAGES) assert.ok(codeSample(lang, real, e, 'http://h').length > 0);
    for (const r of Object.values(e.operation.responses ?? {})) {
      const media = r.content?.['application/json'];
      if (!media) continue;
      schemaFields(real, media.schema);
      mediaExample(real, media);
    }
  }
  const tags = new Set(eps.map(e => e.tag));
  for (const tag of ['auth', 'sessions', 'messages', 'webhooks', 'health']) assert.ok(tags.has(tag), tag);
});
