/**
 * たべたもの記録 → Googleスプレッドシート連携
 * 使い方は README.md を見てください。
 * 合言葉は「プロジェクトの設定」→「スクリプト プロパティ」に TOKEN という名前で入れてください
 * （アプリの設定にも同じものを入れます）。コードには書きません。
 */
function token_() {
  return PropertiesService.getScriptProperties().getProperty('TOKEN');
}

function sheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 記録IDが入っている行番号（なければ0）
function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 7, last - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === String(id)) return i + 2;
  }
  return 0;
}

// 写真はドライブの「たべたもの記録の写真」フォルダに、ファイル名の末尾を記録IDにして保存する
function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) {}
  }
  const f = DriveApp.createFolder('たべたもの記録の写真');
  props.setProperty('PHOTO_FOLDER', f.getId());
  return f;
}

function findPhoto_(id) {
  if (!/^[0-9a-z]+$/i.test(String(id))) return null;
  const it = photoFolder_().searchFiles(`title contains '${id}' and trashed = false`);
  return it.hasNext() ? it.next() : null;
}

// 初回だけ、Apps Scriptの画面でこの関数を選んで「実行」し、ドライブへのアクセスを許可する
function authorize() {
  photoFolder_();
}

// A列で最後に値が入っている行の次
function nextRow_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return 2;
  const col = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (let i = col.length - 1; i >= 0; i--) {
    if (col[i][0] !== '') return i + 3;
  }
  return 2;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    const token = token_();
    if (!token) return out_({ ok: false, error: 'スクリプト プロパティに TOKEN（合言葉）が入っていません' });
    if (req.token !== token) return out_({ ok: false, error: 'unauthorized' });
    const sh = sheet_();

    if (req.action === 'ping') {
      let drive = true;
      try { photoFolder_(); } catch (err) { drive = false; }
      return out_({ ok: true, sheet: sh.getName(), drive: drive });
    }

    if (req.action === 'list') {
      const last = sh.getLastRow();
      const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, 7).getDisplayValues()
        .filter(r => r[6] !== '');
      return out_({ ok: true, rows: rows });
    }

    const r = findRow_(sh, req.id);

    if (req.action === 'delete') {
      if (r) sh.deleteRow(r);
      const p = findPhoto_(req.id);
      if (p) p.setTrashed(true);
      return out_({ ok: true });
    }

    if (req.action === 'photo_put') {
      const old = findPhoto_(req.id);
      if (old && req.ifMissing) return out_({ ok: true, skipped: true });
      if (old) old.setTrashed(true);
      const name = String(req.name || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 80) + ' ' + req.id + '.jpg';
      photoFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(req.data), 'image/jpeg', name));
      return out_({ ok: true });
    }

    if (req.action === 'photo_get') {
      const p = findPhoto_(req.id);
      return out_({ ok: true, data: p ? Utilities.base64Encode(p.getBlob().getBytes()) : null });
    }

    if (req.action === 'upsert') {
      const row = req.row;
      const target = r || nextRow_(sh);
      sh.getRange(target, 7).setNumberFormat('@');
      sh.getRange(target, 1, 1, 7).setValues([row]);
      return out_({ ok: true, row: target });
    }

    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
