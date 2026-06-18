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

// 実際に chat/completions へ最小リクエストを送り、生の応答を返す。
// これにより 401（キー無効）/ 429（レート制限）/ 200（成功）を画面で判別できる。
async function probeOpenRouter(model) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { model, ok: false, status: null, note: 'OPENROUTER_API_KEY 未設定' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.SITE_URL || '',
        'X-Title': process.env.APP_NAME || 'AI Literacy Test',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const bodyText = await res.text().catch(() => '');
    let detail = bodyText.slice(0, 300);
    // 成功なら内容を簡潔に
    if (res.ok) {
      try {
        const j = JSON.parse(bodyText);
        const c = j?.choices?.[0]?.message?.content;
        detail = c ? `応答: ${String(c).slice(0, 40)}` : '応答あり';
      } catch { /* keep raw */ }
    }
    return { model, ok: res.ok, status: res.status, detail };
  } catch (err) {
    return { model, ok: false, status: null, detail: `接続エラー: ${String(err && err.message || err)}` };
  }
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

  // probe=true なら、設定中の OpenRouter モデルへ実テストリクエストを送る。
  // 401/429/200 を生の応答で確認できる（「リクエストが本当に通るか」の判定）。
  let probes = null;
  if (body && body.probe) {
    const orModels = (process.env.OPENROUTER_MODEL || 'openrouter/free')
      .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4);
    probes = { openrouter: [] };
    for (const m of orModels) {
      probes.openrouter.push(await probeOpenRouter(m));
    }
  }

  // 現在有効な設定を可視化（環境変数が効いているかの確認用）
  const config = {
    providerOrder: (process.env.LLM_PROVIDER_ORDER || '(未設定→既定: gemini,openrouter,ollama)'),
    geminiModel: (process.env.GEMINI_MODEL || '(未設定→既定)'),
    openrouterModel: (process.env.OPENROUTER_MODEL || '(未設定→既定)'),
    ollamaModel: (process.env.OLLAMA_MODEL || '(未設定→既定)'),
    ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || 'https://ollama.gerupon.uk'),
    hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
  };

  return res.status(200).json({ ok: true, results, config, probes });
}
