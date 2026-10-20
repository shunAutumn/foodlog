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

// 写真はドライブの「たべたもの記録の写真」フォルダに、ファイル名の末尾を記録IDにして保存する。
// DriveApp はドライブ全体の権限を求めるので、このスクリプトが作ったファイルだけを扱える
// Drive API（拡張サービス、drive.file 権限）を使う。
function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER');
  if (id) {
    try {
      if (!Drive.Files.get(id, { fields: 'trashed' }).trashed) return id;
    } catch (err) {}
  }
  const f = Drive.Files.create({ name: 'たべたもの記録の写真', mimeType: 'application/vnd.google-apps.folder' });
  props.setProperty('PHOTO_FOLDER', f.id);
  return f.id;
}

// 見つかればファイルID、なければ null
function findPhoto_(id) {
  if (!/^[0-9a-z]+$/i.test(String(id))) return null;
  const res = Drive.Files.list({
    q: `'${photoFolder_()}' in parents and name contains '${id}' and trashed = false`,
    fields: 'files(id)', pageSize: 1
  });
  return res.files && res.files.length ? res.files[0].id : null;
}

function trashPhoto_(fileId) {
  Drive.Files.update({ trashed: true }, fileId);
}

function photoBytes_(fileId) {
  return UrlFetchApp.fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  }).getContent();
}

// 初回だけ、Apps Scriptの画面でこの関数を選んで「実行」し、ドライブへのアクセスを許可する
function authorize() {
  photoFolder_();
}

// 体重は「体重」シート（A日付 yyyy-MM-dd、B体重kg）。なければ最後に作る（1枚目のシートの位置は変えない）
function weightSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ws = ss.getSheetByName('体重');
  if (!ws) {
    ws = ss.insertSheet('体重', ss.getSheets().length);
    ws.getRange(1, 1, 1, 2).setValues([['日付', '体重(kg)']]);
    ws.getRange('A:A').setNumberFormat('@');
  }
  return ws;
}

function findWeightRow_(ws, date) {
  const last = ws.getLastRow();
  if (last < 2) return 0;
  const ds = ws.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (let i = 0; i < ds.length; i++) if (ds[i][0] === String(date)) return i + 2;
  return 0;
}

// 筋トレは「筋トレ」シートに1セット1行（A日付 B時刻 C種目 Dセット E重量kg F回数 G記録ID H メモ）
function gymSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let gs = ss.getSheetByName('筋トレ');
  if (!gs) {
    gs = ss.insertSheet('筋トレ', ss.getSheets().length);
    gs.getRange(1, 1, 1, 8).setValues([['日付', '時刻', '種目', 'セット', '重量(kg)', '回数', '記録ID', 'メモ']]);
    gs.getRange('G:G').setNumberFormat('@');
  }
  return gs;
}

// 記録IDの行をまとめて消す（下から）
function deleteGymRows_(gs, id) {
  const last = gs.getLastRow();
  if (last < 2) return;
  const ids = gs.getRange(2, 7, last - 1, 1).getDisplayValues();
  for (let i = ids.length - 1; i >= 0; i--) if (ids[i][0] === String(id)) gs.deleteRow(i + 2);
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

    if (req.action === 'weight_upsert') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.date))) return out_({ ok: false, error: 'bad date' });
      const ws = weightSheet_();
      const wr = findWeightRow_(ws, req.date);
      if (req.kg == null) { if (wr) ws.deleteRow(wr); return out_({ ok: true }); }
      const target = wr || ws.getLastRow() + 1;
      ws.getRange(target, 1).setNumberFormat('@');
      ws.getRange(target, 1, 1, 2).setValues([[String(req.date), Number(req.kg)]]);
      return out_({ ok: true });
    }

    if (req.action === 'weight_list') {
      const ws = weightSheet_();
      const last = ws.getLastRow();
      return out_({ ok: true, rows: last < 2 ? [] : ws.getRange(2, 1, last - 1, 2).getDisplayValues() });
    }

    if (req.action === 'gym_upsert' || req.action === 'gym_delete') {
      const gid = String(req.gid || '');
      if (!/^[0-9a-z]+$/i.test(gid)) return out_({ ok: false, error: 'bad id' });
      const gs = gymSheet_();
      deleteGymRows_(gs, gid);
      const rows = req.action === 'gym_upsert' && Array.isArray(req.rows) ? req.rows : [];
      if (rows.length) {
        const start = gs.getLastRow() + 1;
        gs.getRange(start, 7, rows.length, 1).setNumberFormat('@');
        gs.getRange(start, 1, rows.length, 8).setValues(rows.map(r => r.slice(0, 8)));
      }
      return out_({ ok: true });
    }

    if (req.action === 'gym_list') {
      const gs = gymSheet_();
      const last = gs.getLastRow();
      return out_({ ok: true, rows: last < 2 ? [] : gs.getRange(2, 1, last - 1, 8).getDisplayValues() });
    }

    const r = findRow_(sh, req.id);

    if (req.action === 'delete') {
      if (r) sh.deleteRow(r);
      const p = findPhoto_(req.id);
      if (p) trashPhoto_(p);
      return out_({ ok: true });
    }

    if (req.action === 'photo_put') {
      const old = findPhoto_(req.id);
      if (old && req.ifMissing) return out_({ ok: true, skipped: true });
      if (old) trashPhoto_(old);
      const name = String(req.name || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 80) + ' ' + req.id + '.jpg';
      Drive.Files.create({ name: name, parents: [photoFolder_()], mimeType: 'image/jpeg' },
        Utilities.newBlob(Utilities.base64Decode(req.data), 'image/jpeg', name));
      return out_({ ok: true });
    }

    if (req.action === 'photo_get') {
      const p = findPhoto_(req.id);
      return out_({ ok: true, data: p ? Utilities.base64Encode(photoBytes_(p)) : null });
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
