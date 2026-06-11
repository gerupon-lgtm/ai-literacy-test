// =========================================================
// api/list-models.js
// 管理者向け診断: 各プロバイダで実際に利用可能なモデルを一覧する。
// これにより「モデル名が古くて404」を即座に発見できる。
//
//  POST { adminToken, provider?: 'openrouter'|'gemini'|'ollama'|'all' }
//  → { ok, results: { openrouter:[...], gemini:[...], ollama:[...] } }
// =========================================================
import { applyCors, handlePreflight, readJsonBody, verifyAdminToken } from './_lib.js';

async function listOpenRouter() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { configured: false, models: [], note: 'OPENROUTER_API_KEY 未設定' };
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return { configured: true, models: [], note: `HTTP ${res.status}` };
  const data = await res.json();
  // 無料モデル（プロンプト単価0）だけ抽出
  const free = (data.data || [])
    .filter((m) => {
      const p = m.pricing || {};
      return (parseFloat(p.prompt) === 0 && parseFloat(p.completion) === 0);
    })
    .map((m) => m.id)
    .sort();
  return { configured: true, freeModels: free, freeCount: free.length };
}

async function listGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { configured: false, models: [], note: 'GEMINI_API_KEY 未設定' };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  if (!res.ok) return { configured: true, models: [], note: `HTTP ${res.status}` };
  const data = await res.json();
  // generateContent 対応モデルだけ
  const usable = (data.models || [])
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => (m.name || '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort();
  return { configured: true, models: usable, count: usable.length };
}

async function listOllama() {
  const base = (process.env.OLLAMA_BASE_URL || 'https://ollama.gerupon.uk').replace(/\/+$/, '');
  const headers = {};
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`${base}/api/tags`, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      const hint = /<html|cloudflare|access/i.test(t) ? ' （Cloudflare認証に阻まれている可能性。Service Token要確認）' : '';
      return { configured: true, models: [], note: `HTTP ${res.status}${hint}` };
    }
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name).sort();
    return { configured: true, models, count: models.length };
  } catch (err) {
    return { configured: true, models: [], note: `接続エラー: ${String(err && err.message || err)}` };
  }
}

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

  const want = (body && body.provider) || 'all';
  const results = {};
  const tasks = [];
  if (want === 'all' || want === 'openrouter') tasks.push(listOpenRouter().then((r) => { results.openrouter = r; }));
  if (want === 'all' || want === 'gemini') tasks.push(listGemini().then((r) => { results.gemini = r; }));
  if (want === 'all' || want === 'ollama') tasks.push(listOllama().then((r) => { results.ollama = r; }));
  await Promise.all(tasks);

  return res.status(200).json({ ok: true, results });
}
