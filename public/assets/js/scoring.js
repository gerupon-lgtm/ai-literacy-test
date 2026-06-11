// =========================================================
// scoring.js  採点ロジック（AIを使わない固定ロジック）
// 設計書 §7 に準拠
// =========================================================

/** 単一選択の正誤判定 */
export function isSingleCorrect(selected, answer) {
  return selected.length === 1 && answer.length === 1 && selected[0] === answer[0];
}

/** 複数選択の正誤判定（完全一致のみ正解） */
export function isMultipleCorrect(selected, answer) {
  if (selected.length !== answer.length) return false;
  const s = [...selected].sort((a, b) => a - b).join(',');
  const a = [...answer].sort((x, y) => x - y).join(',');
  return s === a;
}

/** 設問1問の正誤 */
export function isCorrect(question, selected) {
  const sel = selected || [];
  if (question.type === 'multiple') {
    return isMultipleCorrect(sel, question.answer);
  }
  return isSingleCorrect(sel, question.answer);
}

/** 総合スコア（正答率） */
export function calcScoreRate(correctCount, totalQuestions) {
  if (totalQuestions <= 0) return 0;
  return Math.round((correctCount / totalQuestions) * 100);
}

/** ランク判定 S/A/B/C/D */
export function getRank(scoreRate) {
  if (scoreRate >= 90) return 'S';
  if (scoreRate >= 80) return 'A';
  if (scoreRate >= 70) return 'B';
  if (scoreRate >= 60) return 'C';
  return 'D';
}

/** ランク別コメント方針 */
export const RANK_COMMENT = {
  S: '実務利用の基礎は十分。管理・推進側も視野に入ります。',
  A: '基本理解は高い水準です。弱点カテゴリの補強を推奨します。',
  B: '一般的な利用は可能。情報管理と安全性を再確認しましょう。',
  C: '利用前に社内ルールと禁止事項の再学習が必要です。',
  D: '業務利用の前に、基礎研修の受講を推奨します。',
};

/** AI理解度偏差値風スコア（30〜75にクランプ） */
export function getAiLiteracyDeviation(scoreRate) {
  const value = 50 + (scoreRate - 70) / 2;
  return Math.max(30, Math.min(75, Math.round(value)));
}

/**
 * カテゴリ別集計
 * @returns [{ category, total, correct, rate }]
 */
export function calcCategoryScores(questions, answers) {
  const map = new Map();
  questions.forEach((q, i) => {
    const cat = q.category;
    if (!map.has(cat)) map.set(cat, { category: cat, total: 0, correct: 0 });
    const entry = map.get(cat);
    entry.total += 1;
    if (isCorrect(q, answers[i])) entry.correct += 1;
  });
  return [...map.values()].map((e) => ({
    ...e,
    rate: e.total ? Math.round((e.correct / e.total) * 100) : 0,
  }));
}

/**
 * 受験結果サマリー一式を組み立てる
 */
export function buildResultSummary(questions, answers) {
  const totalQuestions = questions.length;
  let correctCount = 0;
  questions.forEach((q, i) => { if (isCorrect(q, answers[i])) correctCount += 1; });

  const scoreRate = calcScoreRate(correctCount, totalQuestions);
  const rank = getRank(scoreRate);
  const aiLiteracyDeviation = getAiLiteracyDeviation(scoreRate);
  const categoryScores = calcCategoryScores(questions, answers);

  // 苦手/得意（率の昇順・降順）。同率は出現順を保つ。
  const sortedByRate = [...categoryScores].sort((a, b) => a.rate - b.rate);
  const weakCategories = sortedByRate.filter((c) => c.rate < 60).map((c) => c.category);
  const strongCategories = [...categoryScores].filter((c) => c.rate >= 80).map((c) => c.category);

  return {
    totalQuestions,
    correctCount,
    scoreRate,
    rank,
    aiLiteracyDeviation,
    categoryScores,
    weakCategories,
    strongCategories,
  };
}

// =========================================================
// 出題割合決定ロジック（設計書 §7.5 / 仕様書 §5.3）
// =========================================================
/**
 * @param {number} questionCount  目標出題数
 * @param {Array<{categoryId,weight,priority}>} distributions 管理者設定
 * @param {Array<{categoryId,weight,priority}>} defaultDistribution 初期配分
 * @returns {Array<{categoryId,weight,priority,count}>}
 */
export function resolveCategoryAllocation(questionCount, distributions, defaultDistribution) {
  const valid = (distributions || []).filter((d) => d && d.weight > 0);
  const source = valid.length ? valid : defaultDistribution;

  const totalWeight = source.reduce((sum, d) => sum + d.weight, 0);
  if (totalWeight <= 0) {
    // 念のためのガード: すべて0なら均等割り
    return source.map((d) => ({ ...d, count: Math.floor(questionCount / source.length) }));
  }

  const raw = source.map((d) => ({
    ...d,
    exact: (questionCount * d.weight) / totalWeight,
  }));

  const allocated = raw.map((d) => ({
    ...d,
    count: Math.floor(d.exact),
    fraction: d.exact - Math.floor(d.exact),
  }));

  let diff = questionCount - allocated.reduce((sum, d) => sum + d.count, 0);

  // 不足分は優先度が高い(数値が小さい)カテゴリから追加
  while (diff > 0) {
    allocated
      .slice()
      .sort((a, b) => a.priority - b.priority || b.weight - a.weight || b.fraction - a.fraction)[0]
      .count++;
    diff--;
  }
  // 超過分は優先度が低い(数値が大きい)カテゴリから削減
  while (diff < 0) {
    const target = allocated
      .filter((d) => d.count > 0)
      .sort((a, b) => b.priority - a.priority || a.weight - b.weight)[0];
    if (!target) break;
    target.count--;
    diff++;
  }

  return allocated;
}
