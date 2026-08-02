# AIリテラシー検定 Webアプリ

**バージョン: ver 1.0.0**

企業内で生成AIを安全に使うための理解度チェックを行うWebアプリです。

- **フロントエンド**: GitHub Pages（静的ホスティング／GitHub Actions で `public/` を自動デプロイ）
- **AI連携API**: Vercel Functions（OpenRouter / Gemini / Ollama を中継・自動フォールバック）
- **採点**: ブラウザ内の固定ロジック（AIは使わない）
- **結果メール共有**: ブラウザ起点（Web Share API / `mailto:` フォールバック）

APIキーや管理者パスワードは**フロントには一切含めず**、すべて Vercel の環境変数で管理します。

---

## 1. ディレクトリ構成

```
ai-literacy-test/
├─ public/                     ← GitHub Pages で公開する静的ファイル
│  ├─ index.html               受験者画面（トップ/回答/結果）
│  ├─ admin.html               管理者画面（AI生成 / 設問プール・組み立ての2タブ）
│  ├─ assets/
│  │  ├─ css/style.css
│  │  ├─ img/                  画像素材
│  │  └─ js/
│  │     ├─ app.js             受験フロー全体の制御
│  │     ├─ quiz.js            出題の組み立て（配分・シャッフル）
│  │     ├─ scoring.js         採点・ランク・偏差値風スコア
│  │     ├─ chart.js           レーダーチャート描画・結果画像合成
│  │     ├─ export.js          コピー / CSV / PNG / メール共有
│  │     ├─ apiClient.js       Vercel Functions 呼び出し
│  │     ├─ config.js          apiBase 設定
│  │     ├─ categories.js      カテゴリ定義（サーバー側と一致させる）
│  │     ├─ admin.js           管理者画面のロジック
│  │     └─ pool.js            設問プール／組み立てモード
│  └─ data/
│     ├─ current-question-set.json   現在の出題セット（本番で読まれる）
│     ├─ sample-question-set.json    初期サンプル（20問・locked）
│     ├─ active-set.json             アクティブなセットIDの指定（GitHub連携で生成）
│     └─ sets/                       保存済みセット置き場（GitHub連携で生成）
├─ api/                        ← Vercel Functions（AI中継・管理者API）
│  ├─ _lib.js                  共通処理（CORS / JSONボディ / 管理者トークン / プロンプト）
│  ├─ _providers.js            マルチLLM抽象化とフォールバック
│  ├─ admin-login.js           管理者ログイン（HMAC署名トークン発行）
│  ├─ generate-questions.js    設問案のAI生成（分割バッチ）
│  ├─ analyze-result.js        結果コメントのAI生成
│  ├─ list-models.js           利用可能モデルの診断
│  └─ github-save.js           設問セットの保存・一覧・切替（GitHub API）
├─ tests/
│  └─ scoring.test.js          採点ロジックの単体テスト
├─ .github/workflows/pages.yml GitHub Pages への自動デプロイ
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

### 採点ロジックのテスト

```bash
npm test          # node tests/scoring.test.js
```

正誤判定（単一／複数選択）、スコア率、ランク、偏差値風スコア、カテゴリ別集計を検証します。

---

## 3. GitHub Pages の設定（フロント公開）

### 3-1. リポジトリへ push

```bash
git init
git add .
git commit -m "AIリテラシー検定 初期版"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/ai-literacy-test.git
git push -u origin main
```

### 3-2. Pages を有効化

本リポジトリには **`.github/workflows/pages.yml` を同梱済み**で、`main` への push をトリガーに `public/` ディレクトリを GitHub Pages へデプロイします。

GitHub リポジトリの **Settings → Pages** を開き、Source を「**GitHub Actions**」に設定してください（「Deploy from a branch」ではありません）。

数分後、`https://<あなたのユーザー名>.github.io/ai-literacy-test/` が公開URLになります。
このURLを**メモ**してください（Vercel 側の CORS 設定で使います）。

> `workflow_dispatch` も有効なので、Actions タブから手動で再デプロイもできます。

---

## 4. Vercel の設定（AI機能を使う場合）

AIコメント生成・AI設問生成・GitHub連携を使うときだけ必要です。

### 4-1. LLMプロバイダのキーを用意（少なくとも1つ）

