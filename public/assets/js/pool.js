// =========================================================
// pool.js  設問プール／組み立てモード
// ---------------------------------------------------------
// 複数の設問セットJSONをブラウザ内で統合し、カテゴリ別に分類。
// 管理者がチェックで採用を選び、各項目を手入力編集して、
// 1つの current-question-set.json として書き出す。
//
// すべてブラウザ内で完結（サーバー送信なし）。
// =========================================================
import { downloadBlob } from './export.js';
import { CATEGORY_DEFS } from './categories.js';

// プール状態
let pool = [];          // { uid, question, choices[], answer[], type, category, difficulty, explanation, tags[], selected, dupOf }
let meta = {
  questionSetId: '',
  version: '1.0.0',
  questionCount: 20,
  passingScore: 70,
  randomizeQuestions: false,
  randomizeChoices: true,
};
let uidSeq = 1;

const $ = (id) => document.getElementById(id);

// ---- 初期化（admin.js から呼ぶ） ----
export function initPool() {
  $('pool-file').addEventListener('change', onFilesSelected);
  $('btn-pool-clear').addEventListener('click', clearPool);
  $('btn-pool-all').addEventListener('click', () => setAllSelected(true));
  $('btn-pool-none').addEventListener('click', () => setAllSelected(false));
  $('btn-pool-dedup').addEventListener('click', deselectDuplicates);
  $('btn-pool-export').addEventListener('click', exportSet);

  // メタ入力の変更を反映
  ['pool-setid', 'pool-version', 'pool-count', 'pool-pass', 'pool-randomize-q', 'pool-randomize-c']
    .forEach((id) => $(id).addEventListener('input', onMetaChanged));

  // ドラッグ＆ドロップ
  const dz = $('pool-dropzone');
  if (dz) {
    // ゾーンクリック／ブラウズボタンでファイル選択を開く
    dz.addEventListener('click', (e) => {
      if (e.target.id === 'pool-browse' || e.target === dz || e.target.closest('.dropzone-inner')) {
        if (e.target.tagName !== 'INPUT') $('pool-file').click();
      }
    });
    ['dragenter', 'dragover'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add('dragover'); }));
    ['dragleave', 'dragend'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation();
      dz.classList.remove('dragover');
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || [])
        .filter((f) => /\.json$/i.test(f.name) || f.type === 'application/json');
      if (!files.length) {
        setAlert('pool-upload-alert', 'warn', 'JSONファイルをドロップしてください。');
        return;
      }
      await processFiles(files);
    });
  }
}

// ---- ファイル読み込み ----
async function onFilesSelected(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = ''; // 同じファイルを再選択できるようリセット
  if (!files.length) return;
  await processFiles(files);
}

// ファイル配列を処理してプールへ追加（選択・ドロップ共通）
async function processFiles(files) {
  let added = 0;
  let errors = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const questions = extractQuestions(data);
      if (!questions.length) { errors.push(`${file.name}: 設問が見つかりません`); continue; }
      absorbMeta(data);
      for (const q of questions) {
        const norm = normalizeQuestion(q);
        if (norm) { pool.push(norm); added++; }
      }
    } catch (err) {
      errors.push(`${file.name}: 読み込み失敗（${err.message}）`);
    }
  }

  markDuplicates();

  const msg = `${added} 問を追加しました（プール合計 ${pool.length} 問）。`
    + (errors.length ? `<br><small>${errors.map(esc).join('<br>')}</small>` : '');
  setAlert('pool-upload-alert', errors.length ? 'warn' : 'info', msg);

  render();
}

// 様々な形（{questions:[]} / 配列 / {questionSetDraft:{questions}}）から設問配列を取り出す
function extractQuestions(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.questions)) return data.questions;
  if (data && data.questionSetDraft && Array.isArray(data.questionSetDraft.questions)) return data.questionSetDraft.questions;
  return [];
}

