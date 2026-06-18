// =========================================================
// api/_providers.js
// 複数の LLM プロバイダを共通インターフェースで扱い、
// 設定した順にフォールバックする。
//
// 対応プロバイダ:
//   - openrouter : OpenRouter（無料モデル中心。openrouter/free 等）
//   - gemini     : Google Gemini（無料枠 Flash 系）
//   - ollama     : 自宅 Ollama（Cloudflare Access 背後。Service Token 対応）
//
// フォールバック順は環境変数 LLM_PROVIDER_ORDER で制御する。
//   例: LLM_PROVIDER_ORDER="openrouter,gemini,ollama"
//   未設定時の既定も同じ（OpenRouter 無料モデル最優先）。
//
// 各プロバイダ内で複数モデルを試したい場合はカンマ区切りで指定:
//   OPENROUTER_MODEL="openrouter/free,meta-llama/llama-4-maverick:free"
//   GEMINI_MODEL="gemini-3-flash,gemini-2.5-flash-lite"
//   OLLAMA_MODEL="qwen2.5:7b"
// =========================================================

// ---------------------------------------------------------
// 小さなユーティリティ
// ---------------------------------------------------------
function envList(name, fallback) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback ? fallback.slice() : [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// タイムアウト付き fetch
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// AI 応答テキストから JSON を取り出す（フェンスや前置きを許容）
export function extractJsonLoose(text) {
  if (!text) throw new Error('empty response');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no json object found');
  return JSON.parse(raw.slice(start, end + 1));
}

// 既定のプロバイダ実行順（Gemini 有料契約を最優先）
const DEFAULT_ORDER = ['gemini', 'openrouter', 'ollama'];

// プロバイダごとの既定モデル（response_format対応・日本語可）
// ※ モデルの提供状況は変動するため、診断API(list-models)で実在を確認できる。
//   環境変数 GEMINI_MODEL / OPENROUTER_MODEL / OLLAMA_MODEL で上書き推奨。
const DEFAULT_MODELS = {
  // Gemini 有料: コスト重視。最安の Flash-Lite を先頭に、標準 Flash を保険に。
  //   2.5-flash-lite: $0.10/$0.40（最安）／ 2.5-flash: $0.30/$2.50
  gemini: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
  // OpenRouter 無料（保険）。混雑時は429になりやすいので後段に。
  openrouter: [
    'deepseek/deepseek-chat-v3.1:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'openrouter/free',
  ],
  ollama: ['qwen2.5:7b'],
};

// ---------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------
async function callOpenRouterModel({ model, system, user, temperature, maxTokens, jsonSchema, jsonMode, timeoutMs }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const body = { model, messages, temperature, max_tokens: maxTokens };
  // structured outputs。json_schema が使えるモデルなら厳密化、無ければ json_object。
  // jsonMode=false（プレーンテキスト希望）のときは response_format を付けない。
  if (jsonMode !== false) {
    if (jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'response', strict: false, schema: jsonSchema },
      };
    } else {
      body.response_format = { type: 'json_object' };
    }
  }

  const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.SITE_URL || '',
      'X-Title': process.env.APP_NAME || 'AI Literacy Test',
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OpenRouter[${model}] HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`OpenRouter[${model}] empty content`);
  return content;
}

// ---------------------------------------------------------
// Google Gemini（generateContent API）
// ---------------------------------------------------------
async function callGeminiModel({ model, system, user, temperature, maxTokens, jsonSchema, jsonMode, timeoutMs }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const generationConfig = {
    temperature,
    maxOutputTokens: maxTokens,
    // jsonMode=false（プレーンテキスト希望）なら text/plain。
    responseMimeType: jsonMode === false ? 'text/plain' : 'application/json',
  };
  if (jsonMode !== false && jsonSchema) generationConfig.responseSchema = toGeminiSchema(jsonSchema);

  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig,
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs);

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gemini[${model}] HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const content = Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
  if (!content) throw new Error(`Gemini[${model}] empty content`);
  return content;
}

// JSON Schema を Gemini の responseSchema 形式へ簡易変換
// （type を大文字化。最低限のサブセットのみ対応）
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') out.type = v.toUpperCase();
    else if (k === 'properties' && v && typeof v === 'object') {
      out.properties = {};
      for (const [pk, pv] of Object.entries(v)) out.properties[pk] = toGeminiSchema(pv);
    } else if (k === 'items') out.items = toGeminiSchema(v);
    else if (k === 'additionalProperties') { /* Gemini非対応のため落とす */ }
    else out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------
