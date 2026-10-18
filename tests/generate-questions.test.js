import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/generate-questions.js';
import { issueAdminToken } from '../api/_lib.js';
import { questionSet } from './github-fixture.js';
import { buildDraftFromQuestions } from '../public/assets/js/question-draft.js';

process.env.ADMIN_TOKEN_SECRET = 'test-only-secret';
process.env.GEMINI_API_KEY = 'test-only-key';
process.env.LLM_PROVIDER_ORDER = 'gemini';
process.env.GEMINI_MODEL = 'test-model';

test('custom categories and the current theme are used for generation', async () => {
  const set = questionSet('security'); const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    assert(new URL(url).hostname === 'generativelanguage.googleapis.com');
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: set.questions }) }] } }] }) };
  };
  const res = { setHeader() {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
  try { await handler({ method: 'POST', headers: {}, body: { adminToken: issueAdminToken(), settings: set.settings, currentQuestionSet: set } }, res); }
  finally { globalThis.fetch = original; }
  assert.equal(res.statusCode, 200, res.body?.message);
  assert.equal(res.body.questions[0].category, '確認');
  assert.match(sent.systemInstruction.parts[0].text, /情報セキュリティ/);
  assert.doesNotMatch(sent.systemInstruction.parts[0].text, /企業内AIリテラシー教育/);
});

test('browser draft assembly preserves custom category IDs and configured weights despite reordered output', () => {
  const current = questionSet('custom');
  current.categories = [{ id: 'S-001', name: '先のカテゴリ' }, { id: 'S-002', name: '後のカテゴリ' }];
  const settings = { questionCount: 2, passingScore: 0, categoryDistribution: [
    { categoryId: 'S-001', weight: 9, priority: 1 }, { categoryId: 'S-002', weight: 1, priority: 2 },
  ] };
  const qs = [{ ...current.questions[0], category: '後のカテゴリ' }, { ...current.questions[0], category: '先のカテゴリ', id: 'Q002' }];
  const draft = buildDraftFromQuestions(qs, settings, current, {});
  assert.deepEqual(draft.categories, [{ id: 'S-002', name: '後のカテゴリ' }, { id: 'S-001', name: '先のカテゴリ' }]);
  assert.deepEqual(draft.settings.categoryDistribution.map(d => d.weight), [1, 9]);
  assert.equal(draft.settings.passingScore, 0);
});
