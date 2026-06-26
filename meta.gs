// ============================================================
// META.GS — Web App + Sync mở rộng
// Yêu cầu: code.gs phải có CFG, BASE_URL, apiGet, fetchPaged, writeSheet
// ============================================================

// ID của Google Sheet (để web app đọc đúng sheet trong mọi context)
const SHEET_ID = "1UhBB5Hlgik0AIqCAzASsLgYcfBCSVAdFZmCWI1YNoz0";

// ============================================================
// HELPERS dùng trong meta.gs (nếu code.gs không export được)
// ============================================================
function getPageToken() {
  const result = apiGet(`${BASE_URL}/${CFG.PAGE_ID}`, {
    access_token: CFG.TOKEN,
    fields: "access_token,name",
  });
  Logger.log("Page: " + result.name);
  Logger.log("PAGE_TOKEN: " + result.access_token);
  return result.access_token;
}

// ─── WEB APP ─────────────────────────────────────────────
// doGet: vẫn phục vụ HTML cho ai truy cập URL GAS trực tiếp (backward compat)
function doGet() {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("Meta Ads Dashboard")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// doPost: JSON API cho GitHub Pages frontend
// Content-Type: text/plain (simple request, không cần CORS preflight)
function doPost(e) {
  let data = {};
  try { data = JSON.parse(e.postData.contents); } catch(_) {}
  const action = data.action || '';
  try {
    let result;
    switch (action) {
      case 'getData':     result = getDashboardData();                                     break;
      case 'syncNow':     result = triggerSyncAsync();                                     break;
      case 'getConv':     result = getConvMessages(data.convId, data.pageId);              break;
      case 'sendReply':   result = sendReply(data.pageId, data.recipientId, data.text);   break;
      case 'getTokens':   result = getMsgTokenStatus();                                    break;
      case 'saveToken':   result = saveMsgToken(data.pageId, data.token);                 break;
      case 'deleteToken': result = deleteMsgToken(data.pageId);                           break;
      default: result = { _error: 'Unknown action: ' + action };
    }
    return _jsonResp(result);
  } catch (err) {
    return _jsonResp({ _error: err.message });
  }
}

function _jsonResp(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Lên lịch syncAllFull chạy sau 1 phút (tránh timeout khi gọi qua HTTP)
function triggerSyncAsync() {
  ScriptApp.newTrigger('syncAllFull').timeBased().after(60 * 1000).create();
  return { status: 'scheduled', message: 'Đang đồng bộ, dữ liệu sẽ cập nhật sau ~2 phút. Hãy tải lại trang.' };
}

// ─── DATA API ─────────────────────────────────────────────
// Dùng openById để đảm bảo hoạt động cả khi chạy từ web app URL
// (getActiveSpreadsheet() có thể trả null trong web app context)
function getDashboardData() {
  const ss = _getSpreadsheet();
  const get = name => _sheetToJson(ss, name);
  return {
    ads:       get("Ads Data"),
    page:      get("Page Insights"),
    posts:     get("Post Engagement"),
    messages:  get("Messages"),
    creatives: get("Ad Creatives"),
    synced:    new Date().toLocaleString("vi-VN"),
  };
}

function _getSpreadsheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) { /* web app context, fallback to openById */ }
  return SpreadsheetApp.openById(SHEET_ID);
}

function _sheetToJson(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) return { headers: [], rows: [] };
  const lastRow  = sh.getLastRow();
  const lastCol  = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { headers: [], rows: [] };
  const vals = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const sanitize = v => (v instanceof Date)
    ? Utilities.formatDate(v, "Asia/Ho_Chi_Minh", "yyyy-MM-dd")
    : v;
  return {
    headers: vals[0].map(sanitize),
    rows: vals.slice(1).map(row => row.map(sanitize)),
  };
}