本アプリは **Gemini / OpenRouter / Ollama** の3系統に対応し、設定した順に自動フォールバックします（あるプロバイダが落ちても次を試す）。基本は**クレジット不要の無料モデル**を使えます。

**① Gemini（既定の最優先）**
1. https://aistudio.google.com/ で API キーを発行（無料、カード不要）
2. 既定モデルは `gemini-2.5-flash-lite` → `gemini-2.5-flash` の順で試行
3. 注意: Geminiの**無料枠は入出力がモデル改善に使われる**規約です。本アプリはスコアと傾向しかAIに送らない設計なので問題ありませんが、念のため把握しておいてください。

**② OpenRouter（フォールバック先）**
1. https://openrouter.ai/ にサインアップ（クレジットカード不要で無料モデルが使えます）
2. API Key を発行（`sk-or-...`）
3. 既定モデルは `openrouter/free`。これは「structured output対応の無料モデルを自動選択するルーター」で、特定モデルが消えても自動で別の無料モデルに切り替わります。

**③ Ollama（自宅サーバー・最終フォールバック）**
- 自宅の Ollama（例 `https://ollama.gerupon.uk`）を使えます。Cloudflare Access の背後にある場合は、後述の Service Token を設定します。
- 既定モデルは日本語可の `qwen2.5:7b`。

> **無料モデルの推奨**: 無料枠の内容は変わりやすいので、自動選択ルーターである OpenRouter の `openrouter/free` を候補に含めておくと安定します。

### 4-2. Vercel にデプロイ

1. https://vercel.com/ にGitHubアカウントでサインイン
2. 「Add New… → Project」で本リポジトリをインポート
3. Framework Preset は **Other**（特別な設定は不要）
4. そのまま Deploy

`api/` 配下が自動的に Functions として認識されます。デプロイ後、`https://<プロジェクト名>.vercel.app` が発行されます。

> **実行時間の上限**: `vercel.json` で `api/*.js` の `maxDuration` を 300 秒に設定しています。実際の上限はプランに従い、Hobbyプランでは60秒が上限です。本アプリは**設問を数問ずつ分割生成**するので、Hobbyプランの60秒制限でも大量の設問を安全に作れます（1バッチが短時間で終わるため）。

### 4-3. 環境変数を設定（最重要）

Vercel の **Settings → Environment Variables** で登録します。**使う機能の分だけ**設定すればOKです。

**共通**

| 変数名 | 必須 | 説明 | 例 |
|---|---|---|---|
| `SITE_URL` | ✅ | GitHub Pages の公開URL（CORS許可元） | `https://yourname.github.io` |
| `ADMIN_PASSWORD` | ✅(管理者機能) | 管理者ログイン用パスワード | 任意の強固な文字列 |
| `ADMIN_TOKEN_SECRET` | ✅(管理者機能) | トークン署名用シークレット | 長いランダム文字列 |
| `APP_NAME` | 任意 | OpenRouter 表示名 | `AI Literacy Test` |
| `LLM_PROVIDER_ORDER` | 任意 | フォールバック順（既定 `gemini,openrouter,ollama`） | `openrouter,gemini,ollama` |

**Gemini を使う場合**

| 変数名 | 説明 | 既定値 |
|---|---|---|
| `GEMINI_API_KEY` | APIキー（`AIza...`） | — |
| `GEMINI_MODEL` | モデル（カンマ区切りで複数可・安い順推奨） | `gemini-2.5-flash-lite,gemini-2.5-flash` |

**OpenRouter を使う場合**

| 変数名 | 説明 | 既定値 |
|---|---|---|
| `OPENROUTER_API_KEY` | APIキー（`sk-or-v1-...`） | — |
| `OPENROUTER_MODEL` | モデル（カンマ区切りで複数可） | `openrouter/free` ほか |

**Ollama（自宅サーバー）を使う場合**

| 変数名 | 説明 | 例 |
|---|---|---|
| `OLLAMA_BASE_URL` | OllamaのURL | `https://ollama.gerupon.uk` |
| `OLLAMA_MODEL` | モデル（カンマ区切りで複数可） | `qwen2.5:7b` |
| `CF_ACCESS_CLIENT_ID` | Cloudflare Service Token のID（認証背後の場合） | `xxxx.access` |
| `CF_ACCESS_CLIENT_SECRET` | 同 Secret | （長い文字列） |

