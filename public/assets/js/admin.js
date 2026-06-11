// =========================================================
// admin.js  管理者コンソール
// =========================================================
import { resolveCategoryAllocation } from './scoring.js';
import { downloadBlob } from './export.js';
import { adminLogin, generateQuestions, listModels, isApiConfigured } from './apiClient.js';

const QUESTION_SET_URL = 'data/current-question-set.json';

let questionSet = null;
let adminToken = null;
let draftSet = null;       // 生成された設問案
let distRows = [];         // 配分行 [{categoryId,name,weight,priority}]

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  try {
    const res = await fetch(QUESTION_SET_URL, { cache: 'no-store' });
    questionSet = await res.json();
  } catch (e) {
    console.error(e);
  }
});

function bindEvents() {
  $('btn-login').addEventListener('click', onLogin);
  $('admin-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') onLogin(); });
  $('btn-logout').addEventListener('click', onLogout);
  $('btn-recalc').addEventListener('click', recalcDistribution);
  $('btn-reset-dist').addEventListener('click', () => { buildDistRowsFromSet(); renderDistTable(); recalcDistribution(); });
  $('set-count').addEventListener('change', recalcDistribution);
  $('btn-generate').addEventListener('click', onGenerate);
  $('btn-diagnose').addEventListener('click', onDiagnose);
  $('btn-adopt').addEventListener('click', onAdopt);
  $('btn-discard').addEventListener('click', onDiscard);
  $('instruction').addEventListener('input', (e) => {
    $('instr-count').textContent = e.target.value.length;
  });
}

// ---------- ログイン ----------
async function onLogin() {
  const pass = $('admin-pass').value.trim();
  if (!pass) { setAlert('login-alert', 'error', 'パスワードを入力してください。'); return; }

  // API未設定: ローカル確認モード（認証スキップ）
  if (!isApiConfigured()) {
    adminToken = 'local-mode';
    enterDashboard();
    showToast('ローカル確認モードで入りました。');
    return;
  }

  setAlert('login-alert', 'info', '<span class="spin"></span> 認証中…');
  try {
    const data = await adminLogin(pass);
    adminToken = data.adminToken;
    clearAlert('login-alert');
    enterDashboard();
  } catch (err) {
    setAlert('login-alert', 'error', err.message || 'ログインに失敗しました。');
  }
}

function onLogout() {
  adminToken = null;
  $('admin-pass').value = '';
  $('admin-dash').classList.add('hidden');
  $('admin-login').classList.remove('hidden');
  window.scrollTo({ top: 0 });
}

function enterDashboard() {
  $('admin-login').classList.add('hidden');
  $('admin-dash').classList.remove('hidden');
  fillCurrentSet();
  buildDistRowsFromSet();
  renderDistTable();
  recalcDistribution();
  window.scrollTo({ top: 0 });
}

// ---------- 現在の設問セット表示 ----------
function fillCurrentSet() {
  if (!questionSet) return;
  const s = questionSet.settings || {};
  $('d-setid').textContent = questionSet.questionSetId || '—';
  $('d-version').textContent = questionSet.version || '—';
  $('d-updated').textContent = questionSet.updatedAt || '—';
  $('d-locked').textContent = questionSet.locked ? 'ロック中' : '未ロック';
  $('d-count').textContent = (s.questionCount ?? '—') + ' 問';
  $('d-pass').textContent = (s.passingScore ?? '—') + ' %';
  $('d-stock').textContent = (questionSet.questions?.length ?? 0) + ' 問';

  // フォーム初期値
  if (s.questionCount) $('set-count').value = String(s.questionCount);
  if (s.difficulty) $('set-difficulty').value = s.difficulty;
  if (s.passingScore != null) $('set-pass').value = s.passingScore;
}

// ---------- 配分テーブル ----------
function buildDistRowsFromSet() {
  const cats = questionSet.categories || [];
  const dist = questionSet.settings?.categoryDistribution || [];
  distRows = cats.map((c, i) => {
    const found = dist.find((d) => d.categoryId === c.id);
    return {
      categoryId: c.id,
      name: c.name,
      weight: found ? found.weight : (c.weight || 1),
      priority: found ? found.priority : (i + 1),
    };
  });
}