// メタ情報を吸収（既に手入力済みなら上書きしない）
function absorbMeta(data) {
  const src = data && data.questionSetDraft ? data.questionSetDraft : data;
  if (!src || typeof src !== 'object') return;
  if (!meta.questionSetId && src.questionSetId) meta.questionSetId = String(src.questionSetId);
  if (src.version && meta.version === '1.0.0') meta.version = String(src.version);
  const s = src.settings || {};
  if (s.passingScore != null && meta.passingScore === 70) meta.passingScore = Number(s.passingScore);
  syncMetaInputs();
}

// カテゴリ名を定義済みラベルに正規化する。
// 受け付ける表記の例:
//   "基本理解" / "C-001" / "C-001 基本理解" / "C-001:基本理解" /
//   "C-001　基本理解"（全角空白）/ "[C-001] 基本理解" / "c001 基本理解"
function normalizeCategory(raw) {
  let s = String(raw || '').trim();
  if (!s) return '未分類';

  // 1) 完全一致（ラベル or ID）
  const exactId = CATEGORY_DEFS.find((c) => c.id === s);
  if (exactId) return exactId.label;
  const exactLabel = CATEGORY_DEFS.find((c) => c.label === s);
  if (exactLabel) return exactLabel.label;

  // 2) 文字列中に ID コード（C-001 / C001 / [C-001] 等）が含まれるか
  const idMatch = s.match(/c[-_\s]?0*(\d{1,3})/i);
  if (idMatch) {
    const num = String(parseInt(idMatch[1], 10)).padStart(3, '0');
    const byId = CATEGORY_DEFS.find((c) => c.id === `C-${num}`);
    if (byId) return byId.label;
  }

  // 3) 文字列中に定義済みラベルが含まれるか（「C-001 基本理解」→「基本理解」）
  const byContainsLabel = CATEGORY_DEFS.find((c) => s.includes(c.label));
  if (byContainsLabel) return byContainsLabel.label;

  // 4) コード部分を除去して残りをトリム（未知ラベルでも見やすく）
  const stripped = s
    .replace(/^[\[\(]?\s*c[-_\s]?\d{1,3}\s*[\]\):：.\-]?\s*/i, '')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
  return stripped || '未分類';
}

// 設問を内部形式へ正規化
function normalizeQuestion(q) {
  if (!q || typeof q !== 'object') return null;
  const question = String(q.question || '').trim();
  const choices = Array.isArray(q.choices) ? q.choices.map((c) => String(c)) : [];
  if (!question || choices.length < 2) return null;

  let answer = q.answer;
  if (typeof answer === 'number') answer = [answer];
  if (!Array.isArray(answer)) answer = [];
  answer = answer.filter((a) => Number.isInteger(a) && a >= 0 && a < choices.length);
  if (!answer.length) answer = [0];

  let type = q.type === 'multiple' ? 'multiple' : 'single';
  if (type === 'single' && answer.length > 1) answer = [answer[0]];

  // カテゴリはラベルに正規化（「C-001 基本理解」等のコード付きも吸収）
  const category = normalizeCategory(q.category);

  return {
    uid: uidSeq++,
    question,
    choices,
    answer,
    type,
    category,
    difficulty: ['basic', 'standard', 'advanced'].includes(q.difficulty) ? q.difficulty : 'standard',
    explanation: String(q.explanation || ''),
    tags: Array.isArray(q.tags) ? q.tags.map(String) : [],
    selected: true,
    dupOf: null,
  };
}

// ---- 重複検出（bi-gram Jaccard）----
function markDuplicates() {
  for (let i = 0; i < pool.length; i++) {
    pool[i].dupOf = null;
    for (let j = 0; j < i; j++) {
      if (similarity(pool[i].question, pool[j].question) >= 0.40) {
        pool[i].dupOf = pool[j].uid;
        break;
      }
    }
  }
}

function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na), gb = bigrams(nb);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}
function norm(s) { return String(s || '').toLowerCase().replace(/[\s　、。，．・「」『』（）()【】\[\]！？!?]/g, ''); }
function bigrams(s) { const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; }

// ---- 操作 ----
function clearPool() {
  if (pool.length && !confirm('プールを空にしますか？')) return;
  pool = [];
  render();
  setAlert('pool-upload-alert', 'info', 'プールを空にしました。');
}
function setAllSelected(v) { pool.forEach((q) => { q.selected = v; }); render(); }
function deselectDuplicates() {
  let n = 0;
  pool.forEach((q) => { if (q.dupOf) { q.selected = false; n++; } });
  render();
  setAlert('pool-upload-alert', 'info', `重複候補 ${n} 問の選択を解除しました。`);
}

