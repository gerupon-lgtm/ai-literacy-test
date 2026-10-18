// Local integration check: real UI and API handlers, in-memory GitHub/AI only.
// Requires Playwright (or NODE_PATH pointing to an existing installation).
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium, webkit } = require('playwright');

(async () => {
  const root = process.cwd(), publicRoot = path.join(root, 'public');
  const evidence = path.join(root, '.verification'); fs.mkdirSync(evidence, { recursive: true });
  const { createGithubFixture, questionSet } = await import('../tests/github-fixture.js');
  const initial = {};
  for (const name of fs.readdirSync(path.join(publicRoot, 'data/sets'))) initial['public/data/sets/' + name] = fs.readFileSync(path.join(publicRoot, 'data/sets', name), 'utf8');
  for (const name of ['current-question-set.json', 'active-set.json']) initial['public/data/' + name] = fs.readFileSync(path.join(publicRoot, 'data', name), 'utf8');
  initial['public/data/sets/storage-A.json'] = questionSet('logical-A');
  const fixture = createGithubFixture(initial);
  process.env.ADMIN_TOKEN_SECRET = 'test-only-secret'; process.env.ADMIN_PASSWORD = 'test-pass';
  process.env.GITHUB_TOKEN = 'test-only-token'; process.env.GITHUB_OWNER = 'test-owner'; process.env.GITHUB_REPO = 'test-repo';
  process.env.GEMINI_API_KEY = 'test-only-key'; process.env.LLM_PROVIDER_ORDER = 'gemini'; process.env.GEMINI_MODEL = 'test-model';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (new URL(url).hostname === 'api.github.com') return fixture.fetch(url, options);
    if (new URL(url).hostname === 'generativelanguage.googleapis.com') {
      const body = JSON.parse(options.body);
      const text = body.generationConfig?.responseMimeType === 'text/plain' ? '理解できている点を維持し、迷った点は解説で確認しましょう。'
        : JSON.stringify({ questions: fixture.read('public/data/current-question-set.json').questions.slice(0, 1) });
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
    }
    throw new Error('Unexpected live connection: ' + new URL(url).origin);
  };
  const handlers = {};
  for (const name of ['admin-login', 'github-save', 'generate-questions', 'analyze-result']) handlers[name] = (await import('../api/' + name + '.js')).default;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        let raw = ''; for await (const chunk of req) raw += chunk;
        req.body = raw ? JSON.parse(raw) : {};
        res.status = n => { res.statusCode = n; return res; };
        res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
        return await handlers[url.pathname.slice(5)](req, res);
      }
      if (url.pathname === '/assets/js/config.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end('window.AILIT_CONFIG={apiBase:location.origin};'); }
      if (url.pathname === '/data/current-question-set.json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(fixture.read('public/data/current-question-set.json'))); }
      const file = path.resolve(publicRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown' })[path.extname(file)] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    } catch (err) { res.statusCode = 500; res.end(String(err)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browsers = []; const pageErrors = []; const checks = [];
  const upload = (page, name, value) => page.locator('#pool-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  try {
    const browser = await chromium.launch({ headless: true }); browsers.push(browser);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await context.route('https://fonts.**/*', route => route.abort());
    await context.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(evidence, 'chart.umd.min.js')) }));
    const page = await context.newPage(); page.on('pageerror', err => pageErrors.push(err.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(base); await page.locator('#btn-start').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#btn-start').disabled);
    assert.match(await page.locator('#brand-name').innerText(), /情報セキュリティ/);
    await page.locator('#btn-start').click();
    const realSet = fixture.read('public/data/current-question-set.json');
    for (let i = 0; i < 20; i++) {
      const text = await page.locator('#q-text').innerText(); const q = realSet.questions.find(q => q.question === text); assert(q);
      for (const answer of q.answer) await page.locator('#q-choices .ctext').getByText(q.choices[answer], { exact: true }).click();
      await page.locator('#btn-next').click();
    }
    await page.locator('#screen-result').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#r-score').innerText(), '100');
    await page.waitForFunction(() => typeof Chart !== 'undefined' && document.querySelector('#radar').width > 0);
    await page.screenshot({ path: path.join(evidence, 'desktop-result.png'), fullPage: true });
    const downloadPromise = page.waitForEvent('download'); await page.locator('#btn-png').click();
    const png = await downloadPromise; await png.saveAs(path.join(evidence, 'result.png'));
    assert(fs.readFileSync(path.join(evidence, 'result.png')).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    assert(await page.evaluate(() => {
      const chart = Chart.getChart(document.querySelector('#radar'));
      return Math.abs(chart.getDatasetMeta(0).data[0].y - chart.scales.r.yCenter) > 20;
    }), 'export must finish the animated radar before copying the canvas');
    checks.push('20-question quiz, correct shuffled answers, real Chart.js, PNG download');

    await page.goto(base + '/admin.html'); await page.locator('#admin-pass').fill('test-pass'); await page.locator('#btn-login').click();
    await page.locator('#sets-list [data-storage-id="storage-A"]').waitFor();
    assert.match(await page.locator('#sets-list [data-storage-id="storage-A"]').innerText(), /Set ID（JSON内）: logical-A/);
    await page.locator('#set-pass').fill('75'); await page.locator('#btn-save-settings').click();
    await page.waitForFunction(() => document.querySelector('#save-alert').textContent.includes('両方'));
    assert.equal(fixture.read('public/data/sets/it-security-2026-10.json').settings.passingScore, 75);
    const item = id => page.locator('#sets-list [data-storage-id="' + id + '"]');
    await item('storage-A').getByRole('button', { name: 'このセットを使う', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#d-setid').textContent === 'logical-A');
    await item('sample-question-set').getByRole('button', { name: '無効にする', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#sets-list [data-storage-id="sample-question-set"]').textContent.includes('状態: 無効'));
    assert.equal(await item('sample-question-set').getByRole('button', { name: 'このセットを使う', exact: true }).count(), 0);
    assert(await item('storage-A').getByRole('button', { name: '削除', exact: true }).isDisabled());
    await item('sample-question-set').getByRole('button', { name: '再有効化', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#sets-list [data-storage-id="sample-question-set"]').textContent.includes('状態: 有効'));
    await item('sample-question-set').getByRole('button', { name: '削除', exact: true }).click();
    await item('sample-question-set').waitFor({ state: 'detached' });
    checks.push('admin login, identity display, atomic save, switch, disable/enable/delete, active-set protection');

    await page.locator('#tab-btn-pool').click();
    await page.locator('#pool-gh-list [data-storage-id="storage-A"]').getByRole('button', { name: '読み込んで編集' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.pool-q').length === 1);
    const b = questionSet('B'); await upload(page, 'B.json', b);
    await page.waitForFunction(() => document.querySelectorAll('.pool-q').length === 2);
    const bCard = page.locator('.pool-q').filter({ has: page.getByText('取込元Set ID: B', { exact: true }) });
    await bCard.locator('.q-text').fill('Bの手編集を保持'); await bCard.locator('.sel').uncheck();
    const revised = questionSet('logical-A'); revised.version = '2.0.0'; revised.questions.push({ ...revised.questions[0], id: 'Q002', question: '新版の別問題' });
    await upload(page, 'renamed-A-v2.json', revised);
    await page.locator('#pool-import-dialog').waitFor(); await page.locator('[data-mode="replace"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.pool-q').length === 3);
    assert.equal(await bCard.locator('.q-text').inputValue(), 'Bの手編集を保持'); assert.equal(await bCard.locator('.sel').isChecked(), false);
    await upload(page, 'same-A-again.json', revised); await page.locator('#pool-import-dialog').waitFor(); await page.locator('[data-mode="add"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.pool-q').length === 5);
    await upload(page, 'cancel-A.json', revised); await page.locator('#pool-import-dialog').waitFor(); await page.locator('[data-mode="cancel"]').click();
    assert.equal(await page.locator('.pool-q').count(), 5);
    await upload(page, 'no-id.json', b.questions); await page.locator('#pool-import-dialog').waitFor();
    assert.match(await page.locator('#import-existing-id').innerText(), /logical-A/);
    await page.locator('#import-set-id').fill('manual-set'); await page.locator('[data-mode="add"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.pool-q').length === 6);
    assert.equal(await page.getByText('取込元Set ID: manual-set', { exact: true }).count(), 1);
    const bad = questionSet('bad'); bad.questions[0].answer = [];
    await upload(page, 'bad.json', bad); await page.waitForFunction(() => document.querySelector('#pool-upload-alert').textContent.includes('正解'));
    assert.equal(await page.locator('.pool-q').count(), 6);
    checks.push('replace/add/cancel by logical ID, preserve B edits/selection, missing-ID entry with repository IDs, reject invalid answers');

    await page.locator('#pool-gh-list [data-storage-id="storage-A"]').getByRole('button', { name: '読み込んで編集' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.pool-q').length === 1);
    await page.locator('.pool-q .q-text').fill('保存先IDとJSON内IDを維持');
    await page.locator('#btn-pool-gh-save').click();
    await page.waitForFunction(() => document.querySelector('#pool-output-alert').textContent.includes('push完了'));
    assert.equal(fixture.read('public/data/sets/storage-A.json').questionSetId, 'logical-A');
    assert.equal(fixture.read('public/data/current-question-set.json').questions[0].question, '保存先IDとJSON内IDを維持');
    await page.locator('#tab-btn-generate').click(); await page.locator('#btn-generate').click();
    await page.locator('#preview-panel').waitFor({ state: 'visible' }); assert.match(await page.locator('#gen-alert').innerText(), /完了/);
    checks.push('pool GitHub save preserves distinct IDs and synchronizes active public copy; custom-category generation UI');
    await page.screenshot({ path: path.join(evidence, 'desktop-admin.png'), fullPage: true });

    const mobileBrowser = await webkit.launch({ headless: true }); browsers.push(mobileBrowser);
    const mobile = await mobileBrowser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mobile.on('pageerror', err => pageErrors.push(err.message));
    await mobile.route('https://fonts.**/*', route => route.abort());
    await mobile.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(evidence, 'chart.umd.min.js')) }));
    await mobile.goto(base + '/admin.html'); await mobile.locator('#admin-pass').fill('test-pass'); await mobile.locator('#btn-login').click();
    await mobile.locator('#sets-list [data-storage-id="storage-A"]').waitFor();
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert(await mobile.locator('.set-info').first().evaluate(el => el.getBoundingClientRect().width > 240));
    await mobile.locator('#tab-btn-pool').click(); await upload(mobile, 'idless-mobile.json', b.questions);
    await mobile.locator('#pool-import-dialog').waitFor(); await mobile.locator('#import-set-id').fill('mobile-set');
    await mobile.screenshot({ path: path.join(evidence, 'mobile-import.png'), fullPage: true });
    await mobile.locator('[data-mode="add"]').click(); await mobile.waitForFunction(() => document.querySelectorAll('.pool-q').length === 1);
    checks.push('390px WebKit: no horizontal overflow, ID-less import dialog and touch-size controls');
    assert.deepEqual(pageErrors, []);
    fs.writeFileSync(path.join(evidence, 'browser-results.json'), JSON.stringify({ result: 'PASS', checks, pageErrors, githubCommitsInMemory: fixture.writes.length, productionMutations: 0 }, null, 2));
    console.log(JSON.stringify({ result: 'PASS', checks, pageErrors, productionMutations: 0 }, null, 2));
  } finally {
    for (const browser of browsers) await browser.close();
    globalThis.fetch = originalFetch; await new Promise(resolve => server.close(resolve));
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
