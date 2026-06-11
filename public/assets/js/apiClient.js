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

/** 設問案生成（単一バッチ）。1リクエスト=1バッチ。 */
export async function generateQuestionsBatch(payload, { timeout = 120000 } = {}) {
  // 1バッチは数問なので長めのタイムアウト（既定120秒）。
  const data = await postJson('generate-questions', payload, { timeout });
  return data;
}

/**
 * 設問案を分割生成して結合する。
 * Vercel の実行時間上限を避けるため、batchSize 問ずつ複数回に分けて呼ぶ。
 *
 * @param {object} opts
 *   adminToken, instruction, settings, currentQuestionSet
 *   batchSize        1バッチの問題数（既定5）
 *   onProgress       (info) => void  進捗通知 {batchIndex,totalBatches,collected,provider,model}
 *   perBatchTimeout  各バッチのタイムアウトms（既定180000=3分）
 *   maxRetryPerBatch 各バッチの再試行回数（既定1）
 * @returns {Promise<{questions:Array, totalBatches:number, provider:string, model:string, warnings:Array}>}
 */
export async function generateQuestionsChunked(opts) {
  const {
    adminToken, instruction, settings, currentQuestionSet,
    batchSize = 5, onProgress, perBatchTimeout = 180000, maxRetryPerBatch = 1,
  } = opts;

  const questionCount = Number(settings && settings.questionCount) || 20;
  const totalBatches = Math.ceil(questionCount / batchSize);

  const all = [];
  const existingQuestions = [];
  const allWarnings = [];
  let lastProvider = null;
  let lastModel = null;

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    let attempt = 0;
    let ok = false;
    let lastErr = null;

    while (attempt <= maxRetryPerBatch && !ok) {
      try {
        const data = await generateQuestionsBatch({
          adminToken, instruction, settings, currentQuestionSet,
          batchSize, batchIndex, existingQuestions,
        }, { timeout: perBatchTimeout });

        for (const q of (data.questions || [])) {
          all.push(q);
          existingQuestions.push(q.question);
        }
        if (Array.isArray(data.warnings)) allWarnings.push(...data.warnings);
        lastProvider = data.provider || lastProvider;
        lastModel = data.model || lastModel;
        ok = true;

        if (typeof onProgress === 'function') {
          onProgress({
            batchIndex, totalBatches, collected: all.length,
            provider: data.provider, model: data.model,
          });
        }
      } catch (err) {
        lastErr = err;
        attempt++;
        if (attempt > maxRetryPerBatch) {
          // バッチ失敗。ここまでの結果を添えてエラーを投げる。
          const e = new Error(`バッチ ${batchIndex + 1}/${totalBatches} の生成に失敗しました: ${err.message}`);
          e.code = err.code || 'BATCH_FAILED';
          e.partial = all;
          e.warnings = allWarnings;
          throw e;
        }
      }
    }
  }

  // ID を通し番号で再採番
  all.forEach((q, i) => { q.id = `Q${String(i + 1).padStart(3, '0')}`; });

  return { questions: all, totalBatches, provider: lastProvider, model: lastModel, warnings: allWarnings };
}

/** 後方互換: 旧API名。内部で分割生成を使う。 */
export async function generateQuestions(payload) {
  return generateQuestionsChunked(payload);
}
