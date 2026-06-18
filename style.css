// =========================================================
// api/github-save.js
// 設問セットを GitHub リポジトリに直接保存・取得・一覧・切替する。
// トークンは環境変数から読み、ブラウザには一切出さない（安全）。
//
// 必要な環境変数:
//   GITHUB_TOKEN   … Fine-grained PAT（Contents: Read and write）
//   GITHUB_OWNER   … リポジトリ所有者（例: yourname）
//   GITHUB_REPO    … リポジトリ名（例: ai-literacy-test）
//   GITHUB_BRANCH  … 対象ブランチ（省略時 main）
//
// アクション（POST body の action）:
//   'list'        … public/data/sets/ のセット一覧 + アクティブ設定を返す
//   'save'        … セットを sets/<id>.json に保存（無ければ作成、あれば更新）
//   'activate'    … active-set.json を書き換え、current-question-set.json も更新
//   'save_current'… current-question-set.json を直接保存（単一セット運用の互換）
// =========================================================
import { applyCors, handlePreflight, readJsonBody, verifyAdminToken } from './_lib.js';

const API = 'https://api.github.com';

function ghConfig() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  return { token, owner, repo, branch, ok: !!(token && owner && repo) };
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

// Base64（UTF-8対応）
function toBase64(str) {
  return Buffer.from(str, 'utf-8').toString('base64');
}
function fromBase64(b64) {
  return Buffer.from(b64, 'base64').toString('utf-8');
}

// 単一ファイルの取得（sha も返す。無ければ null）
async function getFile(cfg, path) {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${cfg.branch}`;
  const res = await fetch(url, { headers: ghHeaders(cfg.token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getFile ${path}: HTTP ${res.status}`);
  const data = await res.json();
  return { sha: data.sha, content: fromBase64(data.content || ''), raw: data };
}

// ファイルの作成/更新（sha があれば更新）
async function putFile(cfg, path, contentStr, message, sha) {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
  const body = {
    message: message || `Update ${path}`,
    content: toBase64(contentStr),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: 'PUT', headers: ghHeaders(cfg.token), body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GitHub putFile ${path}: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

// ディレクトリ一覧（中のファイル名配列）
async function listDir(cfg, dirPath) {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${dirPath}?ref=${cfg.branch}`;
  const res = await fetch(url, { headers: ghHeaders(cfg.token) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub listDir ${dirPath}: HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data.filter((x) => x.type === 'file') : [];
}

const SETS_DIR = 'public/data/sets';
const ACTIVE_PATH = 'public/data/active-set.json';
const CURRENT_PATH = 'public/data/current-question-set.json';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(res, req);
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'POSTのみ対応' });
  }

  let body;
  try { body = await readJsonBody(req); } catch { return res.status(400).json({ ok: false, message: 'BAD_JSON' }); }
  if (!verifyAdminToken(body && body.adminToken)) {
    return res.status(401).json({ ok: false, message: '管理者トークンが無効です。' });
  }

  const cfg = ghConfig();
  if (!cfg.ok) {
    return res.status(503).json({
      ok: false, code: 'GITHUB_NOT_CONFIGURED',
      message: 'GitHub連携が未設定です。Vercelに GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO を設定してください。',
    });
  }

  const action = body.action;
  try {
    if (action === 'list') {
      const files = await listDir(cfg, SETS_DIR);
      const sets = [];
      for (const f of files) {
        if (!f.name.endsWith('.json')) continue;
        // 各セットのメタだけ読む（軽量化のため必要最小限）
        try {
          const file = await getFile(cfg, `${SETS_DIR}/${f.name}`);
          const json = JSON.parse(file.content);
          sets.push({
            id: f.name.replace(/\.json$/, ''),
            fileName: f.name,
            questionSetId: json.questionSetId || f.name,
            version: json.version || '',
            questionCount: (json.settings && json.settings.questionCount) || 0,
            poolSize: Array.isArray(json.questions) ? json.questions.length : 0,
            updatedAt: json.updatedAt || '',
          });
        } catch { /* 壊れたファイルはスキップ */ }
      }
      // アクティブ設定
      let active = null;
      const af = await getFile(cfg, ACTIVE_PATH);
      if (af) { try { active = JSON.parse(af.content).activeSetId || null; } catch { /* noop */ } }
      return res.status(200).json({ ok: true, sets, activeSetId: active });
    }

    if (action === 'get') {
      const setId = sanitizeId(body.setId);
      if (!setId) return res.status(400).json({ ok: false, message: 'setId が不正です。' });
      const file = await getFile(cfg, `${SETS_DIR}/${setId}.json`);
      if (!file) return res.status(404).json({ ok: false, message: `セット ${setId} が見つかりません。` });
      let questionSet = null;
      try { questionSet = JSON.parse(file.content); }
      catch { return res.status(500).json({ ok: false, message: 'セットのJSONが壊れています。' }); }
      return res.status(200).json({ ok: true, setId, questionSet });
    }

    if (action === 'save') {
      const setId = sanitizeId(body.setId);
      if (!setId) return res.status(400).json({ ok: false, message: 'setId が不正です。' });
      if (!body.questionSet) return res.status(400).json({ ok: false, message: 'questionSet がありません。' });
      const path = `${SETS_DIR}/${setId}.json`;
      const existing = await getFile(cfg, path);
      const contentStr = JSON.stringify(body.questionSet, null, 2);
      await putFile(cfg, path, contentStr, `Save question set: ${setId}`, existing && existing.sha);
      return res.status(200).json({ ok: true, setId, created: !existing });
    }

    if (action === 'activate') {
      const setId = sanitizeId(body.setId);
      if (!setId) return res.status(400).json({ ok: false, message: 'setId が不正です。' });
      const setPath = `${SETS_DIR}/${setId}.json`;
      const setFile = await getFile(cfg, setPath);
      if (!setFile) return res.status(404).json({ ok: false, message: `セット ${setId} が見つかりません。` });

      // active-set.json を更新
      const activeExisting = await getFile(cfg, ACTIVE_PATH);
      const activeStr = JSON.stringify({ activeSetId: setId, updatedAt: new Date().toISOString() }, null, 2);
      await putFile(cfg, ACTIVE_PATH, activeStr, `Activate set: ${setId}`, activeExisting && activeExisting.sha);

      // current-question-set.json も同じ内容に更新（受験画面が読むファイル）
      const curExisting = await getFile(cfg, CURRENT_PATH);
      await putFile(cfg, CURRENT_PATH, setFile.content, `Apply active set: ${setId}`, curExisting && curExisting.sha);

      // 切り替えたセットの内容も返す（管理画面の表示更新用）
      let questionSet = null;
      try { questionSet = JSON.parse(setFile.content); } catch { /* noop */ }
      return res.status(200).json({ ok: true, activeSetId: setId, questionSet });
    }

    if (action === 'save_current') {
      if (!body.questionSet) return res.status(400).json({ ok: false, message: 'questionSet がありません。' });
      const existing = await getFile(cfg, CURRENT_PATH);
      const contentStr = JSON.stringify(body.questionSet, null, 2);
      await putFile(cfg, CURRENT_PATH, contentStr, 'Update current question set', existing && existing.sha);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, message: `未知のaction: ${action}` });
  } catch (err) {
    console.error('github-save error:', err && err.message);
    return res.status(502).json({ ok: false, code: 'GITHUB_ERROR', message: String(err && err.message || err).slice(0, 300) });
  }
}

// ファイル名に使える安全なIDへ
function sanitizeId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // 英数・ハイフン・アンダースコアのみ許可
  const clean = s.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return clean.slice(0, 64);
}
