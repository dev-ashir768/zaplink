// The gateway's response envelope, read tolerantly: a body that is not an envelope is used as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelopeErrorMessage, envelopeErrors, unwrapEnvelope } from './envelope.ts';

test('unwrapEnvelope returns data from a success envelope', () => {
  assert.deepEqual(unwrapEnvelope({ success: true, message: 'OK', data: [1, 2] }), [1, 2]);
  assert.equal(unwrapEnvelope({ success: true, message: 'OK', data: null }), null);
});

test('unwrapEnvelope leaves a raw body alone', () => {
  const raw = { valid: true, role: 'admin' };
  assert.equal(unwrapEnvelope(raw), raw);
  assert.deepEqual(unwrapEnvelope([1]), [1]);
  // `success` without `data` is a payload of its own (e.g. a send result), not an envelope.
  const result = { success: true, messageId: 'x' };
  assert.equal(unwrapEnvelope(result), result);
});

test('envelopeErrorMessage adds the first field error to the message', () => {
  const body = {
    success: false,
    message: 'Validation failed',
    errors: [{ field: 'name', message: 'name may only contain letters' }],
    data: null,
  };
  assert.equal(envelopeErrorMessage(body), 'Validation failed: name may only contain letters');
  assert.deepEqual(envelopeErrors(body), [{ field: 'name', message: 'name may only contain letters' }]);
});

test('envelopeErrorMessage reads a plain message and an older list-of-messages body', () => {
  assert.equal(envelopeErrorMessage({ success: false, message: 'Not Found', errors: [], data: null }), 'Not Found');
  assert.equal(envelopeErrorMessage({ statusCode: 400, message: ['a is bad', 'b is bad'] }), 'a is bad');
  assert.equal(envelopeErrorMessage(null), '');
});
