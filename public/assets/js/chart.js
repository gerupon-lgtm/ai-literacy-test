// =========================================================
// chart.js  レーダーチャート描画 + PNG書き出し
// Chart.js v4 を前提（index.html でCDN読み込み）
// =========================================================

import { getBrand } from './branding.js?v=1.2.0';

let radarInstance = null;

const COLORS = {
  line: '#3f51b5',
  fill: 'rgba(63,81,181,0.18)',
  point: '#3f51b5',
  grid: 'rgba(60,76,100,0.18)',
  angle: 'rgba(60,76,100,0.22)',
  tick: '#5b6b78',
  label: '#1c2b39',
};

// 長いカテゴリ名を折り返す。
// 「・」の区切りを優先し、区切りのない長い語は行の長さがそろうように等分する
// （1文字だけ次の行に落ちるのを避ける）。1行は最大 max 文字。
export function wrapLabel(text, max = 10) {
  const s = String(text || '');
  if (s.length <= max) return [s];
  const tokens = s.split(/(?<=・)/);   // 「・」を直前の語に残して分割
  const lines = [];
  let cur = '';
  const push = () => { if (cur) { lines.push(cur); cur = ''; } };
  tokens.forEach((t) => {
    if (t.length > max) {               // 区切りのない長い語は等分
      push();
      const n = Math.ceil(t.length / max);
      const size = Math.ceil(t.length / n);
      for (let k = 0; k < t.length; k += size) lines.push(t.slice(k, k + size));
      return;
    }
    if ((cur + t).length > max) push();
    cur += t;
  });
  push();
  return lines;
}

/**
 * レーダーチャートを描画する
 * @param {HTMLCanvasElement} canvas
 * @param {string[]} labels カテゴリ名
 * @param {number[]} data 各カテゴリの正答率(0-100)
 */