function onMetaChanged() {
  meta.questionSetId = $('pool-setid').value.trim();
  meta.version = $('pool-version').value.trim() || '1.0.0';
  meta.questionCount = Math.max(1, Math.min(100, parseInt($('pool-count').value, 10) || 20));
  meta.passingScore = Math.max(0, Math.min(100, parseInt($('pool-pass').value, 10) || 70));
  meta.randomizeQuestions = $('pool-randomize-q').checked;
  meta.randomizeChoices = $('pool-randomize-c').checked;
  updateCountNote();
}
function syncMetaInputs() {
  $('pool-setid').value = meta.questionSetId;
  $('pool-version').value = meta.version;
  $('pool-count').value = meta.questionCount;
  $('pool-pass').value = meta.passingScore;
  $('pool-randomize-q').checked = meta.randomizeQuestions;
  $('pool-randomize-c').checked = meta.randomizeChoices;
}

// 出題数 vs 採用数の関係を案内
function updateCountNote() {
  const sel = pool.filter((q) => q.selected).length;
  const note = $('pool-count-note');
  if (sel === 0) { note.textContent = 'まだ設問が選択されていません。'; return; }
  if (sel > meta.questionCount) {
    note.innerHTML = `採用 ${sel} 問 ＞ 出題数 ${meta.questionCount} 問。`
      + `<b>ランダム出題モード</b>になり、検定では毎回 ${meta.questionCount} 問がランダムに出題されます。`;
    // 多い場合はランダム出題を自動でオンにする（ユーザーは変更可）
    if (!meta.randomizeQuestions) { meta.randomizeQuestions = true; $('pool-randomize-q').checked = true; }
  } else if (sel < meta.questionCount) {
    note.innerHTML = `採用 ${sel} 問 ＜ 出題数 ${meta.questionCount} 問。`
      + `このままだと出題数が採用数までになります。出題数を ${sel} 以下にするか、設問を追加してください。`;
  } else {
    note.textContent = `採用 ${sel} 問 ＝ 出題数 ${meta.questionCount} 問。全問が出題されます。`;
  }
}

// ---- 出力 ----
function exportSet() {
  const selected = pool.filter((q) => q.selected);
  if (!selected.length) { setAlert('pool-output-alert', 'error', '設問が1問も選択されていません。'); return; }
  if (selected.length < meta.questionCount) {
    setAlert('pool-output-alert', 'error',
      `採用 ${selected.length} 問が出題数 ${meta.questionCount} 問より少ないです。出題数を減らすか設問を追加してください。`);
    return;
  }

  // カテゴリ配分を採用設問から自動算出（未分類・独自カテゴリも漏らさず含める）
  const catCount = {};
  const catOrder = [];
  selected.forEach((q) => {
    if (!(q.category in catCount)) { catCount[q.category] = 0; catOrder.push(q.category); }
    catCount[q.category]++;
  });
  // 既知ラベルは定義の id、未知は連番 id を振る
  const knownByLabel = new Map(CATEGORY_DEFS.map((c) => [c.label, c]));
  let extra = 0;
  const categories = catOrder.map((label) => {
    const def = knownByLabel.get(label);
    if (def) return { id: def.id, name: def.label };
    extra += 1;
    return { id: `X-${String(extra).padStart(3, '0')}`, name: label };
  });

  // 配分(weight/priority)は、管理画面（AI生成タブ）で設定されている値を引き継ぐ。
  // 該当カテゴリの設定があればそれを使い、無ければ採用実数をweightにする。
  const adminSettings = (typeof window.getAdminSettings === 'function') ? window.getAdminSettings() : null;
  const adminDist = new Map(
    (adminSettings && adminSettings.categoryDistribution || []).map((d) => [d.categoryId, d]));
  const categoryDistribution = categories.map((c, idx) => {
    const d = adminDist.get(c.id);
    return {
      categoryId: c.id,
      weight: d ? Number(d.weight) : catCount[c.name],   // 設定があれば優先、無ければ採用実数
      priority: d ? Number(d.priority) : (idx + 1),
    };
  });

  const out = {
    questionSetId: meta.questionSetId || `custom-${Date.now()}`,
    version: meta.version || '1.0.0',
    locked: false,
    updatedAt: new Date().toISOString(),
    settings: {
      questionCount: meta.questionCount,
      passingScore: meta.passingScore,
      randomizeQuestions: meta.randomizeQuestions,
      randomizeChoices: meta.randomizeChoices,
      categoryDistributionMode: 'weighted',
      categoryDistribution,
    },
    categories,
    questions: selected.map((q, i) => ({
      id: `Q${String(i + 1).padStart(3, '0')}`,
      category: q.category,
      difficulty: q.difficulty,
      type: q.type,
      question: q.question,
      choices: q.choices,
      answer: q.answer,
      explanation: q.explanation,
      tags: q.tags,
    })),
  };

  // GitHub連携が使えるなら直接保存、無ければダウンロードにフォールバック
  if (typeof window.saveQuestionSetFromPool === 'function') {
    window.saveQuestionSetFromPool(out, 'pool-output-alert',
      `${selected.length} 問の出題セット（出題数 ${meta.questionCount}）を作成しました。`);
  } else {
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    downloadBlob(blob, poolFileName());
    setAlert('pool-output-alert', 'info',
      `${selected.length} 問の出題セットを書き出しました（出題数 ${meta.questionCount}）。GitHubへコミットして反映してください。`);
  }
}