**GitHub連携（複数セットの保存・切替）を使う場合**

| 変数名 | 説明 | 例 |
|---|---|---|
| `GITHUB_TOKEN` | Fine-grained PAT（Contents: Read and write） | `github_pat_...` |
| `GITHUB_OWNER` | リポジトリ所有者 | `yourname` |
| `GITHUB_REPO` | リポジトリ名 | `ai-literacy-test` |
| `GITHUB_BRANCH` | 対象ブランチ（省略時 `main`） | `main` |

> **GitHub連携について**: 管理画面から複数の出題セットを `public/data/sets/` に保存し、検定で使うものを切り替える機能です。トークンは **Fine-grained personal access token** を推奨し、権限は対象リポジトリの **Contents: Read and write** のみに絞ってください。トークンはVercelの環境変数に置くためブラウザには露出しません。未設定でも従来のダウンロード方式は使えます。

> **Cloudflare Access 背後のOllamaについて**: `ollama.gerupon.uk` がメール認証（Cloudflare Access）の背後にある場合、直接アクセスはログイン画面にリダイレクトされて失敗します。Cloudflare Zero Trust → Access → **Service Auth → Create Service Token** で発行し、対象アプリのポリシーに「Service Auth」を許可するルールを追加してください。発行された Client ID / Secret を上記環境変数に設定すれば、Vercelの関数が認証を通過してOllamaを呼べます。

> `SITE_URL` は**スキームを含むドメインのみ**（末尾のパスやスラッシュなし）。例: `https://yourname.github.io`。CORS の許可Origin判定に使われます。ローカル開発用に `http://localhost:*` / `http://127.0.0.1:*` は常に許可されます。

設定後、**Deployments → 最新 → Redeploy** で再デプロイすると環境変数が反映されます（**これを忘れると反映されません**）。

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
2. 出題セット名と注意事項を確認して「検定を開始」
3. 設定された問題数に回答（単一選択／複数選択）
4. 結果画面でスコア・ランク・偏差値風スコア・レーダーチャートを確認
5. 「結果をコピー / CSV保存 / チャート画像保存 / メールで共有」が利用可能

> 回答欄に個人情報・顧客情報・社外秘・APIキー・パスワードを入力しないでください。これらはAIにも送信されません。

---

## 6. 管理者の使い方

管理画面（`admin.html`）は「**AI生成**」「**設問プール／組み立て**」の2タブ構成です。

### 6-1. AI生成タブ

1. トップ画面下部の「管理者モード」または `admin.html` を開く
2. `ADMIN_PASSWORD` でログイン（API未設定時はローカル確認モード）
3. **現在の設問セット**で Set ID・バージョン・更新日・出題数・合格ライン・在庫数を確認
4. **出題セットの保存・切替**（GitHub連携時）で `sets/` 内のセット一覧から使うものを選択
5. **出題設定**で出題数・難易度・合格ライン・生成バッチ数を調整
6. **カテゴリ別出題割合**で重み／優先度を調整
   - 合計が出題数と一致しない場合、優先度に基づき自動補正
   - 全カテゴリ0なら初期配分を使用
   - 在庫が出題数に足りない場合はアラートを表示し、受験をブロック
7. **設問生成指示**に変更指示を自然文で入力し「設問案を生成」（要 Vercel + LLMキー）
8. プレビューで内容を確認し「この内容を選択中の出題セットに保存」

> GitHub連携が有効なら直接コミットされます。未設定の場合は JSON がダウンロードされるので、`public/data/current-question-set.json` に上書きして GitHub へコミットしてください。

### 6-2. 設問プール／組み立てタブ（複数JSONから出題セットを作る）

AI生成は1回で完璧にならないことがあります。そこで「複数回生成したJSONをプールし、人が選んで組み立てる」モードを用意しています。