// ============================================================
// 4. MESSAGES — Hội thoại Facebook Page
// Cần quyền: pages_messaging trên token
// ============================================================
function syncMessages() {
  const ss = _getSpreadsheet();
  const crSh = ss.getSheetByName("Ad Creatives");
  const pageMap = {};
  if (crSh && crSh.getLastRow() > 1) {
    const vals = crSh.getRange(1, 1, crSh.getLastRow(), crSh.getLastColumn()).getValues();
    const hdr = vals[0];
    const pidI = hdr.indexOf('page_id'), pnI = hdr.indexOf('page_name');
    if (pidI >= 0) {
      vals.slice(1).forEach(r => {
        const pid = String(r[pidI]||'').trim();
        if (pid && pid !== '0') pageMap[pid] = String(r[pnI]||pid).trim();
      });
    }
  }
  if (!Object.keys(pageMap).length) pageMap[CFG.PAGE_ID] = 'Main Page';

  // Chuẩn hóa và kiểm tra SĐT 10-11 chữ số, chấp nhận cách nhau bằng khoảng trắng/dấu chấm/gạch
  const checkPhone = txt => {
    if (!txt) return false;
    const norm = String(txt).replace(/([0-9])[\s.\-]+(?=[0-9])/g, '$1');
    return /(?:\+84[0-9]{9}|0[0-9]{9,10})(?![0-9])/.test(norm);
  };

  const headers = ["updated_date","created_date","page_name","snippet","from","message_count","unread","response_time_hrs","has_phone","customer_msgs","conv_id","phone_date","last_cust_date"];
  const allRows = [];
  const cutoff31d = new Date(); cutoff31d.setDate(cutoff31d.getDate() - 31);

  // Đọc conv_id đã có SĐT + ngày phát hiện từ lần sync trước
  const knownPhoneIds = new Set();
  const phoneDateMap = {};  // conv_id → phone_date (ngày lần đầu phát hiện SĐT)
  const msgSh = ss.getSheetByName("Messages");
  if (msgSh && msgSh.getLastRow() > 1) {
    const existing = msgSh.getDataRange().getValues();
    const eHdr = existing[0];
    const hpIdx  = eHdr.indexOf('has_phone');
    const cidIdx = eHdr.indexOf('conv_id');
    const pdIdx  = eHdr.indexOf('phone_date');
    const udIdx  = eHdr.indexOf('updated_date');
    if (hpIdx >= 0 && cidIdx >= 0) {
      existing.slice(1).forEach(row => {
        if (+row[hpIdx] === 1) {
          const cid = String(row[cidIdx]);
          knownPhoneIds.add(cid);
          // Ưu tiên phone_date đã lưu, fallback sang updated_date của lần đó
          phoneDateMap[cid] = (pdIdx >= 0 && row[pdIdx]) ? String(row[pdIdx]) : (udIdx >= 0 ? String(row[udIdx]||'') : '');
        }
      });
    }
  }
  Logger.log(`📂 Đã tích lũy ${knownPhoneIds.size} conv có SĐT từ sync trước`);

  Object.entries(pageMap).forEach(([pid, pname]) => {
    let pt = CFG.PAGE_TOKEN;
    try {
      const info = apiGet(`${BASE_URL}/${pid}`, { access_token: CFG.TOKEN, fields: "access_token" });
      if (info.access_token) pt = info.access_token;
    } catch(e) { return; }

    let convList = [];
    try {
      convList = fetchPaged(`${BASE_URL}/${pid}/conversations`, {
        access_token: pt,
        fields: "id,snippet,updated_time,created_time,message_count,unread_count,participants",
        limit: "100",
        platform: "messenger",
      }, 20);
    } catch(e) { Logger.log(`❌ Messages ${pname}: ${e.message}`); return; }

    // ── Phát hiện SĐT: 3 tầng, tích lũy qua các lần sync ──────────────
    // Tầng 1 (miễn phí): snippet của hội thoại
    // Tầng 2 (miễn phí): conv_id đã phát hiện SĐT trong lần sync trước (knownPhoneIds)
    // Tầng 3 (API sequential): response_time top 120, phone scan top 400
    const phoneSet = new Set();
    convList.forEach(c => {
      if (knownPhoneIds.has(c.id) || checkPhone(c.snippet)) phoneSet.add(c.id);
    });

    const toVnDate = t => t ? Utilities.formatDate(new Date(t), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd') : '';
    let rtCount = 0, phoneCount = 0;
    const scanStart = Date.now();
    const SCAN_BUDGET_MS = 4 * 60 * 1000; // tối đa 4 phút để tránh timeout 6 phút
    convList.forEach(c => {
      let responseTimeHrs = '';
      let customerMsgs = 0;
      let hasPhone = phoneSet.has(c.id) ? 1 : 0;

      const withinPeriod = new Date(c.updated_time) >= cutoff31d;
      const timeOk = (Date.now() - scanStart) < SCAN_BUDGET_MS;
      const doRt    = withinPeriod && rtCount < 120 && timeOk;
      const doPhone = withinPeriod && !hasPhone && phoneCount < 150 && timeOk;

      let last_cust_date = '';
      if (doRt || doPhone) {
        if (doRt)    rtCount++;
        if (doPhone) phoneCount++;
        try {
          // Luôn lấy from+created_time để tính last_cust_date cho mọi conv được scan
          const msgs = apiGet(`${BASE_URL}/${c.id}/messages`, {
            access_token: pt, fields: "from,created_time,message", limit: "20",
          });
          const msgArr = msgs.data || [];   // API trả về mới nhất trước
          if (!hasPhone && msgArr.some(m => checkPhone(m.message))) hasPhone = 1;
          // Ngày khách nhắn gần nhất (msgArr đã sorted newest-first)
          const latestCust = msgArr.find(m => m.from?.id !== pid);
          if (latestCust?.created_time) last_cust_date = toVnDate(latestCust.created_time);
          if (doRt) {
            const rev = [...msgArr].reverse();
            customerMsgs = rev.filter(m => m.from?.id !== pid).length;
            let firstCustTime = null, firstReplyTime = null;
            for (const m of rev) {
              if (!firstCustTime && m.from?.id !== pid) {
                firstCustTime = new Date(m.created_time);
              } else if (firstCustTime && !firstReplyTime && m.from?.id === pid) {
                firstReplyTime = new Date(m.created_time);
                break;
              }
            }
            if (firstCustTime && firstReplyTime) {
              responseTimeHrs = Math.round((firstReplyTime - firstCustTime) / 360000) / 10;
            }
          }
        } catch(e) {}
      }

      // phone_date: lấy từ map (đã lưu trước) hoặc ghi ngày hội thoại cập nhật lần này
      const phone_date = hasPhone === 1
        ? (phoneDateMap[c.id] || toVnDate(c.updated_time))
        : '';

      allRows.push([
        toVnDate(c.updated_time),
        toVnDate(c.created_time),
        pname,
        (c.snippet||'').substring(0, 200),
        (c.participants?.data||[]).map(p=>p.name).filter(Boolean).join(', '),
        c.message_count || 0,
        c.unread_count  || 0,
        responseTimeHrs,
        hasPhone,
        customerMsgs,
        c.id || '',
        phone_date,
        last_cust_date,
      ]);
    });
    Logger.log(`✅ Messages ${pname}: ${convList.length} conv`);
  });

  _writeSheet(ss, "Messages", headers, allRows);
  return `${allRows.length} hội thoại`;
}

// ============================================================
// 4b. MESSAGING TOKEN — Lưu token có quyền pages_messaging
// ============================================================

// Lấy page token ưu tiên: stored > derived từ user token > CFG.PAGE_TOKEN
function _getPageMsgToken(pageId) {
  const stored = PropertiesService.getScriptProperties().getProperty('MSG_TOKEN_' + pageId);
  if (stored) return stored;
  try {
    const info = apiGet(`${BASE_URL}/${pageId}`, { access_token: CFG.TOKEN, fields: "access_token" });
    if (info.access_token) return info.access_token;
  } catch(e) {}
  return CFG.PAGE_TOKEN;
}

// Lưu page access token có pages_messaging (gọi từ dashboard)
function saveMsgToken(pageId, token) {
  if (!pageId || !token) throw new Error('Thiếu pageId hoặc token');
  // Bước 1: kiểm tra token hợp lệ
  try {
    apiGet(`${BASE_URL}/${pageId}`, { access_token: token, fields: 'id,name' });
  } catch(e) {
    throw new Error('Token không hợp lệ hoặc sai page: ' + e.message);
  }
  // Bước 2: kiểm tra quyền pages_messaging bằng cách thử đọc 1 conversation
  try {
    apiGet(`${BASE_URL}/${pageId}/conversations`, {
      access_token: token,
      fields: 'id',
      limit: '1',
      platform: 'messenger',
    });
  } catch(e) {
    const msg = e.message || '';
    if (msg.includes('permission') || msg.includes('OAuthException') || msg.includes('pages_messaging')) {
      throw new Error(
        'Token thiếu quyền pages_messaging.\n' +
        'Khi tạo token trong Graph API Explorer hãy tích thêm:\n' +
        '• pages_messaging\n• pages_read_engagement\n• pages_manage_metadata'
      );
    }
    throw new Error('Lỗi khi kiểm tra quyền: ' + msg);
  }
  PropertiesService.getScriptProperties().setProperty('MSG_TOKEN_' + pageId, token);
  return 'OK';
}

// Xóa token đã lưu (dùng lại token CFG)
function deleteMsgToken(pageId) {
  PropertiesService.getScriptProperties().deleteProperty('MSG_TOKEN_' + pageId);
  return 'OK';
}

// Trả về danh sách pages + trạng thái token (cho UI cài đặt)
function getMsgTokenStatus() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const ss = _getSpreadsheet();
  const crSh = ss.getSheetByName('Ad Creatives');
  const pages = {};
  if (crSh && crSh.getLastRow() > 1) {
    const vals = crSh.getDataRange().getValues();
    const hdr  = vals[0];
    const pidI = hdr.indexOf('page_id'), pnI = hdr.indexOf('page_name');
    if (pidI >= 0) {
      vals.slice(1).forEach(r => {
        const pid = String(r[pidI]||'').trim();
        const pn  = String(r[pnI]||'').trim();
        if (pid && pid !== '0') pages[pid] = pn;
      });
    }
  }
  if (!Object.keys(pages).length && CFG.PAGE_ID) pages[CFG.PAGE_ID] = 'Main Page';
  return Object.entries(pages).map(([id, name]) => ({
    id, name, hasToken: !!props['MSG_TOKEN_' + id],
  }));
}

