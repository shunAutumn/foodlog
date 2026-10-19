/**
 * たべたもの記録 → Googleスプレッドシート連携
 * 使い方は README.md を見てください。
 * 下の合言葉を、自分だけが知っている文字列に変えてください（アプリの設定にも同じものを入れます）。
 */
const TOKEN = 'ここを自分の合言葉に変える';

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
    if (req.token !== TOKEN) return out_({ ok: false, error: 'unauthorized' });
    const sh = sheet_();

    if (req.action === 'ping') return out_({ ok: true, sheet: sh.getName() });

    if (req.action === 'list') {
      const last = sh.getLastRow();
      const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, 7).getDisplayValues()
        .filter(r => r[6] !== '');
      return out_({ ok: true, rows: rows });
    }

    const r = findRow_(sh, req.id);

    if (req.action === 'delete') {
      if (r) sh.deleteRow(r);
      return out_({ ok: true });
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
