// =========================================================
// tests/scoring.test.js
// 採点ロジックの単体テスト（node tests/scoring.test.js で実行）
// =========================================================
import * as S from '../public/assets/js/scoring.js';

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; console.log(`FAIL ${name}: got ${a} want ${e}`); }
}

// 正誤判定
eq(S.isSingleCorrect([2],[2]), true, 'single ok');
eq(S.isSingleCorrect([1],[2]), false, 'single ng');
eq(S.isMultipleCorrect([0,3,1],[1,0,3]), true, 'multi order-insensitive');
eq(S.isMultipleCorrect([0,1],[0,1,3]), false, 'multi length diff');

// スコア・ランク・偏差値
eq(S.calcScoreRate(16,20), 80, 'scoreRate 80');
eq(S.getRank(90),'S','rank S'); eq(S.getRank(80),'A','rank A');
eq(S.getRank(70),'B','rank B'); eq(S.getRank(60),'C','rank C'); eq(S.getRank(59),'D','rank D');
eq(S.getAiLiteracyDeviation(100), 65, 'dev 100->65');
eq(S.getAiLiteracyDeviation(70), 50, 'dev 70->50');
eq(S.getAiLiteracyDeviation(0), 30, 'dev clamp min');

// 出題配分: 20問・初期重み 3,3,4,4,2,2,2
const def = [
  {categoryId:'C-001',weight:3,priority:3},
  {categoryId:'C-002',weight:3,priority:2},
  {categoryId:'C-003',weight:4,priority:1},
  {categoryId:'C-004',weight:4,priority:1},
  {categoryId:'C-005',weight:2,priority:4},
  {categoryId:'C-006',weight:2,priority:5},
  {categoryId:'C-007',weight:2,priority:6},
];
const a1 = S.resolveCategoryAllocation(20, [], def);
eq(a1.map(d=>d.count), [3,3,4,4,2,2,2], 'alloc 20 default');
eq(a1.reduce((s,d)=>s+d.count,0), 20, 'alloc 20 sum');

const a2 = S.resolveCategoryAllocation(10, def, def);
eq(a2.reduce((s,d)=>s+d.count,0), 10, 'alloc 10 sum');

const a3 = S.resolveCategoryAllocation(20, [{categoryId:'C-001',weight:0,priority:1}], def);
eq(a3.reduce((s,d)=>s+d.count,0), 20, 'alloc all-zero fallback sum');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