// ============================================================
// 4c. MESSAGES — Đọc lịch sử & Gửi tin nhắn từ dashboard
// ============================================================
function getConvMessages(convId, pageId) {
  const pt = _getPageMsgToken(pageId);
  const result = apiGet(`${BASE_URL}/${convId}/messages`, {
    access_token: pt,
    fields: "from,created_time,message",
    limit: "50",
  });
  return { messages: (result.data || []).reverse(), pageId };
}

function sendReply(pageId, recipientId, text) {
  const pt = _getPageMsgToken(pageId);
  const res = UrlFetchApp.fetch(
    `${BASE_URL}/${pageId}/messages?access_token=${encodeURIComponent(pt)}`,
    {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: text },
        messaging_type: "RESPONSE",
      }),
      muteHttpExceptions: true,
    }
  );
  const json = JSON.parse(res.getContentText());
  if (json.error) throw new Error(json.error.message);
  return json;
}

// ============================================================
// 5. AD CREATIVES — Nội dung & hình ảnh quảng cáo
// ============================================================
function syncAdCreatives() {
  function extractPageId(ad) {
    const storyId = ad.effective_object_story_id || '';
    if (storyId) return storyId.split('_')[0];
    const spec = ad.creative?.object_story_spec;
    if (spec?.page_id) return spec.page_id;
    const actorId = ad.creative?.actor_id;
    if (actorId) return actorId;
    return '';
  }

  const headers = ["account","campaign","adset","ad_name","status","page_id","page_name","title","body","cta","image_url"];
  const allRows = [];
  const pageNameCache = {};

  AD_ACCOUNTS.forEach(acct => {
    try {
      const raw = fetchPaged(`${BASE_URL}/${acct.id}/ads`, {
        access_token: CFG.TOKEN,
        fields: [
          "name", "status", "effective_status",
          "campaign{name}", "adset{name}",
          "effective_object_story_id",
          "creative{title,body,image_url,call_to_action_type,thumbnail_url,object_story_spec{page_id},actor_id}",
        ].join(","),
        limit: "200",
      }, 10);

      // Tra tên Page (dùng cache chung giữa 2 tài khoản)
      const pageIds = [...new Set(raw.map(extractPageId).filter(Boolean))];
      pageIds.forEach(pid => {
        if (pageNameCache[pid]) return;
        try {
          const p = apiGet(`${BASE_URL}/${pid}`, { access_token: CFG.TOKEN, fields: 'name' });
          pageNameCache[pid] = p.name || pid;
        } catch(e) {
          pageNameCache[pid] = pid;
        }
      });

      raw.forEach(ad => {
        const pageId = extractPageId(ad);
        allRows.push([
          acct.name,
          ad.campaign?.name              || "",
          ad.adset?.name                 || "",
          ad.name                        || "",
          ad.effective_status || ad.status || "",
          pageId,
          pageNameCache[pageId]          || pageId || "",
          ad.creative?.title             || "",
          (ad.creative?.body             || "").substring(0, 300),
          ad.creative?.call_to_action_type || "",
          ad.creative?.image_url || ad.creative?.thumbnail_url || "",
        ]);
      });
      Logger.log(`✅ Creatives ${acct.name}: ${raw.length} ads`);
    } catch(e) {
      Logger.log(`❌ Creatives ${acct.name}: ${e.message}`);
    }
  });

  const ss = _getSpreadsheet();
  _writeSheet(ss, "Ad Creatives", headers, allRows);
  return `${allRows.length} ads tổng`;
}

