// =========================================================
// api/_lib.js
// Vercel Functions 共通ライブラリ
//  - CORS 制御（GitHub Pages の Origin のみ許可）
//  - JSON ボディ読み取り
//  - OpenRouter 呼び出し
//  - 管理者トークン発行 / 検証（HMAC 署名）
//  - システムプロンプト定義
// =========================================================
import crypto from 'node:crypto';

// ---------------------------------------------------------
// CORS
// ---------------------------------------------------------
// 許可 Origin は環境変数 SITE_URL（GitHub Pages 公開 URL）に限定する。
// 例: https://your-name.github.io
// ローカル開発用に http://localhost:* / http://127.0.0.1:* も許可する。
function getAllowedOrigin(req) {
  const configured = (process.env.SITE_URL || '').replace(/\/+$/, '');
  const origin = (req.headers && req.headers.origin) || '';

  if (configured && origin === configured) return origin;

  // ローカル開発（任意ポート）
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;

  // 既定（設定済みなら本番 Origin、未設定なら同一オリジン扱いで '*' は使わない）
  return configured || '';
}

export function applyCors(res, req) {
  // req は任意（後方互換）。呼び出し側が渡さない場合は SITE_URL を使う。
  const allowed = req ? getAllowedOrigin(req) : (process.env.SITE_URL || '').replace(/\/+$/, '');
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    applyCors(res, req);
    res.status(204).end();
    return true;
  }
  return false;
}

// ---------------------------------------------------------
// JSON ボディ読み取り
// Vercel では req.body が解析済みのこともあるが、
// raw stream で来る場合にも対応する。
// ---------------------------------------------------------
export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length) {
    return JSON.parse(req.body);
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

// ---------------------------------------------------------
// 管理者トークン（HMAC-SHA256 署名付き / 有効期限あり）
// 外部ライブラリ不要のシンプルな実装。
// 形式: base64url(payload).base64url(signature)
// ---------------------------------------------------------
function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlJson(obj) {
  return base64url(JSON.stringify(obj));
}
function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function issueAdminToken(expiresInSeconds = 3600) {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  if (!secret) throw new Error('ADMIN_TOKEN_SECRET is not configured');
  const payload = {
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };
  const body = base64urlJson(payload);
  const sig = sign(body, secret);
  return `${body}.${sig}`;
}

export function verifyAdminToken(token) {
  try {
    const secret = process.env.ADMIN_TOKEN_SECRET;
    if (!secret || !token || typeof token !== 'string') return false;
    const [body, sig] = token.split('.');
    if (!body || !sig) return false;
    const expected = sign(body, secret);
    // タイミング安全比較
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (payload.role !== 'admin') return false;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------
// OpenRouter 呼び出し
// ---------------------------------------------------------
export async function callOpenRouter({ system, user, temperature = 0.2, maxTokens = 800, responseFormat = null }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const payload = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (responseFormat) payload.response_format = responseFormat;

  // タイムアウト制御（60 秒）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  let response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.SITE_URL || '',
        'X-Title': process.env.APP_NAME || 'AI Literacy Test',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenRouter HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = await response.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    && data.choices[0].message.content;
  if (!content) throw new Error('OpenRouter returned empty content');
  return content;
}

// ---------------------------------------------------------
// システムプロンプト（設計書 §10）
// ---------------------------------------------------------
export const ANALYZE_SYSTEM_PROMPT = [
  'あなたは企業内AIリテラシー研修のフィードバック担当です。',
  '受験結果に基づいて、理解度コメントを作成してください。',
  '',
  '制約:',
  '- 受験者を責めない。',
  '- 企業内での安全なAI利用につながる助言にする。',
  '- 個人情報や機密情報の入力を促さない。',
  '- スコアとカテゴリ別傾向だけを根拠にする。',
  '- 200〜300字程度で返す。',
  '- コメント本文のみを返し、前置きや見出しは付けない。',
].join('\n');

export const GENERATE_SYSTEM_PROMPT = [
  'あなたは企業内AIリテラシー教育の設問作成者です。',
  '以下の条件を厳守してください。',
  '',
  '- 企業内での生成AI利用に関する選択式問題を作成する。',
  '- 個人情報、機密情報、APIキー、社外秘情報など、入力してはいけない情報に関する問題を含める。',
  '- プロンプトインジェクション、誤情報、著作権、個人情報保護、AIの限界を含める。',
  '- 最新トレンドは、管理者から指定された範囲に限定して扱う。',
  '- 実在企業・実在人物の未確認情報を断定しない。',
  '- 正解は必ず選択肢の中に含める。',
  '- 出力は指定JSONスキーマに完全準拠する。',
  '- 解説は短く、企業内利用者にわかりやすい表現にする。',
].join('\n');

// カテゴリ定義（バリデーション用）
export const CATEGORY_DEFS = [
  { id: 'C-001', label: '基本理解' },
  { id: 'C-002', label: '指示の出し方' },
  { id: 'C-003', label: '情報管理' },
  { id: 'C-004', label: 'セキュリティ' },
  { id: 'C-005', label: '法務・倫理' },
  { id: 'C-006', label: '業務活用' },
  { id: 'C-007', label: '最新トレンド' },
];
export const CATEGORY_IDS = CATEGORY_DEFS.map((c) => c.id);