function renderDistTable() {
  const body = $('dist-body');
  body.innerHTML = '';
  distRows.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(row.name)}</td>
      <td><input type="number" min="0" max="99" value="${row.weight}" data-i="${i}" data-f="weight" aria-label="${escapeHtml(row.name)}の重み"></td>
      <td><input type="number" min="1" max="99" value="${row.priority}" data-i="${i}" data-f="priority" aria-label="${escapeHtml(row.name)}の優先度"></td>
      <td class="dist-preview" id="dist-count-${i}">—</td>`;
    body.appendChild(tr);
  });
  body.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const i = +e.target.dataset.i, f = e.target.dataset.f;
      distRows[i][f] = Math.max(0, parseInt(e.target.value, 10) || 0);
    });
    inp.addEventListener('change', recalcDistribution);
  });
}

function recalcDistribution() {
  const count = parseInt($('set-count').value, 10) || 20;
  const defaultDist = (questionSet.categories || []).map((c, i) => ({
    categoryId: c.id, weight: c.weight || 1, priority: i + 1,
  }));
  const dist = distRows.map((r) => ({ categoryId: r.categoryId, weight: r.weight, priority: r.priority }));
  const allocation = resolveCategoryAllocation(count, dist, defaultDist);

  // 行ごとの配分を反映
  let countSum = 0, weightSum = 0;
  distRows.forEach((r, i) => {
    const a = allocation.find((x) => x.categoryId === r.categoryId);
    const c = a ? a.count : 0;
    $(`dist-count-${i}`).textContent = c;
    countSum += c;
    weightSum += r.weight;
  });
  $('dist-weight-sum').textContent = weightSum;
  $('dist-count-sum').textContent = countSum;

  // 補正が発生したか案内
  const allZero = distRows.every((r) => r.weight === 0);
  if (allZero) {
    setAlert('dist-alert', 'warn', '全カテゴリの重みが0のため、初期出題バランスを使用します。');
  } else if (countSum !== count) {
    setAlert('dist-alert', 'warn', `配分合計(${countSum})が出題数(${count})と一致しないため補正しました。`);
  } else {
    setAlert('dist-alert', 'info', `出題数 ${count} 問に対し、優先度を考慮して配分しました。`);
  }
}

// ---------- 設問生成 ----------
async function onDiagnose() {
  if (!isApiConfigured()) {
    setAlert('diag-result', 'warn', 'API未設定のため診断できません。<code>config.js</code> に Vercel のURLを設定してください。');
    return;
  }
  setAlert('diag-result', 'info', '<span class="spin"></span> 各プロバイダの利用可能モデルを確認中…');
  $('btn-diagnose').disabled = true;
  try {
    const results = await listModels(adminToken, 'all');
    const blocks = [];

    // Gemini
    if (results.gemini) {
      const g = results.gemini;
      if (!g.configured) blocks.push('<b>Gemini</b>: 未設定');
      else if (g.note) blocks.push(`<b>Gemini</b>: エラー（${escapeHtml(g.note)}）`);
      else blocks.push(`<b>Gemini</b>: ${g.count} モデル利用可<br><small>${(g.models || []).slice(0, 30).map(escapeHtml).join(', ')}</small>`);
    }
    // OpenRouter
    if (results.openrouter) {
      const o = results.openrouter;
      if (!o.configured) blocks.push('<b>OpenRouter</b>: 未設定');
      else if (o.note) blocks.push(`<b>OpenRouter</b>: エラー（${escapeHtml(o.note)}）`);
      else blocks.push(`<b>OpenRouter</b>: 無料モデル ${o.freeCount} 件<br><small>${(o.freeModels || []).slice(0, 30).map(escapeHtml).join(', ')}</small>`);
    }
    // Ollama
    if (results.ollama) {
      const ol = results.ollama;
      if (ol.note) blocks.push(`<b>Ollama</b>: ${escapeHtml(ol.note)}`);
      else blocks.push(`<b>Ollama</b>: ${ol.count} モデル<br><small>${(ol.models || []).map(escapeHtml).join(', ')}</small>`);
    }

    setAlert('diag-result', 'info',
      '利用可能モデル診断結果：<br>' + blocks.join('<br><br>') +
      '<br><br><small>このモデル名を Vercel の環境変数（GEMINI_MODEL / OPENROUTER_MODEL / OLLAMA_MODEL）に設定すると確実です。</small>');
  } catch (err) {
    setAlert('diag-result', 'error', '診断に失敗しました：' + escapeHtml(err.message || ''));
  } finally {
    $('btn-diagnose').disabled = false;
  }
}

async function onGenerate() {
  const instruction = $('instruction').value.trim();
  // 空欄でもOK（サーバ側で既定の生成指示を採用）

  if (!isApiConfigured()) {
    setAlert('gen-alert', 'warn',
      'API未設定のため設問生成は実行できません。<code>config.js</code> に Vercel のURLを設定してください。配分計算とJSON出力は利用できます。');
    return;
  }

  const payload = buildGeneratePayload(instruction);
  const count = payload.settings.questionCount;
  const batchSize = 5;
  const totalBatches = Math.ceil(count / batchSize);

  setAlert('gen-alert', 'info',
    `<span class="spin"></span> 設問案を分割生成しています… 0/${totalBatches} バッチ（0/${count} 問）`);
  $('btn-generate').disabled = true;

  try {
    const result = await generateQuestions({
      adminToken,
      instruction,  // 空文字ならサーバが既定指示を採用
      settings: payload.settings,
      currentQuestionSet: payload.currentQuestionSet,
      batchSize,
      onProgress: (info) => {
        const prov = info.provider ? `（${info.provider} / ${info.model}）` : '';
        setAlert('gen-alert', 'info',
          `<span class="spin"></span> 生成中… ${info.batchIndex + 1}/${info.totalBatches} バッチ` +
          `（${info.collected}/${count} 問）${prov}`);
      },
    });

    // 結合結果から questionSetDraft を組み立てる
    draftSet = buildDraftFromQuestions(result.questions, payload.settings, questionSet, result);
    clearAlert('gen-alert');
    const provNote = result.provider ? `（${result.provider} / ${result.model}）` : '';
    const warnNote = (result.warnings && result.warnings.length)
      ? `<br><small>注意: ${result.warnings.slice(0, 3).map(escapeHtml).join(' / ')}</small>` : '';
    setAlert('gen-alert', 'info', `生成が完了しました：${result.questions.length} 問 ${provNote}${warnNote}`);
    renderPreview(draftSet, result.warnings);
  } catch (err) {
    // 途中まで取れていれば部分採用できるよう案内
    const partial = err.partial && err.partial.length
      ? `（${err.partial.length} 問まで生成済み。再試行するか、回数を減らして再実行してください）` : '';
    setAlert('gen-alert', 'error', (err.message || '生成に失敗しました。') + partial);
    if (err.partial && err.partial.length) {
      draftSet = buildDraftFromQuestions(err.partial, payload.settings, questionSet, {});
      renderPreview(draftSet, err.warnings || []);
    }
  } finally {
    $('btn-generate').disabled = false;
  }
}

// 結合済み設問配列から questionSetDraft を構築
function buildDraftFromQuestions(questions, settings, current, meta) {
  const used = [];
  const seen = new Set();
  questions.forEach((q) => {
    if (!seen.has(q.category)) { seen.add(q.category); }
  });
  // カテゴリメタは現行 categories を流用（無ければ設問から）
  const categories = (current && current.categories) ||
    [...seen].map((label, i) => ({ id: `C-${String(i + 1).padStart(3, '0')}`, name: label }));

  return {
    questionSetId: (current && current.questionSetId) || 'ai-generated-draft',
    version: 'draft',
    locked: false,
    updatedAt: new Date().toISOString(),
    generatedBy: meta && meta.provider ? `${meta.provider}/${meta.model}` : 'ai',
    settings: {
      questionCount: questions.length,
      passingScore: settings.passingScore || 70,
      difficulty: settings.difficulty || 'standard',
      randomizeChoices: (current && current.settings && current.settings.randomizeChoices) ?? true,
      randomizeQuestions: (current && current.settings && current.settings.randomizeQuestions) ?? false,
      categoryDistributionMode: 'weighted',
      categoryDistribution: settings.categoryDistribution || [],
    },
    categories,
    questions,
  };
}

function buildGeneratePayload(instruction) {
  const count = parseInt($('set-count').value, 10) || 20;
  return {
    adminToken,
    instruction,
    settings: {
      questionCount: count,
      passingScore: parseInt($('set-pass').value, 10) || 70,
      difficulty: $('set-difficulty').value,
      categoryDistributionMode: 'weighted',
      categoryDistribution: distRows.map((r) => ({
        categoryId: r.categoryId, weight: r.weight, priority: r.priority,
      })),
    },
    currentQuestionSet: questionSet,
  };
}

// ---------- プレビュー ----------
function renderPreview(set, warnings) {
  const panel = $('preview-panel');
  panel.classList.remove('hidden');
  const qs = (set && set.questions) || [];
  $('preview-meta').textContent =
    `生成設問数: ${qs.length} 問 ／ バージョン: ${set?.version || '(新規)'}`;

  const wrap = $('preview-questions');
  wrap.innerHTML = '';
  qs.forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'preview-q';
    const choices = (q.choices || []).map((c, ci) => {
      const correct = (q.answer || []).includes(ci);
      return `<li class="${correct ? 'correct' : ''}">${escapeHtml(c)}${correct ? ' ✓' : ''}</li>`;
    }).join('');
    div.innerHTML = `
      <div class="pq-head">Q${String(i + 1).padStart(2, '0')} ・ ${escapeHtml(q.category || '')} ・ ${escapeHtml(q.type || 'single')}</div>
      <div class="pq-text">${escapeHtml(q.question || '')}</div>
      <ol>${choices}</ol>
      <div class="pq-exp">${escapeHtml(q.explanation || '')}</div>`;
    wrap.appendChild(div);
  });
  panel.scrollIntoView({ behavior: 'smooth' });
}

function onAdopt() {
  if (!draftSet) return;
  // 採用時にメタ情報を付与
  const out = {
    ...draftSet,
    locked: true,
    updatedAt: new Date().toISOString().slice(0, 10),
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'current-question-set.json');
  showToast('JSONをダウンロードしました。GitHubへコミットしてください。');
}

function onDiscard() {
  draftSet = null;
  $('preview-panel').classList.add('hidden');
  $('preview-questions').innerHTML = '';
  showToast('生成案を破棄しました。');
}

// ---------- ユーティリティ ----------
function setAlert(id, type, html) {
  const el = $(id);
  el.innerHTML = `<div class="alert alert-${type}">${html}</div>`;
}
function clearAlert(id) { $(id).innerHTML = ''; }

let toastTimer = null;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
