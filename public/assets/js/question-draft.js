import { CATEGORY_DEFS } from './categories.js?v=1.2.0';
import { pickBrandFields } from './branding.js?v=1.2.0';

export function buildDraftFromQuestions(questions, settings, current, meta) {
  // 設問に実際に登場するカテゴリ（出現順）
  const seen = [];
  questions.forEach((q) => { if (!seen.includes(q.category)) seen.push(q.category); });

  // categories メタ: 既知ラベルは定義の id を使い、未知ラベルは連番IDを振る
  const knownByLabel = new Map(CATEGORY_DEFS.map((c) => [c.label, c]));
  const currentByLabel = new Map((current?.categories || []).map(c => [c.name, c]));
  const used = new Set();
  let extra = 0;
  const categories = seen.map((label) => {
    const def = currentByLabel.get(label) || knownByLabel.get(label);
    let id = def?.id;
    while (!id || used.has(id)) { extra += 1; id = `X-${String(extra).padStart(3, '0')}`; }
    used.add(id);
    return { id, name: label };
  });

  // カテゴリ配分(weight/priority)は「管理者がUIで設定した値」をそのまま保存する。
  // weight は出題数に対する配分比率であり、プールの実問題数で上書きしてはいけない
  //（プールを差し替えても想定した割合を保つため）。
  // 設問に登場するカテゴリのみ残し、設定が無いカテゴリは weight=1 で補う。
  const settingDist = new Map(
    (settings.categoryDistribution || []).map((d) => [d.categoryId, d]));
  const categoryDistribution = categories.map((c, idx) => {
    const d = settingDist.get(c.id);
    return {
      categoryId: c.id,
      weight: d ? Number(d.weight) : 1,
      priority: d ? Number(d.priority) : (idx + 1),
    };
  });

  // 検定での出題数は「管理者が設定した値」を尊重する（プール総数で上書きしない）。
  // ただし在庫(questions.length)を超えないようにクランプ。
  const requested = Number(settings && settings.questionCount) || questions.length;
  const questionCount = Math.min(requested, questions.length);

  // 在庫が出題数より多ければ、検定ごとにランダム抽出するのが自然なのでランダム出題をON。
  const moreThanNeeded = questions.length > questionCount;
  const randomizeQuestions = moreThanNeeded
    ? true
    : ((current && current.settings && current.settings.randomizeQuestions) ?? false);

  return {
    questionSetId: (current && current.questionSetId) || 'ai-generated-draft',
    version: 'draft',
    ...pickBrandFields(current),   // 現在のセットの名称・文言を引き継ぐ
    locked: false,
    updatedAt: new Date().toISOString(),
    generatedBy: meta && meta.provider ? `${meta.provider}/${meta.model}` : 'ai',
    settings: {
      questionCount,
      passingScore: settings.passingScore ?? 70,
      difficulty: settings.difficulty || 'standard',
      randomizeChoices: (current && current.settings && current.settings.randomizeChoices) ?? true,
      randomizeQuestions,
      categoryDistributionMode: 'weighted',
      categoryDistribution,
    },
    categories,
    questions,
  };
}
