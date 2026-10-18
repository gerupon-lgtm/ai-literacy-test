import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/github-save.js';
import { issueAdminToken } from '../api/_lib.js';
import { createGithubFixture, questionSet } from './github-fixture.js';

process.env.ADMIN_TOKEN_SECRET = 'test-only-secret';
process.env.GITHUB_TOKEN = 'test-only-token';
process.env.GITHUB_OWNER = 'test-owner';
process.env.GITHUB_REPO = 'test-repo';
const aPath = 'public/data/sets/storage-A.json';
const current = 'public/data/current-question-set.json';
const active = 'public/data/active-set.json';
const status = 'public/data/set-status.json';

function setup() {
  return createGithubFixture({ [aPath]: questionSet(), 'public/data/sets/B.json': questionSet('B'),
    [current]: questionSet(), [active]: { activeSetId: 'storage-A' } });
}
async function call(fixture, body) {
  const original = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; }, end() {} };
  try { await handler({ method: 'POST', headers: {}, body: { adminToken: issueAdminToken(), ...body } }, res); }
  finally { globalThis.fetch = original; }
  return res;
}

test('editing the active set survives switching away and back without changing its logical ID', async () => {
  const f = setup(); const edited = questionSet(); edited.settings.passingScore = 95;
  const save = await call(f, { action: 'save_current', questionSet: edited, expectedRevision: f.head, expectedActiveSetId: 'storage-A' });
  assert.equal(save.statusCode, 200);
  assert.equal(f.read(aPath).settings.passingScore, 95);
  assert.equal(f.read(aPath).questionSetId, 'logical-A');
  assert.equal(f.writes.length, 1, 'related files must publish in one commit');
  await call(f, { action: 'activate', setId: 'B', expectedRevision: f.head });
  await call(f, { action: 'activate', setId: 'storage-A', expectedRevision: f.head });
  assert.equal(f.read(current).settings.passingScore, 95);
});

test('the active set cannot be disabled or deleted, including direct API calls', async () => {
  for (const action of ['delete', 'set_enabled']) {
    const f = setup();
    const r = await call(f, { action, setId: 'storage-A', enabled: false, expectedRevision: f.head });
    assert.equal(r.statusCode, 409); assert.equal(f.writes.length, 0); assert(f.has(aPath));
  }
});

test('disabled sets remain readable, cannot activate, and can be enabled again', async () => {
  const f = setup();
  let r = await call(f, { action: 'set_enabled', setId: 'B', enabled: false, expectedRevision: f.head });
  assert.equal(r.statusCode, 200); assert.deepEqual(f.read(status).disabledSetIds, ['B']);
  r = await call(f, { action: 'list' });
  assert.equal(r.body.sets.find(s => s.id === 'B').enabled, false);
  r = await call(f, { action: 'activate', setId: 'B', expectedRevision: f.head }); assert.equal(r.statusCode, 409);
  r = await call(f, { action: 'get', setId: 'B' }); assert.equal(r.statusCode, 200);
  r = await call(f, { action: 'set_enabled', setId: 'B', enabled: true, expectedRevision: f.head }); assert.equal(r.statusCode, 200);
  r = await call(f, { action: 'activate', setId: 'B', expectedRevision: f.head }); assert.equal(r.statusCode, 200);
});

test('deleting an unused set removes its file and status without changing the active test', async () => {
  const f = setup();
  await call(f, { action: 'set_enabled', setId: 'B', enabled: false, expectedRevision: f.head });
  const r = await call(f, { action: 'delete', setId: 'B', expectedRevision: f.head });
  assert.equal(r.statusCode, 200); assert.equal(f.has('public/data/sets/B.json'), false);
  assert.deepEqual(f.read(status).disabledSetIds, []); assert.equal(f.read(active).activeSetId, 'storage-A');
  assert.equal(f.read(current).questionSetId, 'logical-A');
});

test('a stale revision or concurrent commit cannot overwrite newer data', async () => {
  const f = setup(); const old = f.head; f.advance();
  let r = await call(f, { action: 'delete', setId: 'B', expectedRevision: old });
  assert.equal(r.statusCode, 409); assert(f.has('public/data/sets/B.json'));
  f.beforeUpdate = () => f.advance();
  r = await call(f, { action: 'activate', setId: 'B', expectedRevision: f.head });
  assert.equal(r.statusCode, 409); assert.equal(f.read(active).activeSetId, 'storage-A');
  assert.equal(f.read(current).questionSetId, 'logical-A');
});

test('list distinguishes the real JSON ID and storage ID, and saving the active library updates public data', async () => {
  const f = setup(); let r = await call(f, { action: 'list' });
  assert.equal(r.body.sets.find(s => s.id === 'storage-A').questionSetId, 'logical-A');
  assert.equal(r.body.revision, f.head);
  const edited = questionSet(); edited.version = '1.0.1';
  r = await call(f, { action: 'save', setId: 'storage-A', questionSet: edited, expectedRevision: f.head });
  assert.equal(r.statusCode, 200); assert.equal(f.read(current).version, '1.0.1');
  assert.equal(f.read(aPath).questionSetId, 'logical-A');
});

test('invalid JSON data, missing revisions, and invalid storage IDs cannot be saved', async () => {
  const f = setup(); const bad = questionSet(); bad.questions[0].answer = [8];
  let r = await call(f, { action: 'save', setId: 'B', questionSet: bad, expectedRevision: f.head }); assert.equal(r.statusCode, 400);
  r = await call(f, { action: 'save', setId: 'B', questionSet: questionSet('B') }); assert.equal(r.statusCode, 409);
  r = await call(f, { action: 'delete', setId: '../B', expectedRevision: f.head }); assert.equal(r.statusCode, 400);
  assert.equal(f.writes.length, 0);
});
