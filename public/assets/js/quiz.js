// =========================================================
// quiz.js  出題セットの構築・状態管理
// =========================================================
import { resolveCategoryAllocation } from './scoring.js';

/** 配列をFisher-Yatesでシャッフル（非破壊） */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** categoryId → カテゴリ名 の対応表を作る */
function buildCatNameMap(questionSet) {
  const map = new Map();
  (questionSet.categories || []).forEach((c) => map.set(c.id, c.name));
  return map;
}

/**
 * 設問セットと設定から、実際に出題する設問配列を組み立てる。
 * カテゴリ配分に従って各カテゴリから必要数を取り出す。
 * 設問が足りないカテゴリは在庫上限まで。最終的に questionCount に満たない場合は
 * 残りプールから補充する。
 */
export function buildQuizQuestions(questionSet) {
  const settings = questionSet.settings || {};
  const questionCount = settings.questionCount || questionSet.questions.length;
  const catNameMap = buildCatNameMap(questionSet);

  // 初期配分（categoriesのweightから生成）をdefaultとして用意
  const defaultDist = (questionSet.categories || []).map((c, i) => ({
    categoryId: c.id,
    weight: c.weight || 1,
    priority: i + 1,
  }));
  const dist = settings.categoryDistribution && settings.categoryDistribution.length
    ? settings.categoryDistribution
    : defaultDist;

  const allocation = resolveCategoryAllocation(questionCount, dist, defaultDist);

  // カテゴリ名ごとに設問をプール化
  const poolByCat = new Map();
  questionSet.questions.forEach((q) => {
    if (!poolByCat.has(q.category)) poolByCat.set(q.category, []);
    poolByCat.get(q.category).push(q);
  });

  const picked = [];
  const usedIds = new Set();

  allocation.forEach((a) => {
    const catName = catNameMap.get(a.categoryId) || a.categoryId;
    const pool = poolByCat.get(catName) || [];
    const ordered = settings.randomizeQuestions ? shuffle(pool) : pool;
    for (let i = 0; i < Math.min(a.count, ordered.length); i++) {
      picked.push(ordered[i]);
      usedIds.add(ordered[i].id);
    }
  });

  // 不足時は残りプールから補充
  if (picked.length < questionCount) {
    const rest = questionSet.questions.filter((q) => !usedIds.has(q.id));
    const restOrdered = settings.randomizeQuestions ? shuffle(rest) : rest;
    for (const q of restOrdered) {
      if (picked.length >= questionCount) break;
      picked.push(q);
      usedIds.add(q.id);
    }
  }

  // 全体順序: ランダム指定があれば最後にシャッフル
  let finalQuestions = settings.randomizeQuestions ? shuffle(picked) : picked;

  // 選択肢シャッフル（answerインデックスも追従）
  if (settings.randomizeChoices) {
    finalQuestions = finalQuestions.map((q) => withShuffledChoices(q));
  }

  return finalQuestions.slice(0, questionCount);
}

/** 選択肢をシャッフルし、正解インデックスを対応付け直す */
function withShuffledChoices(q) {
  const idx = q.choices.map((_, i) => i);
  const order = shuffle(idx);
  const choices = order.map((i) => q.choices[i]);
  const answer = q.answer.map((a) => order.indexOf(a)).sort((x, y) => x - y);
  return { ...q, choices, answer };
}

/** 受験状態オブジェクト */
export function createQuizState(questions) {
  return {
    questions,
    index: 0,
    answers: questions.map(() => []), // 各問の選択インデックス配列
  };
}

/** 所要時間目安（1問あたり約40秒で概算、分単位で切り上げ） */
export function estimateMinutes(count) {
  return Math.max(1, Math.ceil((count * 40) / 60));
}
