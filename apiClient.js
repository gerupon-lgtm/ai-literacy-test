// =========================================================
// api/generate-questions.js
// 管理者指示に基づき設問案 JSON を生成する（Vercel Function）。
//
// 【分割生成対応】
//  Vercel の実行時間上限（Hobby:60s / Pro:300s）に収めるため、
//  1リクエスト = 1バッチ（既定5問）だけ生成する。
//  管理画面側が batchIndex を進めながら複数回呼び、結果を結合する。
//
//  リクエスト body:
//    adminToken            管理者トークン（必須）
//    instruction           生成指示（空ならサーバ側で既定指示を使用）
//    settings              { questionCount, difficulty, categoryDistribution }
//    currentQuestionSet    現行セット（メタ引き継ぎ用・任意）
//    batchSize             1バッチの問題数（任意・既定5・最大10）
//    batchIndex            何バッチ目か（0始まり・任意・既定0）
//    existingQuestions     既出の問題文配列（重複回避用・任意）
//
//  レスポンス:
//    ok, questions[], batchIndex, batchSize, totalBatches,
//    isLast, provider, model, warnings[]
//
// AI 生成結果はスキーマ検証し、正解インデックスの範囲も検証する。
// =========================================================
import {
  applyCors, handlePreflight, readJsonBody,
  verifyAdminToken, callLLM, GENERATE_SYSTEM_PROMPT,
  CATEGORY_DEFS, CATEGORY_IDS,
} from './_lib.js';
import { extractJsonLoose } from './_providers.js';

const VALID_DIFFICULTY = ['basic', 'standard', 'advanced'];
const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 10;

// 空欄時に採用する既定生成指示（管理画面の例示と同じ意図）
const DEFAULT_INSTRUCTION = [
  '企業内で生成AIを安全かつ効果的に活用するための、実務的なAIリテラシー設問を作成してください。',
  '各カテゴリの配分に従い、難易度のバランスを取りつつ、現場で迷いやすい判断を問う良問にしてください。',
].join('\n');

// 設問JSONスキーマ（OpenRouter json_schema / Gemini responseSchema 用）
const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          difficulty: { type: 'string' },
          type: { type: 'string' },
          question: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          answer: { type: 'array', items: { type: 'integer' } },
          explanation: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['category', 'type', 'question', 'choices', 'answer'],
      },
    },
  },
  required: ['questions'],
};

// 設問 1 件の検証。問題があれば warnings に push し、致命的なら false を返す。
function validateQuestion(q, idx, warnings) {
  const where = `questions[${idx}]`;
  if (!q || typeof q !== 'object') { warnings.push(`${where}: オブジェクトではありません。`); return false; }
  if (typeof q.question !== 'string' || !q.question.trim()) { warnings.push(`${where}: question が空です。`); return false; }
  if (!Array.isArray(q.choices) || q.choices.length < 2) { warnings.push(`${where}: choices が不足しています。`); return false; }
  if (!q.choices.every((c) => typeof c === 'string' && c.trim())) { warnings.push(`${where}: choices に空文字があります。`); return false; }

  const type = q.type === 'multiple' ? 'multiple' : 'single';
  q.type = type;

  let answer = q.answer;
  if (typeof answer === 'number') answer = [answer];
  if (!Array.isArray(answer) || answer.length === 0) { warnings.push(`${where}: answer がありません。`); return false; }
  if (!answer.every((a) => Number.isInteger(a) && a >= 0 && a < q.choices.length)) {
    warnings.push(`${where}: answer が選択肢範囲外です。`); return false;
  }
  if (type === 'single' && answer.length !== 1) {
    warnings.push(`${where}: single なのに正解が複数あります。`); return false;
  }
  q.answer = answer;

  const byId = CATEGORY_DEFS.find((c) => c.id === q.category);
  const byName = CATEGORY_DEFS.find((c) => c.label === q.category);
  if (byId) q.category = byId.label;
  else if (!byName) { warnings.push(`${where}: 未知のカテゴリ「${q.category}」。`); }

  if (!VALID_DIFFICULTY.includes(q.difficulty)) q.difficulty = 'standard';
  if (typeof q.explanation !== 'string') q.explanation = '';
  if (!Array.isArray(q.tags)) q.tags = [];
  return true;
}