1. **JSONをアップロード**: AI生成などで作った設問セットJSONを複数選択またはドラッグ＆ドロップで読み込みます（ブラウザ内処理・サーバー送信なし）。形式は `{questions:[...]}`、設問の配列、`{questionSetDraft:{questions}}` のいずれも受け付けます。
2. **GitHubから読み込み**: GitHub連携が有効なら、`sets/` に保存済みのセットを直接読み込んで編集できます。
3. **自動分類と重複検出**: 全設問が1つのプールに統合され、カテゴリ別に表示されます。内容が近いものには「重複の可能性」バッジが付きます（自動除外はせず人が判断。「重複候補を一括解除」ボタンもあります）。
4. **選択と手入力編集**: 採用する設問にチェックを入れます。問題文・選択肢・正解・カテゴリ・難易度・解説をその場で編集でき、不要な設問は削除できます。
5. **メタ情報の編集**: Set ID（内部名）・バージョン・出題数・合格ライン・ランダム設定を手入力できます。
6. **出題数より多いセットも可**: 採用数が出題数より多い場合、自動で「**ランダム出題モード**」になり、検定では毎回ランダムに指定数だけ出題されます。
7. **書き出し**: 「current-question-set.json を書き出す」でダウンロード、または GitHub へ直接保存して本番反映します。

### 6-3. モデルが使えないとき —「使えるモデルを確認」ボタン

設問生成で「全プロバイダで失敗」になる主因は、**モデル名が古い／廃止された**ことです（無料モデルは頻繁に入れ替わります）。管理画面の「**使えるモデルを確認**」ボタン（`api/list-models.js`）を押すと、あなたのキーで実際に使える Gemini / OpenRouter / Ollama のモデル名が一覧表示され、さらに実リクエストを飛ばして 401（キー無効）/ 429（レート制限）/ 200（成功）を判別できます。表示された名前を Vercel の環境変数（`GEMINI_MODEL` / `OPENROUTER_MODEL` / `OLLAMA_MODEL`）に設定すれば確実です。

複数モデルをカンマ区切りで指定でき、順にフォールバックします。一時的な混雑（429 / 503）には自動でリトライ（指数バックオフ・最大2回）も入ります。

> **有料Geminiを使う場合（コスト重視）**: `LLM_PROVIDER_ORDER=gemini,openrouter,ollama`（既定）にし、`GEMINI_MODEL=gemini-2.5-flash-lite,gemini-2.5-flash` を設定。最安の Flash-Lite が優先され、混雑時のみ標準 Flash に自動降格します。設問生成1回（20問）はおおむね数円以内に収まります。

---

## 7. 設問データの構造

`public/data/` 配下のJSONは共通のスキーマを持ちます。

```jsonc
{
  "questionSetId": "ai-literacy-2026-06-sample",
  "version": "1.0.0",
  "locked": false,                  // true のセットは編集対象外
  "updatedAt": "2026-06-11T18:54:16.680Z",
  "settings": {
    "questionCount": 20,            // 実際に出題する数
    "passingScore": 70,
    "randomizeQuestions": true,     // 在庫 > 出題数 のときランダム抽出
    "randomizeChoices": true,
    "categoryDistributionMode": "weighted",
    "categoryDistribution": [ { "categoryId": "C-001", "weight": 3, "priority": 3 }, … ]
  },
  "categories": [ … ],
  "questions": [
    {
      "id": "Q-001",
      "category": "基本理解",
      "difficulty": "standard",
      "type": "single",             // single | multiple
      "question": "…",
      "choices": ["…", "…", "…", "…"],
      "answer": [0],                // 正解インデックスの配列
      "explanation": "…",
      "tags": ["…"]
    }
  ]
}
```

**同梱されている設問セット**

| ファイル | 設問数 | 用途 |
|---|---:|---|
| `current-question-set.json` | 在庫52問 / 出題20問 | 本番で読まれる現行セット |
| `sample-question-set.json` | 20問 | 初期サンプル（`locked: true`） |
| `sets/ai-literacy-it-engineer-2026-06-standard.json` | 100問 | ITエンジニア向け |
| `sets/ai-literacy-tax-office-2026-06-100.json` | 100問 | 税理士事務所向け |

`sets/` と `active-set.json` は管理画面のGitHub連携（`api/github-save.js`）が生成・更新します。対応アクションは `list` / `get` / `save` / `activate` / `save_current` です。

---

## 8. カテゴリと初期配分

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

> カテゴリ定義はフロント（`public/assets/js/categories.js`）とサーバー（`api/_lib.js` の `CATEGORY_DEFS`）の**両方に存在するため、変更時は必ず両方を揃えてください**。

---

## 9. セキュリティ設計

