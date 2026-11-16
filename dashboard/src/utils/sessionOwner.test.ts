import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterSessionsByOwner,
  ownerFilterOptions,
  ownerLabel,
  ownerTransferOptions,
  reconcileSessionSelection,
  OWNER_ADMIN,
  OWNER_ALL,
} from './sessionOwner.ts';

const sessions = [
  { id: 'a', ownerKeyId: 'arham' },
  { id: 'z', ownerKeyId: 'zain' },
  { id: 'm', ownerKeyId: null },
  { id: 'legacy' },
];

test('the owner filter keeps every session for "all", admin-owned ones for "admin", and one key otherwise', () => {
  assert.deepEqual(
    filterSessionsByOwner(sessions, OWNER_ALL).map(s => s.id),
    ['a', 'z', 'm', 'legacy'],
  );
  assert.deepEqual(
    filterSessionsByOwner(sessions, OWNER_ADMIN).map(s => s.id),
    ['m', 'legacy'],
  );
  assert.deepEqual(
    filterSessionsByOwner(sessions, 'zain').map(s => s.id),
    ['z'],
  );
});

const labels = {
  all: 'All owners',
  admin: 'Admin',
  unknown: 'Deleted key',
  role: (role: string) => (role === 'operator' ? 'Operator' : role === 'viewer' ? 'Viewer' : ''),
};

test('the owner options list All, Admin, then every operator and viewer key A-Z, each with its session count', () => {
  const options = ownerFilterOptions(
    [
      { id: 'zain', name: 'Zain', role: 'viewer' },
      { id: 'root', name: 'Root', role: 'admin' },
      { id: 'arham', name: 'Arham', role: 'operator' },
      { id: 'bilal', name: 'Bilal', role: 'operator' },
    ],
    [{ ownerKeyId: 'arham' }, { ownerKeyId: 'arham' }, { ownerKeyId: 'arham' }, { ownerKeyId: null }],
    labels,
  );
  assert.deepEqual(options, [
    { value: OWNER_ALL, label: 'All owners (4)' },
    { value: OWNER_ADMIN, label: 'Admin (1)' },
    { value: 'arham', label: 'Arham · Operator (3)' },
    { value: 'bilal', label: 'Bilal · Operator (0)' },
    { value: 'zain', label: 'Zain · Viewer (0)' },
  ]);
});

test('an owner that only appears on a session is listed: by its session name, or as a deleted key', () => {
  const options = ownerFilterOptions(
    [{ id: 'root', name: 'Root', role: 'admin' }],
    [{ ownerKeyId: 'gone' }, { ownerKeyId: 'old', ownerName: 'Old key' }, { ownerKeyId: 'root' }],
    labels,
  );
  assert.deepEqual(
    options.map(o => o.label),
    ['All owners (3)', 'Admin (0)', 'Deleted key (1)', 'Old key (1)', 'Root (1)'],
  );
});

test('the transfer options are Admin and every operator and viewer key with its role', () => {
  const keys = [
    { id: 'zain', name: 'Zain', role: 'viewer' },
    { id: 'root', name: 'Root', role: 'admin' },
    { id: 'arham', name: 'Arham', role: 'operator' },
  ];
  assert.deepEqual(ownerTransferOptions(keys, 'arham', labels), [
    { value: '', label: 'Admin' },
    { value: 'arham', label: 'Arham · Operator' },
    { value: 'zain', label: 'Zain · Viewer' },
  ]);
  // A current owner whose key is gone stays shown (disabled), so the select is not blank.
  assert.deepEqual(ownerTransferOptions(keys, 'gone', labels).at(-1), {
    value: 'gone',
    label: 'Deleted key',
    disabled: true,
  });
});

test('a narrowed session picker keeps the selection while listed, else takes the first, else none', () => {
  assert.equal(reconcileSessionSelection(['a', 'b'], 'b'), 'b');
  assert.equal(reconcileSessionSelection(['a', 'b'], 'z'), 'a');
  assert.equal(reconcileSessionSelection([], 'z'), '');
});

test('the owner badge names the key, falls back for a deleted key, and says Admin for admin-owned', () => {
  const labels = { admin: 'Admin', unknown: 'Deleted key' };
  assert.equal(ownerLabel({ ownerKeyId: 'arham', ownerName: 'Arham' }, labels), 'Arham');
  assert.equal(ownerLabel({ ownerKeyId: 'gone', ownerName: null }, labels), 'Deleted key');
  assert.equal(ownerLabel({ ownerKeyId: null }, labels), 'Admin');
});
