export function createSetItem(set, activeSetId) {
  const item = document.createElement('div');
  item.className = 'set-item' + (set.id === activeSetId ? ' active' : '') + (set.enabled === false ? ' disabled-set' : '');
  item.dataset.storageId = set.id;
  const info = document.createElement('div'); info.className = 'set-info';
  const line = (label, value, className = 'set-meta') => {
    const el = document.createElement('div'); el.className = className; el.textContent = label + value; info.appendChild(el);
  };
  line('', set.title || set.questionSetId || '名称未設定', 'set-name');
  line('Set ID（JSON内）: ', set.questionSetId || '未設定', 'set-json-id');
  line('保存先ID: ', set.id);
  line('保存ファイル: ', 'public/data/sets/' + set.fileName);
  line('', 'ver ' + (set.version || '—') + ' ／ 出題' + set.questionCount + '問 ／ 在庫' + set.poolSize + '問');
  line('状態: ', set.id === activeSetId ? '使用中' : set.enabled === false ? '無効' : '有効');
  const actions = document.createElement('div'); actions.className = 'set-actions';
  item.append(info, actions);
  if (set.questionSetId) addSetButton(actions, 'Set IDをコピー', async button => {
    try { await navigator.clipboard.writeText(set.questionSetId); button.textContent = 'コピーしました'; }
    catch { window.prompt('Set IDをコピーしてください。', set.questionSetId); }
  });
  return { item, actions };
}

export function addSetButton(container, label, handler, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'btn btn-ghost'; button.textContent = label; button.disabled = disabled;
  button.addEventListener('click', () => handler(button)); container.appendChild(button); return button;
}