- LLMのAPIキー・管理者パスワード・GitHub PAT はフロントに含めず、Vercel 環境変数のみで管理。
- AIへ送るのはスコアとカテゴリ別傾向だけ。氏名・社員番号・メール・部署・顧客名などは送らない（フロントとサーバーの二重除去）。
- 管理者トークンは HMAC-SHA256 署名付き・有効期限1時間。
- 管理者パスワードの照合は `crypto.timingSafeEqual` によるタイミング攻撃対策済み。
- CORS は `SITE_URL`（GitHub Pages）と localhost からのアクセスのみ許可。

---

## 10. トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| AIコメントが定型文のまま | `config.js` の `apiBase` が空、または Vercel 未デプロイ。手順4を確認。 |
| ブラウザに CORS エラー | Vercel の `SITE_URL` が GitHub Pages のURLと不一致。スキーム込み・末尾スラッシュなしで設定。 |
| 管理者ログインで500 | `ADMIN_PASSWORD` / `ADMIN_TOKEN_SECRET` が未設定。Vercel環境変数を設定し再デプロイ。 |
| 設問生成が502（AI設問生成に失敗） | 全プロバイダで失敗。Vercelログの`detail`を確認。各キー・モデル名・残高、`LLM_PROVIDER_ORDER`を点検。「使えるモデルを確認」が最短。 |
| 「AI応答を解析できませんでした」 | モデルがJSON以外を返した。`openrouter/free` など structured output 対応モデルに変更。分割生成で1バッチを小さく保つと改善。 |
| 設問生成が途中で止まる/タイムアウト | 1バッチは数問なので通常は短時間で完了。特定バッチだけ失敗する場合は自動で1回再試行。繰り返す場合はプロバイダを変更。 |
| GitHubへの保存が失敗 | `GITHUB_TOKEN` / `GITHUB_OWNER` / `GITHUB_REPO` を確認。PATに対象リポジトリの Contents: Read and write が付与されているか。 |
| Ollamaだけ失敗（HTMLが返る） | Cloudflare Access に阻まれている。Service Token（`CF_ACCESS_CLIENT_ID/SECRET`）を設定し、対象アプリにService Authポリシーを追加。 |
| Geminiが429 | 無料枠のレート上限。少し待つか、`LLM_PROVIDER_ORDER`でOpenRouterを先に。 |
| レーダーチャートが出ない | Chart.js CDN への通信がブロックされていないか確認。 |
| 受験開始でブロックされる | 在庫の設問数が出題数に足りていない。管理画面で出題数を下げるか設問を追加。 |

---

## 11. MVP 完成条件（仕様書 §7）との対応

- ✅ PCとスマホで受験できる（レスポンシブ 599/1024px）
- ✅ 20問の初期設問で採点できる
- ✅ 指示の出し方3問・セキュリティ4問の初期配分
- ✅ 結果コピー / CSV保存 / レーダーチャート画像保存
- ✅ ブラウザ起点で結果メール共有（Web Share API + `mailto:` フォールバック）
- ✅ 管理者画面で設問生成指示・難易度・カテゴリ配分を設定
- ✅ LLMのAPIキーがフロントに露出していない

---

## 変更履歴

### ver 1.0.0（2026-06）
- 初期リリース版
- 受験フロー（トップ・回答・採点中ローディング・結果）
- AI設問生成（マルチLLM: Gemini / OpenRouter / Ollama、フォールバック対応）
- AI理解度コメント生成
- 管理者画面（出題数・合格ライン・カテゴリ配分の設定、手入力の出題数と在庫超過アラート）
- 設問プール／組み立て機能（ファイル・GitHubからの読み込み、ドラッグ＆ドロップ、カテゴリ集約、テキストエリア自動拡張）
- GitHubストレージ連携（複数セットの保存・一覧・切替、直接pushとダウンロードの両対応、保存先セット名の指定）
- 利用可能モデルの診断機能（`api/list-models.js`）
- 出題配分ロジック（重みは出題数ベースで按分、優先度は端数調整に使用）
- 出題数不足時の受験ブロックとアラート
- 結果画像の合成保存（スコア・レーダー・カテゴリ別横棒、JSTタイムスタンプ付きファイル名）
- 配色をインディゴ基調のライトテーマに、フォントを Sawarabi Gothic に統一
- トップ画面に出題セット名を表示、フッターに著作権表記・バージョン情報
- GitHub Actions による GitHub Pages 自動デプロイ

---

© 2026 SIKUMI LAB
