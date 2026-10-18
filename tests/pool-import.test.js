import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareImport, mergeImport } from '../public/assets/js/pool-import.js';
import { questionSet } from './github-fixture.js';

test('replacing A retains B and its manual edits and selection', () => {
  const b = { ...questionSet('B').questions[0], originSetId: 'B', selected: false, question: '手で修正したB', uid: 2 };
  const pool = [{ ...questionSet('A').questions[0], originSetId: 'A', uid: 1 }, b];
  const incoming = [{ ...questionSet('A').questions[0], question: '新版A', uid: 3 }];
  const result = mergeImport(pool, incoming, 'A', 'replace');
  assert.equal(result.length, 2); assert.equal(result[0], b);
  assert.equal(result[1].question, '新版A'); assert.equal(result[1].originSetId, 'A');
  assert.equal(pool[0].question, '確認しますか。');
});
test('adding the same ID retains existing questions; cancelling leaves the pool unchanged', () => {
  const pool = [{ originSetId: 'A', question: '古いA' }];
  const added = mergeImport(pool, [{ question: '新しいA' }], 'A', 'add');
  assert.equal(added.length, 2); assert.equal(added[0], pool[0]);
  assert.equal(mergeImport(pool, [], 'A', 'cancel'), pool);
});
test('JSON ID wins over filenames or versions; ID-less arrays require explicit assignment', () => {
  const s = questionSet('A'); s.version = '2.0.0';
  assert.equal(prepareImport(s).setId, 'A');
  assert.equal(prepareImport({ questionSetDraft: s }).setId, 'A');
  assert.throws(() => prepareImport(s.questions), /Set ID/);
  assert.equal(prepareImport(s.questions, 'A').setId, 'A');
  assert.throws(() => prepareImport(s, 'B'), /変更/);
});
test('invalid imports do not silently assign the first choice as the correct answer', () => {
  const bad = questionSet('A'); bad.questions[0].answer = [];
  assert.throws(() => prepareImport(bad), /正解/);
  assert.throws(() => mergeImport([], [], 'A', 'unknown'), /操作/);
});
