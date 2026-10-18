// Related files are published with one non-forced ref update.
// Reads use one immutable commit. Concurrent writes fail without overwriting.
export function requestError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export async function openGithubStore() {
  const { GITHUB_TOKEN: token, GITHUB_OWNER: owner, GITHUB_REPO: repo } = process.env;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !owner || !repo) throw requestError(503, 'GITHUB_NOT_CONFIGURED', 'GitHub連携が未設定です。');
  const base = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
  async function request(route, options = {}, optional = false) {
    const res = await fetch(base + route, {
      ...options,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (optional && res.status === 404) return null;
    if (!res.ok) {
      if (options.method === 'PATCH' && [409, 422].includes(res.status)) throw requestError(409, 'CONFLICT', '他の更新と競合しました。再読み込みして内容を確認してください。');
      throw requestError(502, 'GITHUB_ERROR', 'GitHubへの通信に失敗しました（HTTP ' + res.status + '）。');
    }
    return res.json();
  }
  const ref = await request('/git/ref/heads/' + encodeURIComponent(branch));
  const revision = ref.object.sha;
  const cache = new Map();
  async function text(path) {
    if (!cache.has(path)) {
      const data = await request('/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + revision, {}, true);
      cache.set(path, data ? Buffer.from(data.content || '', 'base64').toString('utf8') : null);
    }
    return cache.get(path);
  }
  return {
    revision,
    async json(path) {
      const value = await text(path);
      if (value == null) return null;
      try { return JSON.parse(value); } catch { throw requestError(409, 'INVALID_STORED_JSON', path + 'のJSONが壊れています。保存前に確認してください。'); }
    },
    async list(path) {
      const items = await request('/contents/' + path + '?ref=' + revision, {}, true);
      return Array.isArray(items) ? items.filter(x => x.type === 'file' && x.name.endsWith('.json')) : [];
    },
    async commit(changes, message, expectedRevision) {
      if (expectedRevision !== revision) throw requestError(409, 'CONFLICT', '読込後に別の更新がありました。再読み込みしてから保存してください。');
      const parent = await request('/git/commits/' + revision);
      const tree = Object.entries(changes).map(([path, value]) => value === null
        ? { path, mode: '100644', type: 'blob', sha: null }
        : { path, mode: '100644', type: 'blob', content: JSON.stringify(value, null, 2) + '\n' });
      const nextTree = await request('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: parent.tree.sha, tree }) });
      const nextCommit = await request('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: nextTree.sha, parents: [revision] }) });
      await request('/git/refs/heads/' + encodeURIComponent(branch), { method: 'PATCH', body: JSON.stringify({ sha: nextCommit.sha, force: false }) });
      return nextCommit.sha;
    },
  };
}