// ---- 描画 ----
function render() {
  const has = pool.length > 0;
  ['pool-meta-panel', 'pool-stats-panel', 'pool-list-panel', 'pool-output-panel']
    .forEach((id) => $(id).classList.toggle('hidden', !has));
  if (!has) return;

  syncMetaInputs();
  renderStats();
  renderList();
  updateCountNote();
  renderOutputSummary();
}

function renderStats() {
  const total = pool.length;
  const sel = pool.filter((q) => q.selected).length;
  const dup = pool.filter((q) => q.dupOf).length;
  const byCat = {};
  pool.forEach((q) => {
    if (!byCat[q.category]) byCat[q.category] = { total: 0, sel: 0 };
    byCat[q.category].total++;
    if (q.selected) byCat[q.category].sel++;
  });
  const rows = Object.entries(byCat)
    .map(([cat, v]) => `<tr><th scope="row">${esc(cat)}</th><td class="num">${v.sel} / ${v.total}</td></tr>`)
    .join('');
  $('pool-stats').innerHTML =
    `<div class="muted" style="font-size:.88rem;margin-bottom:10px">`
    + `合計 ${total} 問 ／ 採用 <b>${sel}</b> 問 ／ 重複候補 ${dup} 問</div>`
    + `<table class="cat-table"><tbody>${rows}</tbody></table>`;
}

function renderList() {
  const container = $('pool-list');
  container.innerHTML = '';

  // カテゴリ順に並べる（定義順→未分類）
  const order = CATEGORY_DEFS.map((c) => c.label).concat(['未分類']);
  const cats = [...new Set(pool.map((q) => q.category))]
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));

  for (const cat of cats) {
    const items = pool.filter((q) => q.category === cat);
    const selCount = items.filter((q) => q.selected).length;
    const group = document.createElement('div');
    group.className = 'pool-cat-group';
    group.innerHTML = `<div class="pool-cat-head"><span>${esc(cat)}</span><span class="count">採用 ${selCount} / ${items.length}</span></div>`;
    items.forEach((q) => group.appendChild(renderQuestion(q)));
    container.appendChild(group);
  }
}

