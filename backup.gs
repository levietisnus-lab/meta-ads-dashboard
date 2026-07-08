// ============================================================
// BACKUP.GS — Tự động sao lưu toàn bộ code (Apps Script Project)
// vào 1 tab Google Sheet, khôi phục lại được chỉ bằng 1 nút "Run".
//
// KHÔNG expose qua doGet/doPost — chỉ chạy được từ Apps Script editor
// (bởi chủ sở hữu), an toàn tuyệt đối trước truy cập bên ngoài.
//
// Cần bật 1 lần: https://script.google.com/home/usersettings
//   → bật "Google Apps Script API"
// Lần đầu chạy backupCodeToSheet() sẽ hiện màn hình xin quyền mới
// (script.projects) — bấm "Advanced" → "Go to <project> (unsafe)" → Allow
// (an toàn vì đây là script của chính bạn).
// ============================================================

const BACKUP_SHEET_NAME = '_Code Backup';
const BACKUP_CHUNK_SIZE = 45000; // an toàn dưới giới hạn ~50k ký tự/ô của Sheet

const _EXT_BY_TYPE = { SERVER_JS: '.gs', HTML: '.html', JSON: '.json' };

function _backupScriptId() { return ScriptApp.getScriptId(); }

function _backupApiHeaders() {
  return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
}

// Đọc toàn bộ file hiện tại của project qua Apps Script API
function _getProjectFiles() {
  const url = `https://script.googleapis.com/v1/projects/${_backupScriptId()}/content`;
  const res = UrlFetchApp.fetch(url, { headers: _backupApiHeaders(), muteHttpExceptions: true });
  const j = JSON.parse(res.getContentText());
  if (!j.files) throw new Error('Không đọc được project — kiểm tra đã bật "Google Apps Script API" ở script.google.com/home/usersettings chưa. Chi tiết: ' + res.getContentText().substring(0, 300));
  return j.files; // [{ name, type, source }]
}

// Ghi đè toàn bộ file của project (API yêu cầu gửi TRỌN BỘ danh sách file mỗi lần)
function _putProjectFiles(files) {
  const url = `https://script.googleapis.com/v1/projects/${_backupScriptId()}/content`;
  const res = UrlFetchApp.fetch(url, {
    method: 'put',
    contentType: 'application/json',
    headers: _backupApiHeaders(),
    muteHttpExceptions: true,
    payload: JSON.stringify({ files }),
  });
  if (res.getResponseCode() >= 300) throw new Error('Ghi project thất bại: ' + res.getContentText().substring(0, 400));
}

// ─── BACKUP ─────────────────────────────────────────────────
// Lưu snapshot code hiện tại vào tab "_Code Backup". Gọi hàm này
// bất cứ lúc nào muốn lưu 1 mốc; cũng có thể gắn vào syncAllFull().
function backupCodeToSheet() {
  const files = _getProjectFiles();
  const ss = _getSpreadsheet();
  let sh = ss.getSheetByName(BACKUP_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(BACKUP_SHEET_NAME);
    sh.getRange(1, 1, 1, 5).setValues([['timestamp', 'filename', 'chunk_index', 'total_chunks', 'content']])
      .setFontWeight('bold').setBackground('#1e3a5f').setFontColor('white');
    sh.setTabColor('#dc2626');
  }

  const ts = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', "yyyy-MM-dd HH:mm:ss");
  const rows = [];
  files.forEach(f => {
    const filename = f.name + (_EXT_BY_TYPE[f.type] || '');
    const src = f.source || '';
    const chunks = [];
    for (let i = 0; i < src.length; i += BACKUP_CHUNK_SIZE) chunks.push(src.slice(i, i + BACKUP_CHUNK_SIZE));
    if (!chunks.length) chunks.push('');
    chunks.forEach((c, idx) => rows.push([ts, filename, idx + 1, chunks.length, c]));
  });

  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  Logger.log(`✅ Đã backup ${files.length} file (${rows.length} dòng) lúc ${ts}`);
  return `Đã backup ${files.length} file lúc ${ts}`;
}

