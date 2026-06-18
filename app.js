<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>管理者モード｜AIリテラシー検定</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sawarabi+Gothic&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
  <div class="app-shell">
    <header class="app-header">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/><path d="M12 12l3-2.5"/>
        </svg>
      </span>
      <span class="brand-text">
        <span class="name">AIリテラシー検定</span>
        <span class="sub">Admin Console</span>
      </span>
      <button id="btn-logout-header" class="btn btn-ghost btn-header-logout hidden" type="button">ログアウト</button>
    </header>

    <main id="main">
      <!-- S-004 ログイン -->
      <section id="admin-login" class="screen">
        <div class="panel">
          <p class="eyebrow">Administrator</p>
          <h1 style="font-size:1.5rem;margin-bottom:8px">管理者ログイン</h1>
          <p class="muted" style="margin-bottom:20px;font-size:.9rem">
            設問の生成指示、難易度、カテゴリ配分を設定します。パスワードはサーバー側で照合されます。
          </p>
          <div id="login-alert"></div>
          <div class="field">
            <label for="admin-pass">管理者パスワード</label>
            <input id="admin-pass" class="input" type="password" autocomplete="current-password" placeholder="••••••••">
          </div>
          <div class="btn-row">
            <button id="btn-login" class="btn btn-primary" type="button">ログイン</button>
            <a class="btn btn-ghost" href="index.html">検定トップへ</a>
          </div>
          <div class="alert alert-info" style="margin-top:18px">
            APIを未設定（<code>config.js</code> の <code>apiBase</code> が空）の場合は、ローカル確認用モードで動作します。
            設問生成は実行されず、配分計算とJSON出力のみ利用できます。
          </div>
        </div>
      </section>

      <!-- S-005 ダッシュボード -->
      <section id="admin-dash" class="screen hidden">
        <!-- タブナビ -->
        <div class="tab-nav" role="tablist">
          <button id="tab-btn-generate" class="tab-btn active" role="tab" type="button">AI生成</button>
          <button id="tab-btn-pool" class="tab-btn" role="tab" type="button">設問プール／組み立て</button>
        </div>

        <!-- ===== AI生成タブ ===== -->
        <div id="tab-generate" class="tab-panel">
        <!-- 現在の設問セット -->
        <div class="panel">
          <h2 class="section-title">現在の設問セット</h2>
          <div class="stat-strip" style="grid-template-columns:repeat(2,1fr)">
            <div class="cell"><div class="k">Set ID</div><div class="v" id="d-setid" style="font-size:.9rem;word-break:break-all">—</div></div>
            <div class="cell"><div class="k">Version</div><div class="v" id="d-version" style="font-size:1.1rem">—</div></div>
          </div>
          <table class="cat-table" style="margin-top:14px">
            <tbody>
              <tr><th scope="row">更新日</th><td id="d-updated" class="num">—</td></tr>
              <tr><th scope="row">出題数</th><td id="d-count" class="num">—</td></tr>
              <tr><th scope="row">合格ライン</th><td id="d-pass" class="num">—</td></tr>
              <tr><th scope="row">設問数(在庫)</th><td id="d-stock" class="num">—</td></tr>
            </tbody>
          </table>
        </div>

        <!-- 複数セットの保持・切替（GitHub連携） -->
        <div class="panel">
          <h2 class="section-title">出題セットの保存・切替</h2>
          <p class="muted" style="font-size:.86rem;margin-bottom:12px">
            複数の出題セットをGitHubに保存し、検定で使うものを切り替えます。
            切り替えた内容は、次に別のセットを選ぶまで保持されます。
          </p>
          <div id="github-status"></div>
          <div id="sets-list" class="sets-list"></div>
          <div class="btn-row" style="margin-top:12px">
            <button id="btn-refresh-sets" class="btn btn-ghost" type="button">一覧を更新</button>
          </div>
          <div id="sets-alert"></div>
        </div>

        <!-- 基本設定 -->
        <div class="panel">
          <h2 class="section-title">出題設定</h2>
          <div class="field">
            <label for="set-count">出題数</label>
            <input id="set-count" class="input" type="number" min="1" max="200" step="1" value="20">
            <p class="muted" style="font-size:.8rem;margin-top:4px">
              在庫（設問プールの問題数）を超える数は設定できません。
            </p>
            <div id="set-count-alert"></div>
          </div>
          <div class="field">
            <label for="set-difficulty">難易度</label>
            <select id="set-difficulty" class="select">
              <option value="basic">basic（初級）</option>
              <option value="standard" selected>standard（標準）</option>
              <option value="advanced">advanced（上級）</option>
            </select>
          </div>
          <div class="field">
            <label for="set-pass">合格ライン（%）</label>
            <input id="set-pass" class="input" type="number" min="0" max="100" value="70">
          </div>
          <div class="field">
            <label for="set-batch">分割生成のバッチサイズ（1回あたりの問題数）</label>
            <input id="set-batch" class="input" type="number" min="1" max="10" value="5">
            <div class="hint">小さいほど安定（1回が短い）。OpenRouter無料モデルは429が出やすいので 8〜10 を推奨。Gemini等は 5 でも快適。</div>
          </div>
        </div>

        <!-- S-007 カテゴリ配分 -->
        <div class="panel">
          <h2 class="section-title">カテゴリ別出題割合</h2>
          <p class="muted" style="font-size:.84rem;margin-bottom:12px">
            重み（weight）と優先度（priority）を設定します。優先度は数値が小さいほど優先。
            合計が出題数と一致しない場合は、優先度に基づいて自動補正されます。
          </p>
          <table class="dist-table">
            <thead>
              <tr><th>カテゴリ</th><th>重み</th><th>優先度</th><th>配分</th></tr>
            </thead>
            <tbody id="dist-body"></tbody>
            <tfoot>
              <tr>
                <th>合計</th>
                <td id="dist-weight-sum" class="dist-preview">—</td>
                <td></td>
                <td id="dist-count-sum" class="dist-preview">—</td>
              </tr>
            </tfoot>
          </table>
          <div id="dist-alert"></div>
          <div class="btn-row" style="margin-top:12px">
            <button id="btn-recalc" class="btn btn-ghost" type="button">配分を再計算</button>
            <button id="btn-reset-dist" class="btn btn-ghost" type="button">初期配分に戻す</button>
          </div>
          <div class="alert alert-info" style="margin-top:14px">
            出題数・合格ライン・カテゴリ配分の変更は、下のボタンで選択中の出題セットに反映され、
            書き出してGitHubにコミットすると本番に反映されます。
            <span class="muted">（AI生成をせず、配分だけ変えたいときもこちら）</span>
          </div>
          <div id="save-alert"></div>
          <div class="btn-row">
            <button id="btn-save-settings" class="btn btn-primary" type="button">設定を反映して 選択中の出題セットファイルを書き出す</button>
          </div>
        </div>

        <!-- 変更指示 → 生成 -->
        <div class="panel">
          <h2 class="section-title">設問生成指示</h2>
          <div class="field">
            <label for="instruction">変更指示（自然文）</label>
            <textarea id="instruction" class="textarea" maxlength="600"
              placeholder="例）セキュリティと情報管理を多めに、初心者向けに20問作成してください。最新トレンドはAIエージェントの権限管理を含めてください。"></textarea>
            <div class="hint"><span id="instr-count">0</span> / 600 文字　／　空欄のままでも、上の例のような標準的な指示で生成します。</div>
          </div>
          <div id="gen-alert"></div>
          <div class="btn-row">
            <button id="btn-generate" class="btn btn-primary" type="button">設問案を生成</button>
            <button id="btn-diagnose" class="btn btn-ghost" type="button">使えるモデルを確認</button>
          </div>
          <div id="diag-result"></div>
        </div>

        <!-- S-006 プレビュー -->
        <div class="panel hidden" id="preview-panel">
          <h2 class="section-title">生成された設問案</h2>
          <div class="alert alert-warn">
            これはAIによる生成案です。内容・正解・解説を必ずレビューしてから採用してください。
          </div>
          <div id="preview-meta" class="muted" style="font-size:.84rem;margin-bottom:12px"></div>
          <div id="preview-questions"></div>
          <div id="adopt-alert"></div>
          <div class="btn-row" style="margin-top:16px">
            <button id="btn-adopt" class="btn btn-primary" type="button">この内容を選択中の出題セットに保存</button>
            <button id="btn-discard" class="btn btn-ghost" type="button">破棄</button>
          </div>
          <div class="alert alert-info" style="margin-top:14px">
            GitHub連携が設定済みなら、ボタンを押すと選択中の出題セットに直接保存され、数十秒後に検定へ反映されます。
            未設定の場合はJSONがダウンロードされるので、<code>public/data/current-question-set.json</code> に上書きコミットしてください。
          </div>
        </div>
        </div><!-- /tab-generate -->

        <!-- ===== 設問プール／組み立てタブ ===== -->
        <div id="tab-pool" class="tab-panel hidden">
          <div class="panel">
            <h2 class="section-title">JSONをアップロード</h2>
            <p class="muted" style="font-size:.86rem;margin-bottom:12px">
              AI生成などで作成した設問セットJSON（複数可）を読み込み、1つのプールに統合します。
              ファイルはサーバーに送信されず、ブラウザ内だけで処理されます。
            </p>
            <div id="pool-dropzone" class="dropzone">
              <input id="pool-file" class="input" type="file" accept="application/json,.json" multiple hidden>
              <div class="dropzone-inner">
                <div class="dropzone-icon" aria-hidden="true">⬆</div>
                <div>ここにJSONファイルをドラッグ＆ドロップ</div>
                <div class="muted" style="font-size:.82rem;margin-top:4px">または <button id="pool-browse" class="link-btn" type="button">ファイルを選択</button>（複数可）</div>
              </div>
            </div>
            <div id="pool-upload-alert" style="margin-top:10px"></div>
            <div class="btn-row" style="margin-top:10px">
              <button id="btn-pool-clear" class="btn btn-ghost" type="button">プールを空にする</button>
            </div>
          </div>

          <!-- GitHubから既存セットを読み込む -->
          <div class="panel">
            <h2 class="section-title">GitHubの出題セットを読み込んで編集</h2>
            <p class="muted" style="font-size:.86rem;margin-bottom:12px">
              GitHubに保存済みの出題セットを読み込んで編集できます。保存時は同じセットに上書きします。
            </p>
            <div id="pool-gh-status"></div>
            <div id="pool-gh-list" class="sets-list"></div>
            <div class="btn-row" style="margin-top:12px">
              <button id="btn-pool-gh-refresh" class="btn btn-ghost" type="button">GitHubのセット一覧を更新</button>
            </div>
            <div id="pool-gh-alert"></div>
          </div>

          <!-- メタ情報編集 -->
          <div class="panel hidden" id="pool-meta-panel">
            <h2 class="section-title">出題セットの情報（手入力で修正可）</h2>
            <div class="field">
              <label for="pool-setid">Set ID（内部名）</label>
              <input id="pool-setid" class="input" type="text" placeholder="ai-literacy-2026-06-custom">
            </div>
            <div class="field">
              <label for="pool-version">バージョン</label>
              <input id="pool-version" class="input" type="text" placeholder="1.0.0">
            </div>
            <div class="grid-2">
              <div class="field">
                <label for="pool-count">検定での出題数</label>
                <input id="pool-count" class="input" type="number" min="1" max="100" value="20">
              </div>
              <div class="field">
                <label for="pool-pass">合格ライン（%）</label>
                <input id="pool-pass" class="input" type="number" min="0" max="100" value="70">
              </div>
            </div>
            <div class="field">
              <label class="check-line">
                <input id="pool-randomize-q" type="checkbox"> 問題の出題順をランダムにする
              </label>
              <label class="check-line">
                <input id="pool-randomize-c" type="checkbox" checked> 選択肢の順番をランダムにする
              </label>
            </div>
            <div id="pool-count-note" class="alert alert-info" style="font-size:.84rem"></div>
          </div>

          <!-- 統計 -->
          <div class="panel hidden" id="pool-stats-panel">
            <h2 class="section-title">プールの状況</h2>
            <div id="pool-stats"></div>
          </div>

          <!-- カテゴリ別の設問一覧 -->
          <div class="panel hidden" id="pool-list-panel">
            <h2 class="section-title">設問を選択・編集</h2>
            <div class="alert alert-info" style="font-size:.84rem">
              採用する設問にチェックを入れてください。各項目は直接編集できます。
              <span class="dup-badge">重複の可能性</span> のマークは既存の採用済み設問と内容が近いことを示します（参考。除外は手動）。
            </div>
            <div class="btn-row" style="margin:10px 0">
              <button id="btn-pool-all" class="btn btn-ghost" type="button">すべて選択</button>
              <button id="btn-pool-none" class="btn btn-ghost" type="button">すべて解除</button>
              <button id="btn-pool-dedup" class="btn btn-ghost" type="button">重複候補を一括解除</button>
            </div>
            <div id="pool-list"></div>
          </div>

          <!-- 出力 -->
          <div class="panel hidden" id="pool-output-panel">
            <h2 class="section-title">出題セットを書き出し</h2>
            <div id="pool-output-summary" class="muted" style="font-size:.86rem;margin-bottom:12px"></div>
            <div id="pool-source-note" class="alert alert-info" style="font-size:.84rem;display:none"></div>

            <div class="field" id="pool-save-name-field">
              <label for="pool-save-name">GitHub保存先のセット名（ファイル名）</label>
              <input id="pool-save-name" class="input" type="text" placeholder="例: ai-literacy-2026-06-custom">
              <p class="muted" style="font-size:.8rem;margin-top:4px">
                英数字・ハイフン・アンダースコアが使えます。<code>sets/&lt;この名前&gt;.json</code> として保存されます。
                同名のセットがあれば上書きされます。
              </p>
            </div>

            <div id="pool-output-alert"></div>
            <div class="btn-row">
              <button id="btn-pool-gh-save" class="btn btn-primary" type="button">この名前でGitHubに保存（push）</button>
              <button id="btn-pool-export" class="btn btn-ghost" type="button">JSONをダウンロード</button>
            </div>
            <div class="alert alert-info" style="margin-top:14px">
              <b>GitHubに保存</b>すると <code>public/data/sets/</code> に直接pushされます（保存のみ。検定で使うには「出題セットの保存・切替」で切り替えてください）。
              <br><b>ダウンロード</b>はJSONファイルとして手元に保存します。
            </div>
          </div>
        </div><!-- /tab-pool -->
      </section>
    </main>

    <footer class="app-footer">
      <p>管理者操作ログは保存されません。設問の本番反映はGitHubへのコミットで行われます。</p>
    </footer>
  </div>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <script src="assets/js/config.js"></script>
  <script type="module" src="assets/js/admin.js"></script>
</body>
</html>
