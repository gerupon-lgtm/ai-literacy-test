// =========================================================
// export.js  結果テキスト/CSV生成・保存・ブラウザ起点メール共有
// 設計書 §9 / API仕様 §6 に準拠（サーバー送信はしない）
// =========================================================
import { radarToPngBlob } from './chart.js';

/** 汎用 Blob ダウンロード */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 結果テキスト（コピー・TXT・メール本文共通） */
export function buildResultText(summary, comment) {
  const lines = [];
  lines.push('AIリテラシー検定 結果');
  lines.push('========================');
  lines.push(`総合スコア : ${summary.scoreRate} / 100`);
  lines.push(`ランク     : ${summary.rank}`);
  lines.push(`正答数     : ${summary.correctCount} / ${summary.totalQuestions}`);
  lines.push(`偏差値     : ${summary.aiLiteracyDeviation}`);
  lines.push('');
  lines.push('— カテゴリ別理解度 —');
  summary.categoryScores.forEach((c) => {
    lines.push(`${c.category.padEnd(7, '　')} ${String(c.rate).padStart(3)}%  (${c.correct}/${c.total})`);
  });
  if (comment) {
    lines.push('');
    lines.push('— 理解度コメント —');
    lines.push(comment);
  }
  lines.push('');
  lines.push('※本結果は企業内AIリテラシー教育のセルフチェックです。');
  return lines.join('\n');
}

/** CSV文字列（BOM付きUTF-8でExcel文字化け回避） */
export function buildResultCsv(summary) {
  const rows = [];
  rows.push(['項目', '値']);
  rows.push(['総合スコア', summary.scoreRate]);
  rows.push(['ランク', summary.rank]);
  rows.push(['正答数', summary.correctCount]);
  rows.push(['問題数', summary.totalQuestions]);
  rows.push(['偏差値スコア', summary.aiLiteracyDeviation]);
  rows.push([]);
  rows.push(['カテゴリ', '正答数', '問題数', '正答率(%)']);
  summary.categoryScores.forEach((c) => {
    rows.push([c.category, c.correct, c.total, c.rate]);
  });

  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return '\uFEFF' + body; // BOM
}

export function csvBlob(summary) {
  return new Blob([buildResultCsv(summary)], { type: 'text/csv;charset=utf-8' });
}

export function txtBlob(summary, comment) {
  return new Blob([buildResultText(summary, comment)], { type: 'text/plain;charset=utf-8' });
}

/** クリップボードへコピー（失敗時フォールバック付き） */
export async function copyResult(summary, comment) {
  const text = buildResultText(summary, comment);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 古い環境向けフォールバック
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/**
 * 結果メール共有（ブラウザ起点）
 * 1) Web Share API でファイル共有可能 → 共有シート
 * 2) 非対応 → CSV/PNG/TXT を保存 + mailto: で件名・本文
 * @returns {Promise<'shared'|'fallback'|'cancelled'>}
 */
export async function shareResultByEmail(summary, comment) {
  const resultText = buildResultText(summary, comment);
  const csv = csvBlob(summary);
  const txt = txtBlob(summary, comment);
  const png = await radarToPngBlob();

  const files = [
    new File([csv], 'ai-literacy-result.csv', { type: 'text/csv' }),
    new File([txt], 'ai-literacy-result.txt', { type: 'text/plain' }),
  ];
  if (png) files.push(new File([png], 'ai-literacy-radar.png', { type: 'image/png' }));

  // 1) Web Share API（ファイル共有）
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({
        title: 'AIリテラシー検定 結果',
        text: resultText,
        files,
      });
      return 'shared';
    } catch (err) {
      // ユーザーが共有シートをキャンセルした場合
      if (err && err.name === 'AbortError') return 'cancelled';
      // それ以外はフォールバックへ続行
    }
  }

  // 2) フォールバック: ファイル保存 + mailto:
  downloadBlob(csv, 'ai-literacy-result.csv');
  downloadBlob(txt, 'ai-literacy-result.txt');
  if (png) downloadBlob(png, 'ai-literacy-radar.png');

  const subject = encodeURIComponent('AIリテラシー検定 結果');
  const body = encodeURIComponent(
    resultText + '\n\n※保存済みのCSV・TXT・PNGをメールに手動で添付してください。'
  );
  // タイミングによってはダウンロードと競合するため少し遅らせる
  setTimeout(() => { location.href = `mailto:?subject=${subject}&body=${body}`; }, 350);
  return 'fallback';
}
