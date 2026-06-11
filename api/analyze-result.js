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
    'コメント本文だけを書いてください。JSONや記号、見出し、引用符で囲む必要はありません。',
    '',
    JSON.stringify(safeSummary, null, 2),
  ].join('\n');

  try {
    const raw = await callOpenRouter({
      system: ANALYZE_SYSTEM_PROMPT,
      user: userContent,
      temperature: 0.3,
      maxTokens: 1200,   // 日本語300字が途中で切れないよう余裕を持たせる
      jsonMode: false,   // プレーンテキストで受け取る（JSON強制を解除）
    });
    const comment = sanitizeComment(raw);
    if (!comment) {
      return res.status(502).json({ ok: false, code: 'AI_EMPTY', message: 'コメントを生成できませんでした。スコアのみ表示します。' });
    }
    return res.status(200).json({ ok: true, comment });
  } catch (err) {
    console.error('analyze-result error:', err && err.message);
    return res.status(502).json({
      ok: false,
      code: 'AI_UPSTREAM_ERROR',
      message: 'コメント生成に失敗しました。スコアのみ表示します。',
    });
  }
}

// AIコメントの後始末。
//  - モデルが {"comment":"..."} のようなJSONを返した場合は comment を取り出す
//  - 前後の波括弧・引用符・コードフェンス・ラベルを除去
//  - 途中で切れた壊れた断片や重複文を整理
function sanitizeComment(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.trim();

  // ```json ... ``` フェンス除去
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  // JSON オブジェクトに見える場合は comment / text フィールドを抽出
  if (/^\{[\s\S]*/.test(text) && /"comment"|"text"/.test(text)) {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj.comment === 'string') text = obj.comment;
      else if (obj && typeof obj.text === 'string') text = obj.text;
    } catch {
      // 壊れたJSON: "comment": "..." の値を、最初の閉じ引用符までで取り出す。
      // [^"\\]*(?:\\.[^"\\]*)* はエスケープを考慮しつつ次の素の " までを取る。
      const m = text.match(/"(?:comment|text)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) {
        text = m[1];
      } else {
        // ラベル以降〜最初の改行/波括弧までを暫定本文とする
        const m2 = text.match(/"(?:comment|text)"\s*:\s*"?([^"\n}]+)/);
        text = m2 ? m2[1] : text.replace(/^\{/, '').replace(/\}$/, '');
      }
    }
  }

  // エスケープ済み改行・引用符を復元/除去
  text = text.replace(/\\n/g, '\n').replace(/\\"/g, '"');
  // 前後の引用符を剥がす
  text = text.replace(/^["'「『]+/, '').replace(/["'」』]+$/, '').trim();

  // 重複した末尾文の除去（壊れた生成で同じ文が複数並ぶケース）
  text = dedupeTrailingSentences(text);

  // 余分な制御文字・連続空白の整理
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

// 文末（。/！/？）で分割し、連続して重複する文を1つにまとめる。
// さらに、閉じ引用符だけ・短すぎる壊れた断片を末尾から落とす。
function dedupeTrailingSentences(text) {
  const parts = text.split(/(?<=[。！？])/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    // 直前と同一、または直前が本文を含むなら重複としてスキップ
    if (out.length && (out[out.length - 1] === p)) continue;
    out.push(p);
  }
  // 末尾の壊れた断片（句点で終わらず、かつ極端に短い）を落とす
  while (out.length > 1) {
    const last = out[out.length - 1];
    if (!/[。！？]$/.test(last) && last.length < 12) out.pop();
    else break;
  }
  return out.join('');
}
