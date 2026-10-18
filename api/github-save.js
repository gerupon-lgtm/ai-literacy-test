import { applyCors, handlePreflight, readJsonBody, verifyAdminToken } from './_lib.js';
import { openGithubStore, requestError } from './_github-store.js';
import { questionSetErrors } from '../public/assets/js/question-set.js';

const SETS_DIR = 'public/data/sets';
const ACTIVE_PATH = 'public/data/active-set.json';
const CURRENT_PATH = 'public/data/current-question-set.json';
const STATUS_PATH = 'public/data/set-status.json';
const pathFor = id => SETS_DIR + '/' + id + '.json';

function storageId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw requestError(400, 'INVALID_ID', '保存先IDは半角英数字・ハイフン・アンダースコアの1〜64文字で指定してください。');
  return value;
}
function validSet(set) {
  const errors = questionSetErrors(set);
  if (errors.length) throw requestError(400, 'INVALID_SET', errors.join('\n'));
  return set;
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(res, req);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'POSTのみ対応しています。' });
  let body;
  try { body = await readJsonBody(req); } catch { return res.status(400).json({ ok: false, message: 'JSONを解析できません。' }); }
  if (!verifyAdminToken(body?.adminToken)) return res.status(401).json({ ok: false, message: '管理者トークンが無効です。再ログインしてください。' });
  try {
    const store = await openGithubStore();
    const active = await store.json(ACTIVE_PATH);
    const statuses = await store.json(STATUS_PATH) || { disabledSetIds: [] };
    if (!Array.isArray(statuses.disabledSetIds)) throw requestError(409, 'INVALID_STATUS', '無効セットの管理情報が不正です。');
    const activeSetId = active?.activeSetId || null;
    const disabled = new Set(statuses.disabledSetIds);
    const action = body.action;
    if (action === 'list') {
      const files = await store.list(SETS_DIR);
      const sets = [], warnings = [];
      for (const file of files) {
        const id = file.name.slice(0, -5);
        try {
          const set = await store.json(pathFor(id));
          sets.push({ id, fileName: file.name, questionSetId: typeof set?.questionSetId === 'string' ? set.questionSetId : '',
            title: set?.title || '', version: set?.version || '', questionCount: set?.settings?.questionCount || 0,
            poolSize: Array.isArray(set?.questions) ? set.questions.length : 0, updatedAt: set?.updatedAt || '', enabled: !disabled.has(id) });
        } catch (err) { if (err.code !== 'INVALID_STORED_JSON') throw err; warnings.push(file.name + ': JSONを読み込めません。'); }
      }
      return res.status(200).json({ ok: true, sets, activeSetId, revision: store.revision, currentQuestionSet: await store.json(CURRENT_PATH), warnings });
    }
    if (action === 'get') {
      const id = storageId(body.setId); const set = await store.json(pathFor(id));
      if (!set) throw requestError(404, 'NOT_FOUND', '出題セットが見つかりません。');
      return res.status(200).json({ ok: true, setId: id, questionSet: set, revision: store.revision, enabled: !disabled.has(id) });
    }
    if (!['save', 'save_current', 'activate', 'delete', 'set_enabled'].includes(action)) throw requestError(400, 'INVALID_ACTION', '未対応の操作です。');
    if (body.expectedRevision !== store.revision) throw requestError(409, 'CONFLICT', '読込後に別の更新がありました。再読み込みして内容を確認してください。');
    const changes = {};
    const id = action === 'save_current' ? activeSetId : storageId(body.setId);
    if (action === 'save_current') {
      if (!id || body.expectedActiveSetId !== activeSetId) throw requestError(409, 'ACTIVE_CHANGED', '使用中セットが変わりました。一覧を再読み込みしてください。');
      storageId(id);
    }
    const existing = await store.json(pathFor(id));
    if (action !== 'save' && !existing) throw requestError(404, 'NOT_FOUND', '出題セットが見つかりません。');
    let questionSet;
    if (action === 'save' || action === 'save_current') {
      questionSet = validSet(body.questionSet);
      if (action === 'save_current' && questionSet.questionSetId !== existing.questionSetId) throw requestError(409, 'IDENTITY_CHANGED', '使用中セットのSet IDは変更できません。別セットとして保存してください。');
      changes[pathFor(id)] = questionSet;
      if (id === activeSetId) changes[CURRENT_PATH] = questionSet;
    } else if (action === 'activate') {
      if (disabled.has(id)) throw requestError(409, 'SET_DISABLED', '無効なセットです。再有効化してから切り替えてください。');
      questionSet = validSet(existing);
      changes[ACTIVE_PATH] = { activeSetId: id, updatedAt: new Date().toISOString() };
      changes[CURRENT_PATH] = questionSet;
    } else {
      if (id === activeSetId) throw requestError(409, 'ACTIVE_SET', '使用中のセットです。別セットへ切り替えてから操作してください。');
      if (action === 'delete') { changes[pathFor(id)] = null; disabled.delete(id); }
      else {
        if (typeof body.enabled !== 'boolean') throw requestError(400, 'INVALID_STATUS', '有効・無効の指定が不正です。');
        if (body.enabled) disabled.delete(id); else disabled.add(id);
      }
      changes[STATUS_PATH] = { disabledSetIds: [...disabled].sort(), updatedAt: new Date().toISOString() };
    }
    const revision = await store.commit(changes, action + ': ' + id, body.expectedRevision);
    return res.status(200).json({ ok: true, setId: id, activeSetId: action === 'activate' ? id : activeSetId, revision, questionSet });
  } catch (err) {
    console.error('github-save:', err.code || err.name);
    return res.status(err.status || 502).json({ ok: false, code: err.code || 'GITHUB_ERROR', message: err.status ? err.message : 'GitHubへの保存・取得に失敗しました。再読み込みして状態を確認してください。' });
  }
}
