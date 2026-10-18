// Shared validation for browser imports and server-side publication.
export function questionErrors(q, { requireId = true } = {}) {
  const errors = [];
  if (!q || typeof q !== 'object' || Array.isArray(q)) return ['設問がオブジェクトではありません。'];
  const text = v => typeof v === 'string' && v.trim().length > 0;
  if (requireId && !text(q.id)) errors.push('問題IDがありません。');
  if (!text(q.category)) errors.push('カテゴリ名がありません。');
  if (!text(q.question)) errors.push('問題文が空です。');
  if (!Array.isArray(q.choices) || q.choices.length < 2 || !q.choices.every(text)) errors.push('選択肢は空でない文字列を2個以上にしてください。');
  if (!['single', 'multiple'].includes(q.type)) errors.push('形式はsingleまたはmultipleにしてください。');
  if (!Array.isArray(q.answer) || !q.answer.length || !q.answer.every(i => Number.isInteger(i) && i >= 0 && i < (q.choices?.length || 0))) errors.push('正解番号がありません、または選択肢の範囲外です。');
  else if (new Set(q.answer).size !== q.answer.length || (q.type === 'single' && q.answer.length !== 1)) errors.push('正解番号の重複、または単一選択の正解数が不正です。');
  return errors;
}

export function setIdError(value) {
  return typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 64
    ? 'Set IDは前後の空白なし・1〜64文字で入力してください。' : '';
}

export function questionSetErrors(set) {
  if (!set || typeof set !== 'object' || Array.isArray(set)) return ['設問セットがオブジェクトではありません。'];
  const errors = [];
  const idError = setIdError(set.questionSetId); if (idError) errors.push(idError);
  if (!Array.isArray(set.questions) || !set.questions.length) return [...errors, '設問を1問以上用意してください。'];
  const settings = set.settings || {};
  if (!Number.isInteger(settings.questionCount) || settings.questionCount < 1 || settings.questionCount > set.questions.length) errors.push('出題数は1以上の整数で、設問数以下にしてください。');
  if (!Number.isInteger(settings.passingScore) || settings.passingScore < 0 || settings.passingScore > 100) errors.push('合格ラインは0〜100の整数にしてください。');
  for (const key of ['randomizeQuestions', 'randomizeChoices']) if (settings[key] != null && typeof settings[key] !== 'boolean') errors.push(key + 'はtrue/falseで指定してください。');
  const cats = Array.isArray(set.categories) ? set.categories : [];
  const ids = new Set(), names = new Set(), questionIds = new Set();
  if (!cats.length) errors.push('カテゴリを1個以上定義してください。');
  for (const c of cats) {
    if (!c || typeof c.id !== 'string' || !c.id.trim() || typeof c.name !== 'string' || !c.name.trim() || ids.has(c.id) || names.has(c.name)) errors.push('カテゴリのID・名前が空、または重複しています。');
    else { ids.add(c.id); names.add(c.name); }
  }
  for (let i = 0; i < set.questions.length && errors.length < 20; i++) {
    const q = set.questions[i];
    errors.push(...questionErrors(q).map(e => 'Q' + (i + 1) + ': ' + e));
    if (!q || typeof q !== 'object') continue;
    if (questionIds.has(q.id)) errors.push('問題ID ' + q.id + ' が重複しています。');
    questionIds.add(q.id);
    if (!names.has(q.category)) errors.push('Q' + (i + 1) + ': カテゴリ名が定義と一致しません。');
  }
  const dist = settings.categoryDistribution;
  if (dist != null && !Array.isArray(dist)) errors.push('カテゴリ配分は配列にしてください。');
  if (Array.isArray(dist)) {
    const used = new Set();
    for (const d of dist) {
      if (!d || !ids.has(d.categoryId) || used.has(d.categoryId) || !Number.isInteger(d.weight) || d.weight < 0 || !Number.isInteger(d.priority) || d.priority < 1) errors.push('カテゴリ配分のID・重み・優先度が不正です。');
      if (d) used.add(d.categoryId);
    }
  }
  return errors.slice(0, 20);
}
