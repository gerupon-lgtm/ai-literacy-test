# AIリテラシー検定 Webアプリ

企業内で生成AIを安全に使うための理解度チェックを行うWebアプリです。

- **フロントエンド**: GitHub Pages（静的ホスティング）
- **AI連携API**: Vercel Functions（OpenRouter API を中継）
- **採点**: ブラウザ内の固定ロジック（AIは使わない）
- **結果メール共有**: ブラウザ起点（Web Share API / `mailto:` フォールバック）

OpenRouter の APIキーや管理者パスワードは**フロントには一切含めず**、すべて Vercel の環境変数で管理します。

---

## 1. ディレクトリ構成

```
ai-literacy-test/
├─ public/                     ← GitHub Pages で公開する静的ファイル
│  ├─ index.html               受験者画面（トップ/回答/結果）
│  ├─ admin.html               管理者画面
│  ├─ assets/
│  │  ├─ css/style.css
│  │  └─ js/                   app.js, scoring.js, quiz.js, chart.js,
│  │                           export.js, apiClient.js, config.js, admin.js
│  └─ data/
│     └─ current-question-set.json   現在の設問セット（20問）
├─ api/                        ← Vercel Functions（AI中継）
│  ├─ _lib.js                  共通処理（CORS / OpenRouter / トークン）
│  ├─ admin-login.js           管理者ログイン
│  ├─ generate-questions.js    設問案のAI生成
│  └─ analyze-result.js        結果コメントのAI生成
├─ vercel.json
├─ package.json
└─ README.md
```

**ポイント**: 受験はAPIがなくても動作します（`config.js` の `apiBase` が空のときはAIコメントの代わりに定型コメントを表示）。AI機能を使うときだけ Vercel が必要です。

---

## 2. AI機能なしで今すぐ試す（ローカル）

```bash
cd public
python3 -m http.server 8000
# ブラウザで http://localhost:8000/ を開く
```

受験・採点・レーダーチャート・CSV/PNG/テキスト保存・メール共有まで、この状態で動作します。

---

## 3. GitHub Pages の設定（フロント公開）

### 3-1. リポジトリへ push

GitHub に新しいリポジトリ（例: `ai-literacy-test`）を作成し、本プロジェクトを push します。

```bash
git init
git add .
git commit -m "AIリテラシー検定 初期版"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/ai-literacy-test.git
git push -u origin main
```

### 3-2. 公開ディレクトリの指定

GitHub Pages は通常リポジトリ直下か `/docs` を公開します。本アプリの公開対象は `public/` のため、**いずれかの方法**を選びます。

**方法A（おすすめ・簡単）**: `public/` の中身をリポジトリ直下に置く
公開対象を増やしたくない場合は、`public/` 配下をそのままリポジトリのルートに配置してください。

**方法B: GitHub Actions で `public/` を公開**
リポジトリに `.github/workflows/pages.yml` を作成します。

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: public          # ← public ディレクトリを公開
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 3-3. Pages を有効化

GitHub リポジトリの **Settings → Pages** を開き、

- 方法A: Source を「Deploy from a branch」、Branch を `main` / `(root)` に設定
- 方法B: Source を「GitHub Actions」に設定

数分後、`https://<あなたのユーザー名>.github.io/ai-literacy-test/` が公開URLになります。
このURLを**メモ**してください（Vercel 側の CORS 設定で使います）。

---

## 4. Vercel の設定（AI機能を使う場合）

AIコメント生成・AI設問生成を使うときだけ必要です。

### 4-1. OpenRouter の APIキーを取得

1. https://openrouter.ai/ にサインアップ
2. ダッシュボードで API Key を発行（`sk-or-...`）
3. 使うモデル名を決める（例: `openai/gpt-4o-mini`、`anthropic/claude-3.5-haiku` など）

### 4-2. Vercel にデプロイ

1. https://vercel.com/ にGitHubアカウントでサインイン
2. 「Add New… → Project」で本リポジトリをインポート
3. Framework Preset は **Other**（特別な設定は不要）
4. そのまま Deploy

`api/` 配下が自動的に Functions として認識されます。デプロイ後、`https://<プロジェクト名>.vercel.app` が発行されます。

### 4-3. 環境変数を設定（最重要）

Vercel の **Settings → Environment Variables** で以下を登録します。

| 変数名 | 必須 | 説明 | 例 |
|---|---|---|---|
| `OPENROUTER_API_KEY` | ✅ | OpenRouter のAPIキー | `sk-or-xxxxx` |
| `OPENROUTER_MODEL` | ✅ | 使用モデル | `openai/gpt-4o-mini` |
| `SITE_URL` | ✅ | GitHub Pages の公開URL（CORS許可元） | `https://yourname.github.io` |
| `APP_NAME` | 任意 | OpenRouter 表示名 | `AI Literacy Test` |
| `ADMIN_PASSWORD` | ✅(管理者機能) | 管理者ログイン用パスワード | 任意の強固な文字列 |
| `ADMIN_TOKEN_SECRET` | ✅(管理者機能) | トークン署名用シークレット | 長いランダム文字列 |

