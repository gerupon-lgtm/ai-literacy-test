// =========================================================
// api/analyze-result.js
// 受験結果サマリーから理解度コメントを生成する（Vercel Function）
// =========================================================
import { applyCors, handlePreflight, readJsonBody, callOpenRouter, ANALYZE_SYSTEM_PROMPT } from './_lib.js';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ ok: false, code: 'BAD_JSON', message: 'リクエスト本文を解析できませんでした。' });
  }

  const summary = body && body.resultSummary;
  if (!summary || typeof summary.scoreRate !== 'number') {
    return res.status(400).json({ ok: false, code: 'INVALID_SUMMARY', message: 'resultSummary が不正です。' });
  }

  // 念のためサーバー側でも個人情報になり得るフィールドを除去
  const safeSummary = {
    totalQuestions: summary.totalQuestions,
    correctCount: summary.correctCount,
    scoreRate: summary.scoreRate,
    rank: summary.rank,
    aiLiteracyDeviation: summary.aiLiteracyDeviation,
    categoryScores: Array.isArray(summary.categoryScores) ? summary.categoryScores : [],
    weakCategories: summary.weakCategories || [],
    strongCategories: summary.strongCategories || [],
  };

  const userContent = [
    '以下はある受験者のAIリテラシー検定の結果サマリーです。',
    '企業内利用を前提に、理解度コメントを200〜300字で作成してください。',
    '',
    JSON.stringify(safeSummary, null, 2),
  ].join('\n');

  try {
    const comment = await callOpenRouter({
      system: ANALYZE_SYSTEM_PROMPT,
      user: userContent,
      temperature: 0.3,
      maxTokens: 500,
    });
    return res.status(200).json({ ok: true, comment: comment.trim() });
  } catch (err) {
    console.error('analyze-result error:', err);
    return res.status(502).json({
      ok: false,
      code: 'AI_UPSTREAM_ERROR',
      message: 'コメント生成に失敗しました。スコアのみ表示します。',
    });
  }
}
