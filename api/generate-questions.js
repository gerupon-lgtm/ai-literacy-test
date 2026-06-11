// =========================================================
// api/generate-questions.js
// 管理者指示に基づき設問案 JSON を生成する（Vercel Function）。
// AI 生成結果はスキーマ検証し、正解インデックスの範囲も検証する。
// =========================================================
import {
  applyCors, handlePreflight, readJsonBody,
  verifyAdminToken, callOpenRouter, GENERATE_SYSTEM_PROMPT,
  CATEGORY_DEFS, CATEGORY_IDS,
} from './_lib.js';

const VALID_DIFFICULTY = ['basic', 'standard', 'advanced'];

// AI 応答から JSON 部分を取り出す（```json フェンス等を許容）
function extractJson(text) {
  if (!text) throw new Error('empty');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no json object');
  return JSON.parse(raw.slice(start, end + 1));
}

// 設問 1 件の検証。問題があれば warnings に push し、致命的なら false を返す。
function validateQuestion(q, idx, warnings) {
  const where = `questions[${idx}]`;
  if (!q || typeof q !== 'object') { warnings.push(`${where}: オブジェクトではありません。`); return false; }
  if (typeof q.question !== 'string' || !q.question.trim()) { warnings.push(`${where}: question が空です。`); return false; }
  if (!Array.isArray(q.choices) || q.choices.length < 2) { warnings.push(`${where}: choices が不足しています。`); return false; }
  if (!q.choices.every((c) => typeof c === 'string' && c.trim())) { warnings.push(`${where}: choices に空文字があります。`); return false; }

  const type = q.type === 'multiple' ? 'multiple' : 'single';
  q.type = type;

  // answer を配列に正規化
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

  // カテゴリ名の検証（名称 or ID を許容し、名称へ正規化）
  const byId = CATEGORY_DEFS.find((c) => c.id === q.category);
  const byName = CATEGORY_DEFS.find((c) => c.label === q.category);
  if (byId) q.category = byId.label;
  else if (!byName) { warnings.push(`${where}: 未知のカテゴリ「${q.category}」。`); /* 致命ではない */ }

  if (!VALID_DIFFICULTY.includes(q.difficulty)) q.difficulty = 'standard';
  if (typeof q.explanation !== 'string') q.explanation = '';
  if (!Array.isArray(q.tags)) q.tags = [];
  if (typeof q.id !== 'string' || !q.id) q.id = `Q${String(idx + 1).padStart(3, '0')}`;
  return true;
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

  // 認証
  if (!verifyAdminToken(body && body.adminToken)) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: '管理者トークンが無効です。再ログインしてください。' });
  }

  const instruction = (body && body.instruction) || '';
  const settings = (body && body.settings) || {};
  const questionCount = Number(settings.questionCount) || 20;
  if (questionCount < 1 || questionCount > 100) {
    return res.status(400).json({ ok: false, code: 'INVALID_COUNT', message: '出題数は1〜100で指定してください。' });
  }

  // カテゴリ配分の検証（定義済みカテゴリのみ）
  const dist = Array.isArray(settings.categoryDistribution) ? settings.categoryDistribution : [];
  for (const d of dist) {
    if (!CATEGORY_IDS.includes(d.categoryId)) {
      return res.status(400).json({ ok: false, code: 'INVALID_CATEGORY', message: `未定義のカテゴリID: ${d.categoryId}` });
    }
  }

  // AI へ渡すユーザープロンプト（個人情報は一切含めない）
  const categoryGuide = CATEGORY_DEFS.map((c) => `${c.id} ${c.label}`).join(' / ');
  const userContent = [
    '次の条件で、企業内AIリテラシー検定の設問案を作成してください。',
    '',
    `# 出題数\n${questionCount}問`,
    `# 難易度\n${settings.difficulty || 'standard'}`,
    `# カテゴリ一覧\n${categoryGuide}`,
    `# カテゴリ配分（weight=問題数の目安, priority=小さいほど優先）\n${JSON.stringify(dist, null, 2)}`,
    `# 管理者からの指示\n${instruction || '（特になし。バランス良く作成してください。）'}`,
    '',
    '# 出力形式（厳守。これ以外の文字を出力しない）',
    '次の JSON オブジェクトのみを出力してください:',
    '{',
    '  "questions": [',
    '    {',
    '      "id": "Q001",',
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
  ].join('\n');

  let aiText;
  try {
    aiText = await callOpenRouter({
      system: GENERATE_SYSTEM_PROMPT,
      user: userContent,
      temperature: 0.4,
      maxTokens: 4000,
      responseFormat: { type: 'json_object' },
    });
  } catch (err) {
    console.error('generate-questions upstream error:', err);
    return res.status(502).json({ ok: false, code: 'AI_UPSTREAM_ERROR', message: 'AI設問生成に失敗しました。時間をおいて再試行してください。' });
  }

  let parsed;
  try {
    parsed = extractJson(aiText);
  } catch (err) {
    console.error('generate-questions parse error:', err, aiText && aiText.slice(0, 300));
    return res.status(502).json({ ok: false, code: 'AI_PARSE_ERROR', message: 'AI応答を解析できませんでした。再試行してください。' });
  }

  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
  const warnings = ['AI生成内容のため、管理者レビュー後に採用してください。'];
  const validQuestions = [];
  rawQuestions.forEach((q, i) => {
    if (validateQuestion(q, i, warnings)) validQuestions.push(q);
  });

  if (validQuestions.length === 0) {
    return res.status(502).json({ ok: false, code: 'AI_EMPTY_RESULT', message: '有効な設問を生成できませんでした。指示を変えて再試行してください。' });
  }
  if (validQuestions.length < questionCount) {
    warnings.push(`要求${questionCount}問に対し、有効な設問は${validQuestions.length}問でした。`);
  }

  // ID を振り直し（重複防止）
  validQuestions.forEach((q, i) => { q.id = `Q${String(i + 1).padStart(3, '0')}`; });

  // 現行セットのメタを引き継いだドラフトを構築
  const current = (body && body.currentQuestionSet) || {};
  const usedCategories = CATEGORY_DEFS.filter((c) => validQuestions.some((q) => q.category === c.label))
    .map((c) => ({ id: c.id, name: c.label }));

  const questionSetDraft = {
    questionSetId: current.questionSetId || 'ai-generated-draft',
    version: 'draft',
    locked: false,
    updatedAt: new Date().toISOString(),
    settings: {
      questionCount: validQuestions.length,
      passingScore: (current.settings && current.settings.passingScore) || 70,
      difficulty: settings.difficulty || 'standard',
      categoryDistributionMode: 'weighted',
      categoryDistribution: dist,
    },
    categories: usedCategories.length ? usedCategories : CATEGORY_DEFS.map((c) => ({ id: c.id, name: c.label })),
    questions: validQuestions,
  };

  return res.status(200).json({ ok: true, questionSetDraft, warnings });
}
