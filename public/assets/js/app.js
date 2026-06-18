// =========================================================
// app.js  受験者向けメインコントローラ
// =========================================================
import { buildQuizQuestions, createQuizState, estimateMinutes, validateQuestionSet } from './quiz.js';
import { buildResultSummary, RANK_COMMENT } from './scoring.js';
import { renderRadar, downloadRadarPng, resultToPngBlob } from './chart.js';
import {
  copyResult, csvBlob, txtBlob, downloadBlob,
  shareResultByEmail, buildResultText,
} from './export.js';
import { analyzeResult, isApiConfigured } from './apiClient.js';

const QUESTION_SET_URL = 'data/current-question-set.json';

const els = {};
let questionSet = null;
let quiz = null;
let summary = null;
let aiComment = '';

// ---------- 起動 ----------
document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheEls();
  bindEvents();
  try {
    // キャッシュバスター（タイムスタンプ）を付けてCDN/ブラウザの古いキャッシュを回避し、
    // セット切替直後でも最新の設問データを取得しやすくする。
    const url = `${QUESTION_SET_URL}?t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('設問データを取得できませんでした。');
    questionSet = await res.json();
    fillTopMeta(); // 内部で出題セットを検証し、開始ボタンの有効/無効を制御
  } catch (err) {
    showToast('設問データの読み込みに失敗しました。');
    console.error(err);
  }
}

function cacheEls() {
  const id = (x) => document.getElementById(x);
  Object.assign(els, {
    screens: {
      top: id('screen-top'),
      quiz: id('screen-quiz'),
      loading: id('screen-loading'),
      result: id('screen-result'),
    },
    metaCount: id('meta-count'), metaTime: id('meta-time'), metaPass: id('meta-pass'),
    btnStart: id('btn-start'),
    // quiz
    qCurrent: id('q-current'), qTotal: id('q-total'),
    qProgressCat: id('q-progress-cat'), qProgressFill: id('q-progress-fill'),
    qCategoryTag: id('q-category-tag'), qText: id('q-text'),
    qMultiHint: id('q-multi-hint'), qChoices: id('q-choices'),
    btnPrev: id('btn-prev'), btnNext: id('btn-next'), btnAbort: id('btn-abort'),
    // result
    rRank: id('r-rank'), rScore: id('r-score'), rRankComment: id('r-rank-comment'),
    rCorrect: id('r-correct'), rQtotal: id('r-qtotal'),
    rDeviation: id('r-deviation'), rPassmark: id('r-passmark'),
    radar: id('radar'), catTableBody: id('cat-table-body'),
    aiComment: id('ai-comment'), aiCommentText: id('ai-comment-text'),
    reviewList: id('review-list'),
    btnCopy: id('btn-copy'), btnCsv: id('btn-csv'), btnPng: id('btn-png'),
    btnShare: id('btn-share'), btnRetry: id('btn-retry'),
    shareHint: id('share-hint'),
    toast: id('toast'),
  });
}

function bindEvents() {
  els.btnStart.addEventListener('click', startQuiz);
  els.btnPrev.addEventListener('click', () => goTo(quiz.index - 1));
  els.btnNext.addEventListener('click', onNext);
  els.btnAbort.addEventListener('click', () => {
    if (confirm('受験を中断してトップへ戻りますか？回答内容は失われます。')) showScreen('top');
  });
  els.btnRetry.addEventListener('click', () => showScreen('top'));
  const btnHome = document.getElementById('btn-home');
  if (btnHome) btnHome.addEventListener('click', () => { showScreen('top'); window.scrollTo({ top: 0 }); });
  els.btnCopy.addEventListener('click', onCopy);
  els.btnCsv.addEventListener('click', () => {
    downloadBlob(csvBlob(summary), 'ai-literacy-result.csv');
    showToast('CSVを保存しました。');
  });
  els.btnPng.addEventListener('click', async () => {
    // スコア・レーダー・カテゴリ別横棒を1枚に合成して保存
    const cats = (summary.categoryScores || []).map((c) => ({ name: c.category, ratePercent: c.rate }));
    let blob = null;
    try {
      blob = await resultToPngBlob({
        rank: summary.rank,
        scoreRate: summary.scoreRate,
        correctCount: summary.correctCount,
        totalQuestions: summary.totalQuestions,
        aiLiteracyDeviation: summary.aiLiteracyDeviation,
        passingScore: (questionSet.settings && questionSet.settings.passingScore),
        categories: cats,
      });
    } catch (e) { blob = null; }
    if (blob) {
      downloadBlob(blob, `ai-literacy-result_${jstStampApp()}.png`);
      showToast('結果画像を保存しました。');
    } else {
      // フォールバック: レーダーのみ
      const ok = await downloadRadarPng(`ai-literacy-radar_${jstStampApp()}.png`);
      showToast(ok ? 'チャート画像を保存しました。' : '画像を保存できませんでした。');
    }
  });
  els.btnShare.addEventListener('click', onShare);

  // キーボード操作: 数字キーで選択肢、Enterで次へ
  document.addEventListener('keydown', onKeydown);
}

// ---------- トップ ----------
function fillTopMeta() {
  const s = questionSet.settings || {};
  const count = s.questionCount || questionSet.questions.length;
  els.metaCount.innerHTML = `${count}<small>問</small>`;
  els.metaTime.innerHTML = `${estimateMinutes(count)}<small>分</small>`;
  els.metaPass.innerHTML = `${s.passingScore ?? 70}<small>%</small>`;

  // 出題セット名を表示
  const nameEl = document.getElementById('set-name-display');
  if (nameEl) {
    const setName = questionSet.questionSetId || '';
    const ver = questionSet.version ? ` (v${questionSet.version})` : '';
    nameEl.textContent = setName ? `出題セット: ${setName}${ver}` : '';
  }

  // 出題セットが十分かを検証し、不足なら開始をブロック
  const check = validateQuestionSet(questionSet);
  const alertEl = document.getElementById('start-alert');
  if (!check.ok) {
    if (els.btnStart) { els.btnStart.disabled = true; }
    if (alertEl) {
      alertEl.innerHTML =
        `<div class="alert alert-error">`
        + `この検定は現在受験できません。`
        + `出題数 <b>${check.questionCount}</b> 問に対し、設問が <b>${check.available}</b> 問しかありません`
        + `（${check.shortBy} 問不足）。<br>`
        + `管理者の方は、管理画面で設問を追加するか出題数を調整し、設問セットを更新してください。`
        + `</div>`;
    }
  } else {
    if (els.btnStart) { els.btnStart.disabled = false; }
    if (alertEl) alertEl.innerHTML = '';
  }
}

// ---------- 画面遷移 ----------
function showScreen(name) {
  Object.entries(els.screens).forEach(([k, el]) => {
    el.classList.toggle('hidden', k !== name);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- 受験開始 ----------
function startQuiz() {
  // 念のため開始時にも検証（ボタン無効化のすり抜け対策）
  const check = validateQuestionSet(questionSet);
  if (!check.ok) {
    fillTopMeta(); // アラートを再表示
    return;
  }
  const questions = buildQuizQuestions(questionSet);
  quiz = createQuizState(questions);
  els.qTotal.textContent = questions.length;
  showScreen('quiz');
  renderQuestion();
}

function renderQuestion() {
  const q = quiz.questions[quiz.index];
  const total = quiz.questions.length;
  const num = quiz.index + 1;

  els.qCurrent.textContent = num;
  els.qProgressFill.style.width = `${(num / total) * 100}%`;
  els.qProgressCat.textContent = q.category;
  els.qCategoryTag.textContent = q.category;
  els.qText.textContent = q.question;
  els.qMultiHint.classList.toggle('hidden', q.type !== 'multiple');

  // 選択肢描画
  els.qChoices.innerHTML = '';
  const selected = quiz.answers[quiz.index];
  q.choices.forEach((choice, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice' + (q.type === 'multiple' ? ' multi' : '');
    btn.setAttribute('aria-pressed', selected.includes(i) ? 'true' : 'false');
    btn.dataset.index = i;
    const marker = q.type === 'multiple'
      ? (selected.includes(i) ? '✓' : '')
      : String.fromCharCode(65 + i); // A,B,C,D
    btn.innerHTML = `<span class="marker">${marker}</span><span class="ctext">${escapeHtml(choice)}</span>`;
    btn.addEventListener('click', () => toggleChoice(i));
    li.appendChild(btn);
    els.qChoices.appendChild(li);
  });

  // ナビゲーション状態
  els.btnPrev.disabled = quiz.index === 0;
  els.btnNext.textContent = quiz.index === total - 1 ? '結果を見る →' : '次へ →';
  updateNextEnabled();
}

function toggleChoice(i) {
  const q = quiz.questions[quiz.index];
  const sel = quiz.answers[quiz.index];
  if (q.type === 'multiple') {
    const pos = sel.indexOf(i);
    if (pos >= 0) sel.splice(pos, 1); else sel.push(i);
  } else {
    quiz.answers[quiz.index] = sel[0] === i ? [] : [i];
  }
  renderQuestion();
}

function updateNextEnabled() {
  const sel = quiz.answers[quiz.index];
  els.btnNext.disabled = sel.length === 0;
}

function onNext() {
  const total = quiz.questions.length;
  if (quiz.index === total - 1) {
    finishQuiz();
  } else {
    goTo(quiz.index + 1);
  }
}

function goTo(i) {
  if (i < 0 || i >= quiz.questions.length) return;
  quiz.index = i;
  renderQuestion();
}

// ---------- 結果 ----------
async function finishQuiz() {
  summary = buildResultSummary(quiz.questions, quiz.answers);
  aiComment = '';

  // 採点・集計中のローディング画面を表示
  showScreen('loading');
  window.scrollTo({ top: 0 });

  // AIコメントを取得（タイムアウト付き）。結果のレンダリングはこの後に行うので、
  // コメントが揃った状態で結果画面を表示できる。
  await prepareAiComment();

  // 結果を描画して結果画面へ
  renderResult();
  setAiComment(aiComment);
  showScreen('result');
  window.scrollTo({ top: 0 });
}

// AIコメントを準備する（取得 or フォールバック）。
// 最大待機時間を設け、それを超えたらフォールバック文面で先に進む。
async function prepareAiComment() {
  if (!isApiConfigured()) {
    aiComment = fallbackComment(summary);
    return;
  }
  const sub = document.getElementById('loading-sub');
  if (sub) sub.textContent = 'AIがあなたの理解度を分析し、コメントを作成しています…';

  const TIMEOUT_MS = 25000;
  try {
    const comment = await Promise.race([
      analyzeResult(summary),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    aiComment = comment || fallbackComment(summary);
  } catch (err) {
    console.warn('AIコメント生成に失敗またはタイムアウト:', err);
    aiComment = fallbackComment(summary);
  }
}

function renderResult() {
  els.rRank.textContent = summary.rank;
  els.rRank.dataset.rank = summary.rank;
  els.rScore.textContent = summary.scoreRate;
  els.rRankComment.textContent = RANK_COMMENT[summary.rank] || '';
  els.rCorrect.textContent = summary.correctCount;
  els.rQtotal.textContent = summary.totalQuestions;
  els.rDeviation.textContent = summary.aiLiteracyDeviation;

  const passing = questionSet.settings?.passingScore ?? 70;
  const passed = summary.scoreRate >= passing;
  els.rPassmark.textContent = passed ? '合格' : '要再学習';
  els.rPassmark.style.color = passed ? 'var(--green-400)' : 'var(--coral-300)';

  // レーダーチャート（カテゴリ順は設問セットのcategories順に揃える）
  const order = (questionSet.categories || []).map((c) => c.name);
  const ordered = order
    .map((name) => summary.categoryScores.find((c) => c.category === name))
    .filter(Boolean);
  const labels = ordered.map((c) => c.category);
  const data = ordered.map((c) => c.rate);
  renderRadar(els.radar, labels, data);

  // カテゴリ別テーブル
  els.catTableBody.innerHTML = '';
  ordered.forEach((c) => {
    const tr = document.createElement('tr');
    const barClass = c.rate < 60 ? 'low' : (c.rate < 80 ? 'mid' : '');
    tr.innerHTML = `
      <td>${escapeHtml(c.category)}</td>
      <td class="hide-sm">${c.correct}/${c.total}</td>
      <td><div class="cat-bar ${barClass}"><span style="width:${c.rate}%"></span></div></td>
      <td class="num">${c.rate}%</td>`;
    els.catTableBody.appendChild(tr);
  });

  // 復習ポイント（間違えた問題）
  renderReview();
}

function renderReview() {
  els.reviewList.innerHTML = '';
  const wrongs = [];
  quiz.questions.forEach((q, i) => {
    const sel = quiz.answers[i];
    const correct = isAnswerCorrect(q, sel);
    if (!correct) wrongs.push(q);
  });

  if (wrongs.length === 0) {
    els.reviewList.innerHTML =
      '<li class="review-item"><div class="rexp">全問正解です。安全なAI活用の基礎は十分に身についています。</div></li>';
    return;
  }
  wrongs.forEach((q) => {
    const li = document.createElement('li');
    li.className = 'review-item';
    li.innerHTML = `
      <div class="rmeta">${escapeHtml(q.category)}</div>
      <div class="rq">${escapeHtml(q.question)}</div>
      <div class="rexp">${escapeHtml(q.explanation)}</div>`;
    els.reviewList.appendChild(li);
  });
}

function isAnswerCorrect(q, sel) {
  const s = sel || [];
  if (q.type === 'multiple') {
    if (s.length !== q.answer.length) return false;
    return [...s].sort((a, b) => a - b).join(',') === [...q.answer].sort((a, b) => a - b).join(',');
  }
  return s.length === 1 && q.answer.length === 1 && s[0] === q.answer[0];
}

// ---------- AIコメント ----------
function setAiComment(text) {
  els.aiComment.classList.remove('loading');
  // 先頭の空白・改行（全角スペース含む）を除去して表示位置を整える。
  // pre-wrap で表示するため、先頭に余白があると視覚的に空いて見える。
  const cleaned = String(text == null ? '' : text).replace(/^[\s\u3000]+/, '');
  els.aiCommentText.textContent = cleaned;
}

/** AI未連携・失敗時のローカル生成コメント */
function fallbackComment(s) {
  const strong = s.strongCategories.length ? s.strongCategories.join('・') : null;
  const weak = s.weakCategories.length ? s.weakCategories.join('・') : null;
  let msg = `総合スコアは${s.scoreRate}点（ランク${s.rank}）でした。`;
  if (strong) msg += `\n${strong}の理解度が高く、企業内利用の土台ができています。`;
  if (weak) {
    msg += `\n一方で${weak}は正答率が伸びていません。該当カテゴリの解説を読み返し、社内ガイドラインと合わせて再確認すると安全に活用できます。`;
  } else {
    msg += `\n各カテゴリのバランスも取れています。今後は最新トレンドの変化にも目を向けていきましょう。`;
  }
  return msg;
}

// ---------- 保存・共有 ----------
async function onCopy() {
  const ok = await copyResult(summary, aiComment);
  showToast(ok ? '結果をコピーしました。' : 'コピーできませんでした。');
}

async function onShare() {
  els.btnShare.disabled = true;
  const original = els.btnShare.textContent;
  els.btnShare.innerHTML = '<span class="spin"></span> 準備中…';
  try {
    const result = await shareResultByEmail(summary, aiComment);
    if (result === 'shared') showToast('共有シートを開きました。');
    else if (result === 'fallback') {
      showToast('結果を保存しました。メール画面に手動で添付してください。');
      els.shareHint.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (err) {
    console.error(err);
    showToast('共有に失敗しました。');
  } finally {
    els.btnShare.disabled = false;
    els.btnShare.textContent = original;
  }
}

// ---------- キーボード ----------
function onKeydown(e) {
  if (els.screens.quiz.classList.contains('hidden')) return;
  const q = quiz.questions[quiz.index];
  // 数字キー 1-9 で選択肢トグル
  if (e.key >= '1' && e.key <= '9') {
    const i = parseInt(e.key, 10) - 1;
    if (i < q.choices.length) { toggleChoice(i); e.preventDefault(); }
  } else if (e.key === 'Enter' && !els.btnNext.disabled) {
    onNext(); e.preventDefault();
  } else if (e.key === 'ArrowLeft' && !els.btnPrev.disabled) {
    goTo(quiz.index - 1); e.preventDefault();
  }
}

// ---------- ユーティリティ ----------
let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 日本時間の yyyyMMddHHmmss（ファイル名用）
function jstStampApp() {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}