// このバッチで作るべきカテゴリ内訳を決める。
// 全体配分（count）を batchIndex に基づき切り出す。
function planBatchCategories(allocation, batchSize, batchIndex) {
  // allocation: [{categoryId, label, count}]
  // フラットなカテゴリ列を作って batch で切り出す
  const flat = [];
  for (const a of allocation) {
    for (let i = 0; i < a.count; i++) flat.push(a.label);
  }
  const start = batchSize * batchIndex;
  const slice = flat.slice(start, start + batchSize);
  // ラベル → 件数 に集計
  const counts = {};
  for (const label of slice) counts[label] = (counts[label] || 0) + 1;
  return { counts, totalInScope: flat.length };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(res, req);

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ ok: false, code: 'BAD_JSON', message: 'リクエスト本文を解析できませんでした。' });
  }

  if (!verifyAdminToken(body && body.adminToken)) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: '管理者トークンが無効です。再ログインしてください。' });
  }

  const instruction = (body && body.instruction && String(body.instruction).trim()) || DEFAULT_INSTRUCTION;
  const settings = (body && body.settings) || {};
  const questionCount = Number(settings.questionCount) || 20;
  if (questionCount < 1 || questionCount > 100) {
    return res.status(400).json({ ok: false, code: 'INVALID_COUNT', message: '出題数は1〜100で指定してください。' });
  }

  const dist = Array.isArray(settings.categoryDistribution) ? settings.categoryDistribution : [];
  for (const d of dist) {
    if (!CATEGORY_IDS.includes(d.categoryId)) {
      return res.status(400).json({ ok: false, code: 'INVALID_CATEGORY', message: `未定義のカテゴリID: ${d.categoryId}` });
    }
  }

  // バッチ設定
  let batchSize = Number(body.batchSize) || DEFAULT_BATCH_SIZE;
  batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, batchSize));
  const batchIndex = Math.max(0, Number(body.batchIndex) || 0);
  const totalBatches = Math.ceil(questionCount / batchSize);
  const existingQuestions = Array.isArray(body.existingQuestions) ? body.existingQuestions.slice(0, 200) : [];

  if (batchIndex >= totalBatches) {
    return res.status(400).json({ ok: false, code: 'BATCH_OUT_OF_RANGE', message: 'バッチ番号が範囲外です。' });
  }

  // 全体のカテゴリ配分（count）を構築
  const allocation = buildAllocation(questionCount, dist);
  const { counts: batchCounts } = planBatchCategories(allocation, batchSize, batchIndex);
  // このバッチで実際に作る問題数
  const thisBatchCount = Object.values(batchCounts).reduce((s, n) => s + n, 0)
    || Math.min(batchSize, questionCount - batchSize * batchIndex);

  // カテゴリ内訳テキスト
  const breakdownText = Object.entries(batchCounts)
    .map(([label, n]) => `${label}: ${n}問`).join(' / ') || `${thisBatchCount}問（カテゴリ任意）`;

  // 重複回避用の既出問題文（先頭60字まで）
  const avoidText = existingQuestions.length
    ? `\n# 既に出題済み（重複・類似を避ける）\n${existingQuestions.map((q, i) => `${i + 1}. ${String(q).slice(0, 60)}`).join('\n')}`
    : '';

  const categoryGuide = CATEGORY_DEFS.map((c) => `${c.id} ${c.label}`).join(' / ');
  const userContent = [
    '次の条件で、企業内AIリテラシー検定の設問案を作成してください。',
    '',
    `# このバッチで作る問題数\n${thisBatchCount}問（全${questionCount}問中 ${batchIndex + 1}/${totalBatches} バッチ目）`,
    `# このバッチのカテゴリ内訳\n${breakdownText}`,
    `# 難易度\n${settings.difficulty || 'standard'}`,
    `# カテゴリ一覧（参考）\n${categoryGuide}`,
    `# 管理者からの指示\n${instruction}`,
    avoidText,
    '',
    '# 出力形式（厳守。これ以外の文字を出力しない）',
    '次の JSON オブジェクトのみを出力してください:',
    '{',
    '  "questions": [',
    '    {',
    '      "category": "カテゴリ名（日本語ラベル）",',
    '      "difficulty": "basic|standard|advanced",',
    '      "type": "single|multiple",',
    '      "question": "問題文",',
    '      "choices": ["選択肢1", "選択肢2", "選択肢3", "選択肢4"],',
    '      "answer": [0],',
    '      "explanation": "短い解説",',
    '      "tags": ["タグ"]',
    '    }',
    '  ]',
    '}',
    'answer は choices のインデックス（0始まり）の配列です。single は1個、multiple は2個以上にしてください。',
    `必ず ${thisBatchCount} 問を作成してください。`,
  ].join('\n');

  let aiText, provider, model;
  try {
    const result = await callLLM({
      system: GENERATE_SYSTEM_PROMPT,
      user: userContent,
      temperature: 0.5,
      maxTokens: 4000,
      jsonSchema: QUESTION_SCHEMA,
      timeoutMs: 55000,
    });
    aiText = result.content; provider = result.provider; model = result.model;
  } catch (err) {
    console.error('generate-questions upstream error:', err && err.message);
    return res.status(502).json({
      ok: false, code: 'AI_UPSTREAM_ERROR',
      message: 'AI設問生成に失敗しました。全プロバイダで失敗しました。設定とログを確認してください。',
      detail: String(err && err.message || err).slice(0, 500),
    });
  }

  let parsed;
  try {
    parsed = extractJsonLoose(aiText);
  } catch (err) {
    console.error('generate-questions parse error:', err && err.message, aiText && aiText.slice(0, 300));
    return res.status(502).json({ ok: false, code: 'AI_PARSE_ERROR', message: 'AI応答を解析できませんでした。再試行してください。' });
  }

  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
  const warnings = [];
  const validQuestions = [];
  rawQuestions.forEach((q, i) => {
    if (validateQuestion(q, i, warnings)) validQuestions.push(q);
  });

  if (validQuestions.length === 0) {
    return res.status(502).json({ ok: false, code: 'AI_EMPTY_RESULT', message: 'このバッチで有効な設問を生成できませんでした。再試行してください。', warnings });
  }

  const isLast = batchIndex >= totalBatches - 1;

  return res.status(200).json({
    ok: true,
    questions: validQuestions,
    batchIndex,
    batchSize,
    totalBatches,
    isLast,
    requestedCount: questionCount,
    provider,
    model,
    warnings,
  });
}