// Xoá các bản backup cũ, chỉ giữ N mốc gần nhất (gọi định kỳ để Sheet không phình to)
function pruneOldBackups(keepLast) {
  keepLast = keepLast || 10;
  const ss = _getSpreadsheet();
  const sh = ss.getSheetByName(BACKUP_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return 'Chưa có backup nào.';
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  const timestamps = [...new Set(data.map(r => r[0]))].sort(); // cũ → mới
  const toDelete = new Set(timestamps.slice(0, Math.max(0, timestamps.length - keepLast)));
  if (!toDelete.size) return 'Chưa cần xoá — đang có ' + timestamps.length + ' mốc.';
  const keepRows = data.filter(r => !toDelete.has(r[0]));
  sh.getRange(2, 1, sh.getLastRow() - 1, 5).clearContent();
  if (keepRows.length) sh.getRange(2, 1, keepRows.length, 5).setValues(keepRows);
  return `Đã xoá ${toDelete.size} mốc cũ, còn giữ ${timestamps.length - toDelete.size} mốc.`;
}

// ─── XEM DANH SÁCH BẢN BACKUP ───────────────────────────────
function listCodeBackups() {
  const ss = _getSpreadsheet();
  const sh = ss.getSheetByName(BACKUP_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) { Logger.log('Chưa có bản backup nào — chạy backupCodeToSheet() trước.'); return; }
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  const byTs = {};
  data.forEach(r => {
    const ts = r[0];
    if (!byTs[ts]) byTs[ts] = new Set();
    byTs[ts].add(r[1]);
  });
  Logger.log('=== CÁC MỐC BACKUP (cũ → mới) ===');
  Object.keys(byTs).sort().forEach(ts => Logger.log(`  ${ts}  —  ${byTs[ts].size} file`));
}

// ─── KHÔI PHỤC ──────────────────────────────────────────────
// Dán đúng timestamp lấy từ listCodeBackups() vào đây rồi Run.
// Hàm TỰ backup trạng thái hiện tại trước khi ghi đè, nên luôn có
// đường lùi nếu chọn nhầm mốc.
function restoreCodeFromSheet() {
  const TIMESTAMP = 'DÁN_TIMESTAMP_TỪ_listCodeBackups_VÀO_ĐÂY'; // vd '2026-07-08 10:30:00'

  const ss = _getSpreadsheet();
  const sh = ss.getSheetByName(BACKUP_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) throw new Error('Chưa có bản backup nào.');
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  const rows = data.filter(r => String(r[0]) === TIMESTAMP);
  if (!rows.length) throw new Error('Không tìm thấy timestamp "' + TIMESTAMP + '". Chạy listCodeBackups() để xem danh sách đúng.');

  // Gộp các chunk lại theo từng file
  const byFile = {};
  rows.forEach(r => {
    const [, filename, chunkIdx, , content] = r;
    if (!byFile[filename]) byFile[filename] = [];
    byFile[filename][chunkIdx - 1] = content;
  });
  const restoredSources = {};
  Object.entries(byFile).forEach(([filename, chunks]) => { restoredSources[filename] = chunks.join(''); });

  // An toàn: tự lưu trạng thái HIỆN TẠI trước khi ghi đè
  backupCodeToSheet();

  // Lấy toàn bộ file hiện có (updateContent yêu cầu gửi trọn bộ), ghi đè source cho các file có trong bản backup
  const current = _getProjectFiles();
  const merged = current.map(f => {
    const filename = f.name + (_EXT_BY_TYPE[f.type] || '');
    if (restoredSources[filename] !== undefined) {
      return { name: f.name, type: f.type, source: restoredSources[filename] };
    }
    return f;
  });

  _putProjectFiles(merged);
  Logger.log(`✅ Đã khôi phục ${Object.keys(restoredSources).length} file về mốc ${TIMESTAMP}. Vào lại Apps Script editor để thấy code mới (có thể cần F5 trang editor). Nếu web app đang deploy, nhớ Deploy → New version để áp dụng.`);
  return `Đã khôi phục về mốc ${TIMESTAMP}`;
}
