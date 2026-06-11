// =========================================================
// apiClient.js  Vercel Functions 呼び出しクライアント
// API Base URL は config.js の window.API_BASE で上書き可能
// =========================================================

// 既定は同一オリジン。GitHub Pages から別ドメインのVercelを呼ぶ場合は
// public/assets/js/config.js で window.AILIT_CONFIG.apiBase を設定する。
function apiBase() {
  const cfg = window.AILIT_CONFIG || {};
  return (cfg.apiBase || '').replace(/\/$/, '');
}

const DEFAULT_TIMEOUT = 20000;

async function postJson(path, body, { timeout = DEFAULT_TIMEOUT } = {}) {
  const base = apiBase();
  const url = `${base}/api/${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const msg = data.message || `APIエラー (${res.status})`;
      const err = new Error(msg);
      err.code = data.code || `HTTP_${res.status}`;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('AI応答がタイムアウトしました。');
      e.code = 'TIMEOUT';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** API が設定済みか（apiBase が空ならAI連携なしモード） */
export function isApiConfigured() {
  return !!apiBase();
}

/** 結果分析コメント生成。失敗時は null を返し、呼び出し側でフォールバック表示。 */
export async function analyzeResult(resultSummary) {
  // 送信前に念のため個人情報になり得るフィールドを除外
  const safe = {
    totalQuestions: resultSummary.totalQuestions,
    correctCount: resultSummary.correctCount,
    scoreRate: resultSummary.scoreRate,
    rank: resultSummary.rank,
    aiLiteracyDeviation: resultSummary.aiLiteracyDeviation,
    categoryScores: resultSummary.categoryScores,
    weakCategories: resultSummary.weakCategories,
    strongCategories: resultSummary.strongCategories,
  };
  const data = await postJson('analyze-result', { resultSummary: safe });
  return data.comment || null;
}

/** 管理者ログイン → adminToken */
export async function adminLogin(password) {
  const data = await postJson('admin-login', { password });
  return data;
}

/** 設問案生成 */
export async function generateQuestions(payload) {
  const data = await postJson('generate-questions', payload, { timeout: 60000 });
  return data;
}
