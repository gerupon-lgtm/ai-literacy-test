// GitHub's public HTTP boundary, backed by a small in-memory repository.
export function createGithubFixture(initialFiles) {
  let sequence = 1;
  const id = () => (++sequence).toString(16).padStart(40, '0');
  let head = '1'.padStart(40, '0');
  let files = new Map(Object.entries(initialFiles).map(([p, v]) => [p, typeof v === 'string' ? v : JSON.stringify(v)]));
  const commits = new Map([[head, { files: new Map(files), tree: 'initial-tree' }]]);
  const trees = new Map([['initial-tree', new Map(files)]]);
  const writes = [];
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fixture = {
    writes,
    get head() { return head; },
    read(p) { const value = files.get(p); return value == null ? null : JSON.parse(value); },
    has(p) { return files.has(p); },
    advance() { const next = id(); commits.set(next, { files: new Map(files), tree: commits.get(head).tree }); head = next; },
    beforeUpdate: null,
    async fetch(input, options = {}) {
      const url = new URL(input);
      if (url.origin !== 'https://api.github.com') throw new Error('Unexpected external call: ' + url.origin);
      const route = decodeURIComponent(url.pathname).replace(/^\/repos\/[^/]+\/[^/]+/, '');
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      if (method === 'GET' && route.startsWith('/git/ref/heads/')) return json({ object: { sha: head } });
      if (method === 'GET' && route.startsWith('/git/commits/')) {
        const commit = commits.get(route.split('/').pop());
        return commit ? json({ tree: { sha: commit.tree } }) : json({}, 404);
      }
      if (method === 'GET' && route.startsWith('/contents/')) {
        const p = route.slice('/contents/'.length);
        const snapshot = commits.get(url.searchParams.get('ref'))?.files || files;
        if (snapshot.has(p)) return json({ sha: 'file-sha', content: Buffer.from(snapshot.get(p)).toString('base64') });
        const children = [...snapshot.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'));
        return children.length ? json(children.map(k => ({ name: k.split('/').pop(), type: 'file' }))) : json({}, 404);
      }
      if (method === 'POST' && route === '/git/trees') {
        const next = new Map(trees.get(body.base_tree));
        for (const entry of body.tree) {
          if (entry.sha === null) next.delete(entry.path); else next.set(entry.path, entry.content);
        }
        const sha = id(); trees.set(sha, next); return json({ sha });
      }
      if (method === 'POST' && route === '/git/commits') {
        const sha = id(); commits.set(sha, { files: new Map(trees.get(body.tree)), tree: body.tree, parent: body.parents[0] });
        return json({ sha });
      }
      if (method === 'PATCH' && route.startsWith('/git/refs/heads/')) {
        if (fixture.beforeUpdate) { const callback = fixture.beforeUpdate; fixture.beforeUpdate = null; callback(); }
        const next = commits.get(body.sha);
        if (body.force || next?.parent !== head) return json({ message: 'Update is not a fast forward' }, 422);
        head = body.sha; files = new Map(next.files); writes.push({ head, paths: [...files.keys()] });
        return json({ object: { sha: head } });
      }
      // Compatibility with the previous implementation, so regressions fail on behavior.
      if (method === 'PUT' && route.startsWith('/contents/')) {
        const p = route.slice('/contents/'.length); files.set(p, Buffer.from(body.content, 'base64').toString());
        writes.push({ path: p }); return json({});
      }
      throw new Error('Unexpected GitHub request: ' + method + ' ' + route);
    },
  };
  return fixture;
}

export function questionSet(id = 'logical-A') {
  return {
    questionSetId: id, version: '1.0.0', title: '確認用検定', theme: '情報セキュリティ',
    settings: { questionCount: 1, passingScore: 70, categoryDistribution: [{ categoryId: 'X-001', weight: 1, priority: 1 }] },
    categories: [{ id: 'X-001', name: '確認' }],
    questions: [{ id: 'Q001', category: '確認', difficulty: 'basic', type: 'single', question: '確認しますか。', choices: ['確認する', 'しない'], answer: [0], explanation: '確認します。', tags: [] }],
  };
}
