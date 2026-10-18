// =========================================================
// admin.js  管理者コンソール
// =========================================================
import { resolveCategoryAllocation } from './scoring.js?v=1.2.0';
import { downloadBlob } from './export.js?v=1.2.0';
import { adminLogin, generateQuestions, listModels, isApiConfigured,
  ghListSets, ghActivateSet, ghSaveCurrent, ghSetEnabled, ghDeleteSet } from './apiClient.js?v=1.2.0';
import { initPool } from './pool.js?v=1.2.0';
import { resolveBrand } from './branding.js?v=1.2.0';
import { buildDraftFromQuestions } from './question-draft.js?v=1.2.0';
import { createSetItem, addSetButton } from './set-list.js?v=1.2.0';
import { questionSetErrors } from './question-set.js?v=1.2.0';

const QUESTION_SET_URL = 'data/current-question-set.json';

let questionSet = null;
let adminToken = null;
let draftSet = null;       // 生成された設問案
let currentRevision = null;
let currentStorageId = null;
let listRevision = null;
let mutationPending = false;
let distRows = [];         // 配分行 [{categoryId,name,weight,priority}]

const $ = (id) => document.getElementById(id);

// ISO日時文字列を日本時間（JST）で読みやすく整形する。
// 例: "2026-06-11T03:00:00.000Z" → "2026/06/11 12:00 (JST)"
// 解析できない値や空はそのまま（または「—」）を返す。
function formatJst(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute} (JST)`;
}

// 日本時間の yyyyMMddHHmmss を返す（ファイル名用）
function jstStamp() {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

// 出題セットJSONのダウンロード用ファイル名（JSTタイムスタンプ付き）
function questionSetFileName() {
  return `current-question-set_${jstStamp()}.json`;
}

// ヘッダ名・タブ名を、現在の出題セットのタイトルに合わせる（未読込のときは仮の名前「検定」）
function applyAdminBrand() {
  const b = resolveBrand(questionSet);
  const el = document.getElementById('brand-name');
  if (el) el.textContent = b.title;
  document.title = `管理者モード｜${b.title}`;
}

document.addEventListener('DOMContentLoaded', async () => {
  applyAdminBrand();
  bindEvents();
  try {
    const res = await fetch(QUESTION_SET_URL, { cache: 'no-store' });
    questionSet = await res.json();
    applyAdminBrand();
  } catch (e) {
    console.error(e);
  }
});

function bindEvents() {
  $('btn-login').addEventListener('click', onLogin);
  $('admin-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') onLogin(); });
  $('btn-logout-header').addEventListener('click', onLogout);
  $('btn-recalc').addEventListener('click', recalcDistribution);
  $('btn-save-settings').addEventListener('click', onSaveSettings);
  $('btn-refresh-sets').addEventListener('click', () => {
    if (confirm('一覧と現在の設定を再読み込みします。AI生成タブの未保存の設定は破棄されます。よろしいですか？')) loadSetsList(true);
  });
  $('btn-reset-dist').addEventListener('click', () => { buildDistRowsFromSet(); renderDistTable(); recalcDistribution(); });
  $('set-count').addEventListener('input', () => { checkQuestionCount(); recalcDistribution(); });
  $('btn-generate').addEventListener('click', onGenerate);
  $('btn-diagnose').addEventListener('click', onDiagnose);
  $('btn-adopt').addEventListener('click', onAdopt);
  $('btn-discard').addEventListener('click', onDiscard);
  $('instruction').addEventListener('input', (e) => {
    $('instr-count').textContent = e.target.value.length;
  });

  // タブ切替
  $('tab-btn-generate').addEventListener('click', () => switchTab('generate'));
  $('tab-btn-pool').addEventListener('click', () => switchTab('pool'));

  // 設問プール初期化
  initPool(() => adminToken);
}

function switchTab(which) {
  const isGen = which === 'generate';
  $('tab-generate').classList.toggle('hidden', !isGen);
  $('tab-pool').classList.toggle('hidden', isGen);
  $('tab-btn-generate').classList.toggle('active', isGen);
  $('tab-btn-pool').classList.toggle('active', !isGen);
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
  currentRevision = null; currentStorageId = null; listRevision = null;
  $('admin-pass').value = '';
  $('admin-dash').classList.add('hidden');
  $('admin-login').classList.remove('hidden');
  $('btn-logout-header').classList.add('hidden');
  window.scrollTo({ top: 0 });
}

function enterDashboard() {
  $('admin-login').classList.add('hidden');
  $('admin-dash').classList.remove('hidden');
  $('btn-logout-header').classList.remove('hidden');
  fillCurrentSet();
  buildDistRowsFromSet();
  renderDistTable();
  recalcDistribution();
  checkQuestionCount();
  window.scrollTo({ top: 0 });

  // プール組み立てタブが配分設定を引き継げるよう、現在の設定を公開する
  window.getAdminSettings = () => ({
    questionSetId: questionSet?.questionSetId,
    categories: questionSet?.categories || [],
    questionCount: parseInt($('set-count').value, 10) || 20,
    passingScore: numberInput('set-pass', 70),
    difficulty: $('set-difficulty').value,
    categoryDistribution: distRows.map((r) => ({
      categoryId: r.categoryId, weight: r.weight, priority: r.priority,
    })),
  });

  // 複数セット一覧を読み込む（GitHub連携が設定されていれば）
  loadSetsList(true);
  window.onPoolSaved = async result => {
    if (result.activeSetId === result.setId && result.questionSet) {
      questionSet = result.questionSet; currentRevision = result.revision; currentStorageId = result.activeSetId;
      fillCurrentSet(); buildDistRowsFromSet(); renderDistTable(); recalcDistribution(); checkQuestionCount();
    }
    await loadSetsList();
  };

  // プール組み立てタブからもGitHub保存を使えるよう公開
  window.saveQuestionSetFromPool = (out, alertId, prefixMsg) => saveQuestionSet(out, alertId, prefixMsg);
}

// ===== 複数セット管理 =====
async function loadSetsList(syncCurrent = false) {
  if (!isApiConfigured()) {
    setAlert('github-status', 'info',
      'GitHub連携を使うには、本番（Vercel接続）環境で操作してください。ローカル確認モードでは利用できません。');
    return;
  }
  setAlert('sets-alert', 'info', '<span class="spin"></span> 出題セット一覧を読み込み中…');
  try {
    const data = await ghListSets(adminToken);
    clearAlert('github-status');
    const sets = data.sets || [];
    listRevision = data.revision;
    if (syncCurrent === true) {
      currentRevision = data.revision; currentStorageId = data.activeSetId;
      if (data.currentQuestionSet) {
        questionSet = data.currentQuestionSet;
        fillCurrentSet(); buildDistRowsFromSet(); renderDistTable(); recalcDistribution(); checkQuestionCount();
      }
    }
    window.dispatchEvent(new CustomEvent('set-list-updated', { detail: data }));
    renderSetsList(sets, data.activeSetId);
    if (sets.length === 0) {
      setAlert('sets-alert', 'info',
        'GitHub連携は成功しています。保存済みの出題セットは0件です。'
        + 'AI生成またはプール組み立てでセットを作成し、保存するとここに表示されます。');
    } else {
      setAlert('sets-alert', 'info',
        `${sets.length} 件の出題セットを読み込みました`
        + (data.activeSetId ? `（使用中の保存先: ${escapeHtml(data.activeSetId)}）` : '（使用中の指定なし）') + '。' + (data.warnings || []).map(escapeHtml).join('<br>'));
    }
  } catch (err) {
    const msg = String(err.message || '');
    if (msg.includes('GITHUB_NOT_CONFIGURED') || msg.includes('503')) {
      setAlert('github-status', 'warn',
        'GitHub連携が未設定です。Vercelに <code>GITHUB_TOKEN</code> / <code>GITHUB_OWNER</code> / <code>GITHUB_REPO</code> を設定すると、'
        + 'このセクションから複数セットの保存・切替ができます。');
      $('sets-list').innerHTML = '';
    } else {
      setAlert('sets-alert', 'error', 'セット一覧の取得に失敗しました：' + escapeHtml(msg));
    }
  }
}

function renderSetsList(sets, activeSetId) {
  const container = $('sets-list'); container.innerHTML = '';
  if (!sets.length) { container.textContent = '保存済みのセットはありません。'; return; }
  sets.forEach(set => {
    const { item, actions } = createSetItem(set, activeSetId);
    const active = set.id === activeSetId;
    if (!active && set.enabled !== false) addSetButton(actions, 'このセットを使う', () => onActivateSet(set.id));
    addSetButton(actions, set.enabled === false ? '再有効化' : '無効にする',
      () => changeSet(set, 'enabled'), active);
    addSetButton(actions, '削除', () => changeSet(set, 'delete'), active);
    if (active) {
      const note = document.createElement('small'); note.textContent = '削除・無効化は別セットへ切り替えてから操作できます。'; actions.appendChild(note);
    }
    container.appendChild(item);
  });
}

async function changeSet(set, action) {
  if (mutationPending) return;
  const deleting = action === 'delete';
  const text = deleting
    ? '保存先「' + set.id + '」（Set ID: ' + (set.questionSetId || '未設定') + '）を削除しますか？\nアプリ内のごみ箱はありません。復元はGitHubの履歴から行います。編集中のプールは残ります。'
    : '「' + set.id + '」を' + (set.enabled === false ? '再有効化' : '無効化') + 'しますか？設問データは残ります。';
  if (!confirm(text)) return;
  await mutateSet(async () => {
    if (deleting) return ghDeleteSet(adminToken, set.id, listRevision);
    return ghSetEnabled(adminToken, set.id, set.enabled === false, listRevision);
  }, deleting ? 'セットを削除しました。' : '有効・無効の状態を更新しました。');
}

async function mutateSet(operation, message) {
  if (mutationPending) return;
  mutationPending = true;
  $('sets-list').querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    const previous = listRevision;
    const result = await operation();
    if (currentRevision === previous) currentRevision = result?.revision || currentRevision;
    await loadSetsList();
    setAlert('sets-alert', 'info', message);
  } catch (err) {
    await loadSetsList();
    setAlert('sets-alert', 'error', escapeHtml(err.message || '操作に失敗しました。') + '<br>状態を確認してから再操作してください。');
  } finally { mutationPending = false; }
}

async function onActivateSet(setId) {
  if (mutationPending || !confirm('出題セット「' + setId + '」に切り替えますか？AI生成タブの未保存の設定は破棄されます。')) return;
  await mutateSet(async () => {
    const result = await ghActivateSet(adminToken, setId, listRevision);
    questionSet = result.questionSet;
    currentRevision = result.revision; currentStorageId = result.activeSetId;
    fillCurrentSet(); buildDistRowsFromSet(); renderDistTable(); recalcDistribution(); checkQuestionCount();
    return result;
  }, '切り替えました。GitHubからの自動デプロイ完了後、受験ページを再読み込みしてください。');
}

// ---------- 現在の設問セット表示 ----------
function fillCurrentSet() {
  if (!questionSet) return;
  applyAdminBrand();   // セット切替・保存のたびにヘッダ名も更新
  const s = questionSet.settings || {};
  $('d-setid').textContent = questionSet.questionSetId || '—';
  $('d-version').textContent = questionSet.version || '—';
  $('d-updated').textContent = formatJst(questionSet.updatedAt);
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

// 出題数が在庫（設問プールの数）を超えていないかチェックし、アラートを表示する。
// 超過時は true を返す。
function checkQuestionCount() {
  const input = $('set-count');
  const alertEl = $('set-count-alert');
  const count = parseInt(input.value, 10) || 0;
  const available = (questionSet && questionSet.questions && questionSet.questions.length) || 0;

  if (count < 1) {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-warn">出題数は1以上にしてください。</div>';
    return true;
  }
  if (available > 0 && count > available) {
    if (alertEl) {
      alertEl.innerHTML =
        `<div class="alert alert-error">`
        + `出題数 <b>${count}</b> 問が、現在の設問数（在庫 <b>${available}</b> 問）を超えています。`
        + `出題数を ${available} 以下にするか、設問を追加してください。`
        + `</div>`;
    }
    return true;
  }
  if (alertEl) alertEl.innerHTML = '';
  return false;
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
    const data = await listModels(adminToken, 'all', true);
    const results = data.results || data;  // 後方互換
    const config = data.config;
    const probes = data.probes;
    const blocks = [];

    // 現在の設定（環境変数が効いているかの確認）
    if (config) {
      const cfgHtml = '<b>現在の設定（Vercel環境変数）</b><br><small>'
        + 'フォールバック順: <code>' + escapeHtml(config.providerOrder) + '</code><br>'
        + 'Geminiモデル: <code>' + escapeHtml(config.geminiModel) + '</code><br>'
        + 'OpenRouterモデル: <code>' + escapeHtml(config.openrouterModel) + '</code><br>'
        + 'Ollamaモデル: <code>' + escapeHtml(config.ollamaModel) + '</code></small>';
      blocks.push(cfgHtml);
    }

    // Gemini
    if (results.gemini) {
      const g = results.gemini;
      if (!g.configured) blocks.push('<b>Gemini</b>: 未設定');
      else if (g.note) blocks.push('<b>Gemini</b>: エラー（' + escapeHtml(g.note) + '）');
      else blocks.push('<b>Gemini</b>: ' + g.count + ' モデル利用可<br><small>' + (g.models || []).slice(0, 30).map(escapeHtml).join(', ') + '</small>');
    }
    // OpenRouter
    if (results.openrouter) {
      const o = results.openrouter;
      if (!o.configured) blocks.push('<b>OpenRouter</b>: 未設定');
      else if (o.note) blocks.push('<b>OpenRouter</b>: エラー（' + escapeHtml(o.note) + '）');
      else blocks.push('<b>OpenRouter</b>: 無料モデル ' + o.freeCount + ' 件<br><small>' + (o.freeModels || []).slice(0, 30).map(escapeHtml).join(', ') + '</small>');
    }
    // Ollama
    if (results.ollama) {
      const ol = results.ollama;
      if (ol.note) blocks.push('<b>Ollama</b>: ' + escapeHtml(ol.note));
      else blocks.push('<b>Ollama</b>: ' + ol.count + ' モデル<br><small>' + (ol.models || []).map(escapeHtml).join(', ') + '</small>');
    }

    // OpenRouter 実テスト（probe）結果
    if (probes && Array.isArray(probes.openrouter)) {
      const lines = probes.openrouter.map((p) => {
        const tag = p.ok ? 'OK' : 'NG';
        const st = p.status != null ? ('HTTP ' + p.status) : 'エラー';
        return '・<code>' + escapeHtml(p.model) + '</code> → ' + tag + '（' + st + '）'
          + (p.detail ? '<br>&nbsp;&nbsp;<small>' + escapeHtml(p.detail) + '</small>' : '');
      });
      blocks.push('<b>OpenRouter 実テスト（実際に1回送信）</b><br><small>' + lines.join('<br>') + '</small>');
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
  const batchSize = Math.max(1, Math.min(10, parseInt($('set-batch').value, 10) || 5));
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
function buildGeneratePayload(instruction) {
  const count = parseInt($('set-count').value, 10) || 20;
  return {
    adminToken,
    instruction,
    settings: {
      questionCount: count,
      passingScore: numberInput('set-pass', 70),
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
  const out = {
    ...draftSet,
    updatedAt: new Date().toISOString(),
  };
  saveQuestionSet(out, 'adopt-alert', '生成した設問セットを採用しました。');
}

function onDiscard() {
  draftSet = null;
  $('preview-panel').classList.add('hidden');
  $('preview-questions').innerHTML = '';
  showToast('生成案を破棄しました。');
}

// 現在の設問セットに、編集した出題数・合格ライン・カテゴリ配分を適用して書き出す。
// AI生成をせずに「配分や出題数だけ変更」したいときに使う。
function onSaveSettings() {
  if (!questionSet || !questionSet.questions || !questionSet.questions.length) {
    setAlert('save-alert', 'error', '現在の設問セットが読み込まれていません。');
    return;
  }

  const count = parseInt($('set-count').value, 10) || 20;
  const pass = numberInput('set-pass', 70);
  const difficulty = $('set-difficulty').value;
  const distribution = distRows.map((r) => ({
    categoryId: r.categoryId, weight: r.weight, priority: r.priority,
  }));

  const available = questionSet.questions.length;
  // 出題数が在庫を超えていないかチェック
  if (count > available) {
    setAlert('save-alert', 'error',
      `出題数 ${count} 問に対し、現在の設問は ${available} 問しかありません。`
      + `出題数を ${available} 以下にするか、設問を追加してください。`);
    return;
  }

  // 在庫が出題数より多ければランダム出題が自然なのでON（既存値は尊重しつつ）
  const moreThanNeeded = available > count;
  const prevRandomQ = questionSet.settings && questionSet.settings.randomizeQuestions;
  const randomizeQuestions = moreThanNeeded ? true : (prevRandomQ ?? false);

  const out = {
    ...questionSet,
    updatedAt: new Date().toISOString(),
    settings: {
      ...(questionSet.settings || {}),
      questionCount: count,
      passingScore: pass,
      difficulty,
      randomizeQuestions,
      randomizeChoices: (questionSet.settings && questionSet.settings.randomizeChoices) ?? true,
      categoryDistributionMode: 'weighted',
      categoryDistribution: distribution,
    },
  };
  saveQuestionSet(out, 'save-alert',
    `設定（出題数 ${count}、配分${moreThanNeeded ? '・ランダム出題' : ''}）を反映しました。`);
}

// 設問セットを保存する共通処理。
// GitHub連携が有効なら「選択中の出題セット(current)」に直接保存（コミット）。
// 未設定ならJSONダウンロードにフォールバックする。
async function saveQuestionSet(out, alertId, prefixMsg) {
  const errors = questionSetErrors(out);
  if (errors.length) { setAlert(alertId, 'error', errors.map(escapeHtml).join('<br>')); return; }
  if (mutationPending) { setAlert(alertId, 'warn', '他の保存処理が終わるまでお待ちください。'); return; }
  if (isApiConfigured()) {
    mutationPending = true;
    $('btn-save-settings').disabled = true; $('btn-adopt').disabled = true;
    try {
      setAlert(alertId, 'info', '<span class="spin"></span> GitHubに保存中…');
      const result = await ghSaveCurrent(adminToken, out, currentRevision, currentStorageId);
      currentRevision = result.revision; questionSet = out; fillCurrentSet();
      setAlert(alertId, 'info', escapeHtml(prefixMsg) + '公開用と保管用の両方へ保存しました。自動デプロイ完了後に受験ページを再読み込みしてください。');
      await loadSetsList(); return;
    } catch (err) {
      setAlert(alertId, 'error', escapeHtml(err.message || '保存に失敗しました。') + '<br>編集内容は画面に残しています。自動でダウンロードや再保存は行いません。');
      return;
    } finally {
      mutationPending = false; $('btn-save-settings').disabled = false; $('btn-adopt').disabled = false;
    }
  }
  questionSet = out; fillCurrentSet();
  downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), questionSetFileName());
  setAlert(alertId, 'info', escapeHtml(prefixMsg) + 'ローカル確認モードのためJSONをダウンロードしました。');
}

function numberInput(id, fallback) {
  const value = Number.parseInt($(id).value, 10);
  return Number.isFinite(value) ? value : fallback;
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