function renderQuestion(q) {
  const el = document.createElement('div');
  el.className = 'pool-q' + (q.selected ? ' selected' : '');

  const choicesHtml = q.choices.map((c, ci) => {
    const inputType = q.type === 'multiple' ? 'checkbox' : 'radio';
    const checked = q.answer.includes(ci) ? 'checked' : '';
    return `<div class="pool-choice">`
      + `<input type="${inputType}" name="ans-${q.uid}" class="correct" data-ci="${ci}" ${checked} title="正解">`
      + `<input type="text" class="ch" data-ci="${ci}" value="${escAttr(c)}">`
      + `</div>`;
  }).join('');

  const dupBadge = q.dupOf ? ` <span class="dup-badge">重複の可能性</span>` : '';

  el.innerHTML = `
    <div class="pool-q-head">
      <input type="checkbox" class="sel" ${q.selected ? 'checked' : ''}>
      <div class="pool-q-body">
        <textarea class="q-text" rows="2">${esc(q.question)}</textarea>
        ${choicesHtml}
        <div class="pool-q-meta">
          <select class="type">
            <option value="single" ${q.type === 'single' ? 'selected' : ''}>単一選択</option>
            <option value="multiple" ${q.type === 'multiple' ? 'selected' : ''}>複数選択</option>
          </select>
          <select class="cat">
            ${CATEGORY_DEFS.map((c) => `<option value="${escAttr(c.label)}" ${c.label === q.category ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
            <option value="未分類" ${q.category === '未分類' ? 'selected' : ''}>未分類</option>
          </select>
          <select class="diff">
            <option value="basic" ${q.difficulty === 'basic' ? 'selected' : ''}>basic</option>
            <option value="standard" ${q.difficulty === 'standard' ? 'selected' : ''}>standard</option>
            <option value="advanced" ${q.difficulty === 'advanced' ? 'selected' : ''}>advanced</option>
          </select>
          ${dupBadge}
          <button class="btn-remove" type="button">削除</button>
        </div>
        <textarea class="expl" rows="1" placeholder="解説">${esc(q.explanation)}</textarea>
      </div>
    </div>`;

  // イベント
  el.querySelector('.sel').addEventListener('change', (e) => {
    q.selected = e.target.checked;
    el.classList.toggle('selected', q.selected);
    renderStats(); updateCountNote(); renderOutputSummary();
  });
  el.querySelector('.q-text').addEventListener('input', (e) => { q.question = e.target.value; autoGrow(e.target); });
  el.querySelector('.expl').addEventListener('input', (e) => { q.explanation = e.target.value; autoGrow(e.target); });
  el.querySelectorAll('.ch').forEach((inp) => {
    inp.addEventListener('input', (e) => { q.choices[+e.target.dataset.ci] = e.target.value; });
  });
  el.querySelectorAll('.correct').forEach((inp) => {
    inp.addEventListener('change', () => {
      const checked = [...el.querySelectorAll('.correct')].filter((x) => x.checked).map((x) => +x.dataset.ci);
      q.answer = checked.length ? checked : [0];
    });
  });
  el.querySelector('.type').addEventListener('change', (e) => {
    q.type = e.target.value;
    if (q.type === 'single' && q.answer.length > 1) q.answer = [q.answer[0]];
    renderList(); // ラジオ/チェックボックス切替のため再描画
  });
  el.querySelector('.cat').addEventListener('change', (e) => { q.category = e.target.value; render(); });
  el.querySelector('.diff').addEventListener('change', (e) => { q.difficulty = e.target.value; });
  el.querySelector('.btn-remove').addEventListener('click', () => {
    pool = pool.filter((x) => x.uid !== q.uid);
    markDuplicates();
    render();
  });

  // 初期表示時にテキストエリアの高さを内容に合わせる
  requestAnimationFrame(() => {
    el.querySelectorAll('.q-text, .expl').forEach((t) => autoGrow(t));
  });

  return el;
}

// テキストエリアの高さを内容に合わせて自動拡張する
function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight + 2) + 'px';
}

function renderOutputSummary() {
  const sel = pool.filter((q) => q.selected).length;
  $('pool-output-summary').innerHTML =
    `採用 <b>${sel}</b> 問 → 出題数 ${meta.questionCount} 問の検定セットを作成します。`
    + (sel > meta.questionCount ? `（ランダム出題モード）` : '');
}

// ---- util ----
function setAlert(id, kind, html) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'info'}">${html}</div>`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(s) { return esc(s); }

// 日本時間の yyyyMMddHHmmss 付きファイル名
function poolFileName() {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  const stamp = `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
  return `current-question-set_${stamp}.json`;
}