// 全体のカテゴリ配分を [{categoryId,label,count}] で返す。
// weight 比率を questionCount に按分し、端数は優先度順に配る。
function buildAllocation(questionCount, dist) {
  const cats = CATEGORY_DEFS.map((c) => {
    const d = dist.find((x) => x.categoryId === c.id);
    return { categoryId: c.id, label: c.label, weight: d ? Number(d.weight) || 0 : 0, priority: d ? Number(d.priority) || 99 : 99 };
  });
  const totalWeight = cats.reduce((s, c) => s + c.weight, 0);

  // 全weight0なら均等割り
  if (totalWeight <= 0) {
    const base = Math.floor(questionCount / cats.length);
    let rem = questionCount - base * cats.length;
    return cats.map((c) => {
      const extra = rem > 0 ? 1 : 0; if (rem > 0) rem--;
      return { categoryId: c.categoryId, label: c.label, count: base + extra };
    });
  }

  // 比率按分（floor）
  const withFloor = cats.map((c) => {
    const exact = (c.weight / totalWeight) * questionCount;
    return { ...c, exact, count: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let assigned = withFloor.reduce((s, c) => s + c.count, 0);
  let remainder = questionCount - assigned;

  // 端数は frac 大きい順、同点なら priority 小さい順
  const order = [...withFloor].sort((a, b) => (b.frac - a.frac) || (a.priority - b.priority));
  for (let i = 0; i < order.length && remainder > 0; i++) { order[i].count++; remainder--; }

  return withFloor.map((c) => ({ categoryId: c.categoryId, label: c.label, count: c.count }));
}
