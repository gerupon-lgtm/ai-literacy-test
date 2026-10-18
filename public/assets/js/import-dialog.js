import { setIdError } from './question-set.js?v=1.2.0';

// Every decision is made before mutating the pool. Escape, Cancel and closing are no-ops.
export function chooseImport({ fileName, setId, count, getExistingCount, sets }) {
  if (setId && getExistingCount(setId) === 0) return Promise.resolve({ setId, mode: 'add' });
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'import-dialog'; dialog.id = 'pool-import-dialog';
    dialog.innerHTML = '<form method="dialog"><h2>JSONの取り込み</h2><p class="import-file"></p>'
      + '<label for="import-set-id">Set ID（JSON内の識別名）</label><input id="import-set-id" class="input" maxlength="64" required>'
      + '<div class="existing-id-picker"><label for="import-existing-id">保存済みSet IDを参照</label><select id="import-existing-id" class="select"><option value="">選択して入力欄へ反映</option></select></div>'
      + '<p class="import-summary" aria-live="polite"></p><p class="import-error" role="alert"></p><div class="btn-row">'
      + '<button type="button" class="btn btn-primary" data-mode="add">追加する</button>'
      + '<button type="button" class="btn btn-primary" data-mode="replace">同じセットだけ置き換える</button>'
      + '<button type="button" class="btn btn-ghost" data-mode="cancel">キャンセル</button></div></form>';
    dialog.querySelector('.import-file').textContent = fileName + ' ／ 読込 ' + count + '問';
    const input = dialog.querySelector('#import-set-id'); input.value = setId || ''; input.readOnly = !!setId;
    const select = dialog.querySelector('#import-existing-id');
    for (const set of sets.filter(s => s.questionSetId)) {
      const option = document.createElement('option'); option.value = set.questionSetId;
      option.textContent = set.questionSetId + ' ／ 保存先: ' + set.id + (set.enabled === false ? '（無効）' : ''); select.appendChild(option);
    }
    dialog.querySelector('.existing-id-picker').hidden = !!setId;
    select.addEventListener('change', () => { if (select.value) { input.value = select.value; update(); } });
    const update = () => {
      const existing = getExistingCount(input.value);
      dialog.querySelector('[data-mode="replace"]').hidden = !existing;
      dialog.querySelector('[data-mode="add"]').textContent = existing ? '追加する' : 'このSet IDで取り込む';
      dialog.querySelector('.import-summary').textContent = existing
        ? '同じSet IDが編集中のプールに' + existing + '問あります。置き換えるとこのセット由来の編集内容を含む' + existing + '問を、新しい' + count + '問へ入れ替えます。他のセットは残します。'
        : 'Set IDを指定して取り込みます。GitHub上の保存データは、保存操作まで変更しません。';
    };
    input.addEventListener('input', update);
    let result = null;
    dialog.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
      const mode = button.dataset.mode;
      if (mode !== 'cancel') {
        const error = setIdError(input.value);
        if (error) { dialog.querySelector('.import-error').textContent = error; input.focus(); return; }
        result = { setId: input.value, mode };
      }
      dialog.close();
    }));
    dialog.querySelector('form').addEventListener('submit', event => event.preventDefault());
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result); }, { once: true });
    document.body.appendChild(dialog); update(); dialog.showModal(); input.focus();
  });
}