> `SITE_URL` は**スキームを含むドメインのみ**（末尾のパスやスラッシュなし）にしてください。例: `https://yourname.github.io`。CORS の許可Origin判定に使われます。

設定後、**Deployments → 最新 → Redeploy** で再デプロイすると環境変数が反映されます。

### 4-4. フロントから Vercel を参照させる

`public/assets/js/config.js` を開き、Vercel のURLを設定します。

```js
window.AILIT_CONFIG = {
  // 末尾スラッシュなし。空文字のままなら「AI連携なしモード」。
  apiBase: 'https://<プロジェクト名>.vercel.app',
};
```

変更を GitHub に push すると、GitHub Pages 側にAI機能が有効化されます。

---

## 5. 受験者の使い方

1. 公開URLを開く
2. 注意事項を確認して「検定を開始」
3. 20問に回答（単一選択／複数選択）
4. 結果画面でスコア・ランク・偏差値風スコア・レーダーチャートを確認
5. 「結果をコピー / CSV保存 / チャート画像保存 / メールで共有」が利用可能

> 回答欄に個人情報・顧客情報・社外秘・APIキー・パスワードを入力しないでください。これらはAIにも送信されません。

---

## 6. 管理者の使い方

1. トップ画面下部の「管理者モード」または `admin.html` を開く
2. `ADMIN_PASSWORD` でログイン（API未設定時はローカル確認モード）
3. 出題数・難易度・カテゴリ配分（重み／優先度）を調整
   - 合計が出題数と一致しない場合、優先度に基づき自動補正
   - 全カテゴリ0なら初期配分を使用
4. 変更指示を自然文で入力し「設問を生成」（要 Vercel + OpenRouter）
5. プレビューで内容を確認し「採用」→ `current-question-set.json` がダウンロードされる
6. ダウンロードしたJSONを `public/data/current-question-set.json` に上書きして GitHub へコミット

> 初期版では設問の反映は手動コミット方式です（安全のため）。自動更新は将来拡張です。

---

## 7. カテゴリと初期配分

| ID | カテゴリ | 初期問題数 | 優先度 |
|---|---|---:|---:|
| C-001 | 基本理解 | 3 | 3 |
| C-002 | 指示の出し方 | 3 | 2 |
| C-003 | 情報管理 | 4 | 1 |
| C-004 | セキュリティ | 4 | 1 |
| C-005 | 法務・倫理 | 2 | 4 |
| C-006 | 業務活用 | 2 | 5 |
| C-007 | 最新トレンド | 2 | 6 |

合計20問。ランクは S(90+)/A(80+)/B(70+)/C(60+)/D、合格ライン70点。

---

## 8. セキュリティ設計

- OpenRouter APIキー・管理者パスワードはフロントに含めず、Vercel 環境変数のみで管理。
- AIへ送るのはスコアとカテゴリ別傾向だけ。氏名・社員番号・メール・部署・顧客名などは送らない（フロントとサーバーの二重除去）。
- 管理者トークンは HMAC-SHA256 署名付き・有効期限1時間。
- CORS は `SITE_URL`（GitHub Pages）からのアクセスのみ許可。

---

## 9. トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| AIコメントが定型文のまま | `config.js` の `apiBase` が空、または Vercel 未デプロイ。手順4を確認。 |
| ブラウザに CORS エラー | Vercel の `SITE_URL` が GitHub Pages のURLと不一致。スキーム込み・末尾スラッシュなしで設定。 |
| 管理者ログインで500 | `ADMIN_PASSWORD` / `ADMIN_TOKEN_SECRET` が未設定。Vercel環境変数を設定し再デプロイ。 |
| 設問生成が502 | OpenRouter のキー・モデル名・残高を確認。 |
| レーダーチャートが出ない | Chart.js CDN への通信がブロックされていないか確認。 |

---

## 10. MVP 完成条件（仕様書 §7）との対応

- ✅ PCとスマホで受験できる（レスポンシブ 599/1024px）
- ✅ 20問の初期設問で採点できる
- ✅ 指示の出し方3問・セキュリティ4問の初期配分
- ✅ 結果コピー / CSV保存 / レーダーチャート画像保存
- ✅ ブラウザ起点で結果メール共有（Web Share API + `mailto:` フォールバック）
- ✅ 管理者画面で設問生成指示・難易度・カテゴリ配分を設定
- ✅ OpenRouter APIキーがフロントに露出していない
