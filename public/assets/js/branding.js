// =========================================================
// branding.js  出題セットごとの名称・文言（タイトル／テーマ等）
//
// 出題セットJSONの最上位に、次の項目を（任意で）書けます。
//   title         検定の名前            例: "情報セキュリティ検定"
//   theme         コメント用のテーマ名   例: "情報セキュリティ"
//   description   トップ画面の説明文
//   footerNote    トップ画面下部の注記
//   resultNote    結果のコピー文末尾の注記
//   perfectMessage 全問正解のときの文
//   rankComments  { S, A, B, C, D } ランク別の一言
// 書かれていない項目は、下の LEGACY（AIリテラシー検定）の値になります。
// セットを読み込む前（または読み込み失敗時）は PLACEHOLDER_TITLE を表示します。
// =========================================================

export const PLACEHOLDER_TITLE = '検定';

const LEGACY = {
  title: 'AIリテラシー検定',
  theme: 'AIリテラシー',
  description:
    '企業内で生成AIを安全に使うための理解度を、選択式でセルフチェックします。結果はカテゴリ別に可視化され、弱点と次の学習ポイントがわかります。',
  footerNote:
    '企業内AIリテラシー教育向けセルフチェック。採点・正誤判定はブラウザ内の固定ロジックで行い、個人情報をAIへ送信しません。',
  resultNote: '※本結果は企業内AIリテラシー教育のセルフチェックです。',
  perfectMessage: '全問正解です。安全なAI活用の基礎は十分に身についています。',
  rankComments: {
    S: '実務利用の基礎は十分。管理・推進側も視野に入ります。',
    A: '基本理解は高い水準です。弱点カテゴリの補強を推奨します。',
    B: '一般的な利用は可能。情報管理と安全性を再確認しましょう。',
    C: '利用前に社内ルールと禁止事項の再学習が必要です。',
    D: '業務利用の前に、基礎研修の受講を推奨します。',
  },
};

// テーマを書いていない（＝タイトルだけ書いた）セット向けの、テーマ非依存の既定文
const NEUTRAL = {
  description: '理解度を、選択式でセルフチェックします。結果はカテゴリ別に可視化され、弱点と次の学習ポイントがわかります。',
  footerNote: '社内向けセルフチェック。採点・正誤判定はブラウザ内の固定ロジックで行い、個人情報をAIへ送信しません。',
  resultNote: '※本結果はセルフチェックです。',
  perfectMessage: '全問正解です。基礎は十分に身についています。',
  rankComments: {
    S: '基礎は十分に身についています。周囲への共有や推進役も視野に入ります。',
    A: '基本理解は高い水準です。弱点カテゴリの補強を推奨します。',
    B: '概ね理解できています。弱点カテゴリを見直しましょう。',
    C: '基本事項の再確認が必要です。解説を読み直しましょう。',
    D: '基礎から学び直すことを推奨します。',
  },
};

function str(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function longStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

/** 出題セット（またはnull）から、画面に出す名称・文言を決める */
export function resolveBrand(set) {
  if (!set || typeof set !== 'object') {
    return {
      title: PLACEHOLDER_TITLE,
      theme: '',
      description: '',
      footerNote: '',
      resultNote: '',
      perfectMessage: NEUTRAL.perfectMessage,
      rankComments: NEUTRAL.rankComments,
      isPlaceholder: true,
    };
  }
  const title = str(set.title, 40);
  const theme = str(set.theme, 40);
  // タイトルもテーマも無い＝従来のAIリテラシー検定のセット
  const legacy = !title && !theme;
  const base = legacy ? LEGACY : NEUTRAL;
  const rc = set.rankComments && typeof set.rankComments === 'object' ? set.rankComments : {};
  const rankComments = {};
  ['S', 'A', 'B', 'C', 'D'].forEach((k) => {
    rankComments[k] = longStr(rc[k], 120) || base.rankComments[k];
  });
  return {
    title: title || (legacy ? LEGACY.title : PLACEHOLDER_TITLE),
    theme: theme || (legacy ? LEGACY.theme : title),
    description: longStr(set.description, 300) || base.description,
    footerNote: longStr(set.footerNote, 300) || base.footerNote,
    resultNote: longStr(set.resultNote, 200) || base.resultNote,
    perfectMessage: longStr(set.perfectMessage, 200) || base.perfectMessage,
    rankComments,
    isPlaceholder: false,
  };
}

// ---- 現在のブランド（chart.js / export.js などから参照） ----
let current = resolveBrand(null);

export function setBrand(brand) {
  current = brand;
}

export function getBrand() {
  return current;
}

/** 画面（ヘッダ・タブ名・説明文・注記）へ反映 */
export function applyBrand(brand) {
  setBrand(brand);
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set('brand-name', brand.title);
  set('top-lead', brand.description);
  set('footer-note', brand.footerNote);
  document.title = brand.title;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', brand.description || brand.title);
}

/** 出題セットのうち、名称・文言に関する項目だけを取り出す（管理画面での保存時に引き継ぐ用） */
export const BRAND_KEYS = ['title', 'theme', 'description', 'footerNote', 'resultNote', 'perfectMessage', 'rankComments'];

export function pickBrandFields(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  BRAND_KEYS.forEach((k) => {
    if (src[k] != null && src[k] !== '') out[k] = src[k];
  });
  return out;
}