// Ollama（自宅サーバー / Cloudflare Access 背後）
// Service Token（CF-Access-Client-Id / CF-Access-Client-Secret）対応。
// 認証バイパス済みならヘッダ無しでも動く。
// ---------------------------------------------------------
async function callOllamaModel({ model, system, user, temperature, maxTokens, jsonSchema, jsonMode, timeoutMs }) {
  const base = (process.env.OLLAMA_BASE_URL || 'https://ollama.gerupon.uk').replace(/\/+$/, '');
  const url = `${base}/api/chat`;

  const headers = { 'Content-Type': 'application/json' };
  // Cloudflare Access Service Token（設定があれば付与）
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const body = {
    model,
    messages,
    stream: false,
    options: { temperature, num_predict: maxTokens },
  };
  // jsonMode=false（プレーンテキスト希望）なら format を付けない。
  if (jsonMode !== false) {
    body.format = jsonSchema ? jsonSchema : 'json';
  }

  const res = await fetchWithTimeout(url, {
    method: 'POST', headers, body: JSON.stringify(body),
  }, timeoutMs);

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    // 認証画面HTMLが返るケースを分かりやすく
    const hint = /<html|cloudflare|access/i.test(t) ? '（Cloudflare認証に阻まれている可能性。Service Tokenを確認）' : '';
    throw new Error(`Ollama[${model}] HTTP ${res.status}: ${t.slice(0, 200)}${hint}`);
  }
  const data = await res.json();
  const content = data?.message?.content;
  if (!content) throw new Error(`Ollama[${model}] empty content`);
  return content;
}

// ---------------------------------------------------------
// プロバイダ・ディスパッチ
// ---------------------------------------------------------
const PROVIDER_FNS = {
  openrouter: callOpenRouterModel,
  gemini: callGeminiModel,
  ollama: callOllamaModel,
};

function isProviderConfigured(name) {
  if (name === 'openrouter') return !!process.env.OPENROUTER_API_KEY;
  if (name === 'gemini') return !!process.env.GEMINI_API_KEY;
  if (name === 'ollama') return !!(process.env.OLLAMA_BASE_URL || 'https://ollama.gerupon.uk');
  return false;
}

/**
 * フォールバック付き LLM 呼び出し。
 * プロバイダ順 → 各プロバイダ内モデル順 に試し、最初の成功を返す。
 *
 * @returns {Promise<{content:string, provider:string, model:string, attempts:Array}>}
 */
export async function callLLM({
  system,
  user,
  temperature = 0.3,
  maxTokens = 4000,
  jsonSchema = null,
  jsonMode = true,
  timeoutMs = 55000,
}) {
  const order = envList('LLM_PROVIDER_ORDER', DEFAULT_ORDER);
  const attempts = [];

  for (const provider of order) {
    if (!PROVIDER_FNS[provider]) {
      attempts.push({ provider, model: null, ok: false, error: 'unknown provider' });
      continue;
    }
    if (!isProviderConfigured(provider)) {
      attempts.push({ provider, model: null, ok: false, error: 'not configured (skipped)' });
      continue;
    }

    const envName = `${provider.toUpperCase()}_MODEL`;
    const models = envList(envName, DEFAULT_MODELS[provider] || []);

    for (const model of models) {
      // 一時エラー（429/503）には指数バックオフで数回リトライ
      const maxRetries = 2;
      for (let retry = 0; retry <= maxRetries; retry++) {
        try {
          const content = await PROVIDER_FNS[provider]({
            model, system, user, temperature, maxTokens, jsonSchema, jsonMode, timeoutMs,
          });
          attempts.push({ provider, model, ok: true, retry });
          return { content, provider, model, attempts };
        } catch (err) {
          const msg = String(err && err.message || err);
          const transient = /HTTP 429|HTTP 503|HTTP 500|HTTP 502|HTTP 504|aborted|timeout|ETIMEDOUT|ECONNRESET/i.test(msg);
          if (transient && retry < maxRetries) {
            // 0.8s, 1.6s, ... + ジッター
            const wait = Math.round(800 * Math.pow(2, retry) + Math.random() * 300);
            await new Promise((r) => setTimeout(r, wait));
            continue; // 同じモデルで再試行
          }
          attempts.push({ provider, model, ok: false, error: msg, retry });
          break; // 次のモデル / プロバイダへ
        }
      }
    }
  }

  const summary = attempts.map((a) => `${a.provider}/${a.model || '-'}: ${a.ok ? 'ok' : a.error}`).join(' | ');
  const e = new Error(`All providers failed. ${summary}`);
  e.attempts = attempts;
  throw e;
}
