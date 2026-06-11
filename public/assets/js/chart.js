// =========================================================
// chart.js  レーダーチャート描画 + PNG書き出し
// Chart.js v4 を前提（index.html でCDN読み込み）
// =========================================================

let radarInstance = null;

const COLORS = {
  line: '#1fa39b',
  fill: 'rgba(31,163,155,0.22)',
  point: '#36c5bb',
  grid: 'rgba(127,222,214,0.16)',
  angle: 'rgba(127,222,214,0.22)',
  tick: 'rgba(183,201,210,0.65)',
  label: '#eef4f6',
};

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
      // PNG保存時に背景透過だと見づらいので、保存側で背景を敷く
      animation: { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.parsed.r}%`,
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
            font: { size: 10, family: 'Roboto Mono, monospace' },
          },
          grid: { color: COLORS.grid },
          angleLines: { color: COLORS.angle },
          pointLabels: {
            color: COLORS.label,
            font: { size: 12, family: 'Zen Kaku Gothic New, sans-serif', weight: '600' },
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

/**
 * 現在のレーダーチャートを、濃色背景を敷いたPNG Blobとして取得する。
 * （透過のままだと明るいメール背景で線が見えにくいため）
 * @returns {Promise<Blob|null>}
 */
export async function radarToPngBlob() {
  if (!radarInstance) return null;
  const src = radarInstance.canvas;
  const out = document.createElement('canvas');
  const scale = 2; // 解像度2倍で保存
  out.width = src.width * scale;
  out.height = src.height * scale;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#0e2a3b';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0, out.width, out.height);

  return new Promise((resolve) => {
    out.toBlob((blob) => resolve(blob), 'image/png', 1);
  });
}

/** チャートを背景付きPNGとして直接ダウンロード */
export async function downloadRadarPng(filename = 'ai-literacy-radar.png') {
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
