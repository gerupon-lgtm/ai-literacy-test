import { questionErrors, setIdError } from './question-set.js?v=1.2.0';

export function importSource(data) {
  return data?.questionSetDraft || data;
}

export function prepareImport(data, assignedId) {
  const source = importSource(data);
  const questions = Array.isArray(source) ? source : source?.questions;
  const existingId = Array.isArray(source) ? '' : source?.questionSetId;
  if (existingId && assignedId && existingId !== assignedId) throw new Error('JSON内のSet IDを読込時に変更できません。');
  const setId = existingId || assignedId;
  const error = setIdError(setId); if (error) throw new Error(error);
  if (!Array.isArray(questions) || !questions.length) throw new Error('設問が見つかりません。');
  const prepared = questions.map((q, i) => {
    const item = { ...q, category: q?.category || '未分類', type: q?.type || 'single', answer: typeof q?.answer === 'number' ? [q.answer] : q?.answer };
    const errors = questionErrors(item, { requireId: false });
    if (errors.length) throw new Error('Q' + (i + 1) + ': ' + errors.join(' '));
    return item;
  });
  return { setId, source: Array.isArray(source) ? { questionSetId: setId } : { ...source, questionSetId: setId }, questions: prepared };
}

export function mergeImport(pool, questions, setId, mode) {
  if (mode === 'cancel') return pool;
  if (!['add', 'replace'].includes(mode)) throw new Error('取込操作が不正です。');
  const kept = mode === 'replace' ? pool.filter(q => q.originSetId !== setId) : pool;
  return [...kept, ...questions.map(q => ({ ...q, originSetId: setId }))];
}