export function renderRadar(canvas, labels, data) {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js が読み込まれていません');
    return null;
  }
  if (radarInstance) {
    radarInstance.destroy();
    radarInstance = null;
  }

  radarInstance = new Chart(canvas.getContext('2d'), {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label: '理解度',
        data,
        borderColor: COLORS.line,
        backgroundColor: COLORS.fill,
        borderWidth: 2,
        pointBackgroundColor: COLORS.point,
        pointBorderColor: COLORS.point,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.05,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      layout: { padding: { top: 6, bottom: 6, left: 30, right: 30 } },
      devicePixelRatio: Math.max(2, window.devicePixelRatio || 1),  // 保存画像でも文字がにじまないように
      // PNG保存時に背景透過だと見づらいので、保存側で背景を敷く
      animation: { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${[].concat(ctx.label).join('')}: ${ctx.parsed.r}%`,
          },
        },
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            stepSize: 20,
            color: COLORS.tick,
            backdropColor: 'transparent',
            font: { size: 10, family: '"Sawarabi Gothic", sans-serif' },
          },
          grid: { color: COLORS.grid },
          angleLines: { color: COLORS.angle },
          pointLabels: {
            color: COLORS.label,
            font: { size: 12, family: '"Sawarabi Gothic", sans-serif', weight: '600' },
            callback: (label) => wrapLabel(label, 10),
          },
        },
      },
    },
  });

  return radarInstance;
}

export function getRadarInstance() {
  return radarInstance;
}

function finishRadarFrame() {
  if (!radarInstance) return;
  radarInstance.stop();
  radarInstance.resize();
  radarInstance.update('none');
}

/**
 * 現在のレーダーチャートを、濃色背景を敷いたPNG Blobとして取得する。
 * （透過のままだと明るいメール背景で線が見えにくいため）
 * @returns {Promise<Blob|null>}
 */
export async function radarToPngBlob() {
  if (!radarInstance) return null;
  finishRadarFrame();
  const src = radarInstance.canvas;
  const out = document.createElement('canvas');
  const scale = 2; // 解像度2倍で保存
  out.width = src.width * scale;
  out.height = src.height * scale;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0, out.width, out.height);

  return new Promise((resolve) => {
    out.toBlob((blob) => resolve(blob), 'image/png', 1);
  });
}

/** チャートを背景付きPNGとして直接ダウンロード */
export async function downloadRadarPng(filename = 'quiz-radar.png') {
  const blob = await radarToPngBlob();
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

// 結果サマリー全体（スコア・レーダー・カテゴリ別横棒）を1枚のPNGに合成する。
// summary: { rank, scoreRate, correctCount, totalQuestions, aiLiteracyDeviation,
//            passingScore, categories:[{name, ratePercent}] }
export async function resultToPngBlob(summary) {
  finishRadarFrame();
  const scale = 2;
  const W = 720;
  const headerH = 150;
  const radarH = 380;
  const barRowH = 34;
  const cats = (summary.categories || []);
  const barsH = 60 + cats.length * barRowH + 20;
  const H = headerH + radarH + barsH + 40;

  const cv = document.createElement('canvas');
  cv.width = W * scale;
  cv.height = H * scale;
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);

  // 背景（明るいテーマに合わせて白基調）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const accent = '#3f51b5';
  const ink = '#1c2b39';
  const muted = '#5b6b78';

  // ===== ヘッダー（ランク・スコア） =====
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent;
  ctx.font = 'bold 15px "Sawarabi Gothic", sans-serif';
  ctx.fillText(`${getBrand().title} 結果`, 32, 40);

  // ランク（大きく）
  ctx.fillStyle = ink;
  ctx.font = 'bold 64px "Sawarabi Gothic", sans-serif';
  ctx.fillText(String(summary.rank || '-'), 32, 110);

  // スコア
  ctx.font = 'bold 30px "Sawarabi Gothic", sans-serif';
  ctx.fillText(`${summary.scoreRate}点`, 130, 110);

  // 補足情報（正答数・偏差値・合格ライン）
  ctx.fillStyle = muted;
  ctx.font = '14px "Sawarabi Gothic", sans-serif';
  const correct = `正答 ${summary.correctCount}/${summary.totalQuestions}`;
  const dev = (summary.aiLiteracyDeviation != null) ? `偏差値 ${summary.aiLiteracyDeviation}` : '';
  const pass = (summary.passingScore != null) ? `合格ライン ${summary.passingScore}%` : '';
  ctx.fillText([correct, dev, pass].filter(Boolean).join('  /  '), 32, 138);

  // 区切り線
  ctx.strokeStyle = '#e2e8ee';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(32, headerH); ctx.lineTo(W - 32, headerH); ctx.stroke();

  // ===== レーダーチャート =====
  if (radarInstance) {
    const src = radarInstance.canvas;
    // アスペクトを保ちつつ中央に配置
    const maxW = W - 64;
    const ratio = Math.min(maxW / src.width, (radarH - 20) / src.height);
    const dw = src.width * ratio;
    const dh = src.height * ratio;
    const dx = (W - dw) / 2;
    const dy = headerH + 10;
    ctx.drawImage(src, dx, dy, dw, dh);
  }

  // ===== カテゴリ別 横棒グラフ =====
  const barTop = headerH + radarH + 10;
  ctx.fillStyle = ink;
  ctx.font = 'bold 15px "Sawarabi Gothic", sans-serif';
  ctx.fillText('カテゴリ別 理解度', 32, barTop + 8);

  const labelW = 210;
  const barX = 32 + labelW;
  const barMaxW = W - barX - 70;
  let y = barTop + 36;
  ctx.font = '13px "Sawarabi Gothic", sans-serif';
  cats.forEach((c) => {
    const pct = Math.max(0, Math.min(100, c.ratePercent || 0));
    // ラベル
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    // 長い名前は文字を縮めて収める（最小10px。それでも入らなければ末尾を省略）
    let fs = 13;
    ctx.font = `${fs}px "Sawarabi Gothic", sans-serif`;
    while (fs > 10 && ctx.measureText(c.name).width > labelW - 12) {
      fs -= 1;
      ctx.font = `${fs}px "Sawarabi Gothic", sans-serif`;
    }
    ctx.fillText(truncate(c.name, 20), 32, y + 13);
    ctx.font = '13px "Sawarabi Gothic", sans-serif';
    // バー背景
    ctx.fillStyle = '#eef1f6';
    roundRect(ctx, barX, y, barMaxW, 16, 8); ctx.fill();
    // バー本体
    ctx.fillStyle = accent;
    roundRect(ctx, barX, y, Math.max(2, barMaxW * pct / 100), 16, 8); ctx.fill();
    // パーセント
    ctx.fillStyle = muted;
    ctx.textAlign = 'left';
    ctx.fillText(`${pct}%`, barX + barMaxW + 10, y + 13);
    y += barRowH;
  });
  ctx.textAlign = 'left';

  return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/png', 1));
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