// Helper writeSheet dùng openById (không phụ thuộc SS từ code.gs)
function _writeSheet(ss, name, headers, rows) {
  let sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight("bold")
    .setBackground("#1e3a5f")
    .setFontColor("white");
  if (rows.length > 0)
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

// ============================================================
// SYNC ĐẦY ĐỦ — gọi từ dashboard hoặc trigger
// ============================================================
function syncAllFull() {
  const log = [];
  const run = (label, fn) => {
    try   { log.push(`${label}: ${fn()}`); }
    catch (e) { log.push(`${label} lỗi: ${e.message}`); }
  };
  run("Ads",       syncAds);
  run("Page",      syncPage);
  run("Posts",     syncPosts);
  run("Messages",  syncMessages);
  run("Creatives", syncAdCreatives);
  const msg = "✅ syncAllFull — " + new Date().toLocaleString("vi-VN") + "\n" + log.join("\n");
  Logger.log(msg);
  return msg;
}

// Cập nhật trigger dùng syncAllFull (chạy 1 lần)
function setupTriggerFull() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncAllFull")
    .timeBased().atHour(6).everyDays(1)
    .inTimezone("Asia/Ho_Chi_Minh")
    .create();
  Logger.log("⏰ Trigger: syncAllFull lúc 6:00 AM mỗi ngày");
}
