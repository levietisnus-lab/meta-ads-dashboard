// ============================================================
// META.GS — Web App + Sync mở rộng
// Yêu cầu: code.gs phải có CFG, BASE_URL, apiGet, fetchPaged, writeSheet
// ============================================================

// ID của Google Sheet (để web app đọc đúng sheet trong mọi context)
const SHEET_ID = "1UhBB5Hlgik0AIqCAzASsLgYcfBCSVAdFZmCWI1YNoz0";

// ─── MENU TÙY CHỈNH TRÊN SHEET ───────────────────────────────
// Tự chạy mỗi khi mở Sheet — thêm menu "🚀 Fujiwa Dashboard" để bấm
// chạy các hàm mà không cần mở Apps Script editor.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🚀 Fujiwa Dashboard')
    .addItem('🔄 Đồng bộ ngay (tất cả)', 'syncAllFull')
    .addSeparator()
    .addItem('📊 Đồng bộ Meta (Ads/Trang/Bài/Tin nhắn)', 'syncMetaAll')
    .addItem('🎵 Đồng bộ TikTok (Ads/Shop/Trang)', 'syncTikTokAll')
    .addItem('📱 Chỉ đồng bộ SĐT khách', 'syncPhoneList')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('💾 Backup code')
      .addItem('Lưu 1 mốc backup ngay', 'backupCodeToSheet')
      .addItem('Xem danh sách mốc backup', 'listCodeBackups')
      .addItem('Xoá bớt mốc cũ (giữ 15 gần nhất)', 'pruneOldBackups'))
    .addSeparator()
    .addItem('⏰ Cài lại trigger tự động (6h/6h30 sáng)', 'setupTriggerFull')
    .addToUi();
}

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
// doGet: route callback OAuth TikTok/Shopee (?code=...) hoặc phục vụ dashboard HTML
function doGet(e) {
  if (e && e.parameter && e.parameter.code && e.parameter.shop_id && !e.parameter.state) {
    return handleShopeeOAuth(e); // Shopee redirect: ?code=...&shop_id=...
  }
  if (e && e.parameter &&
     ((e.parameter.code && (e.parameter.state === 'dev' || e.parameter.app_key)) ||
       e.parameter.auth_code || e.parameter.state === 'ads')) {
    return handleTikTokOAuth(e);
  }
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
      case 'deleteToken':      result = deleteMsgToken(data.pageId);                      break;
      case 'getPageMsgStats':  result = getPageMsgStats(data.from, data.to);              break;
      case 'getAdsConvStats':  result = getAdsConvStats(data.from, data.to);              break;
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
  const savedStats = PropertiesService.getScriptProperties().getProperty('ADS_CONV_STATS');
  return {
    ads:          get("Ads Data"),
    page:         get("Page Insights"),
    posts:        get("Post Engagement"),
    messages:     get("Messages"),
    creatives:    get("Ad Creatives"),
    adsConvStats: savedStats ? JSON.parse(savedStats) : null,
    
    ttAds:        get("TikTok Ads Data"),
    ttShop:       get("TikTok Shop Data"),
    ttPage:       get("TikTok Page Data"),
    ttProducts:   get("TikTok Product Sales"),
    ttOrderStatus:get("TikTok Order Status"),
    
    synced:       new Date().toLocaleString("vi-VN"),
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

  // Chỉ nhận SĐT DI ĐỘNG VN hợp lệ (đầu 03/05/07/08/09), 10 số, có ranh giới
  // → tránh bắt nhầm mã đơn/ID/số dài. Chấp nhận cách nhau bằng khoảng trắng/dấu chấm/gạch.
  const PHONE_RE = /(?<![0-9])(?:\+?84|0)(?:3[2-9]|5[2689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7}(?![0-9])/;
  const checkPhone = txt => {
    if (!txt) return false;
    const norm = String(txt).replace(/([0-9])[\s.\-]+(?=[0-9])/g, '$1');
    return PHONE_RE.test(norm);
  };
  // Trích xuất SĐT thật (chuẩn hoá về 0xxxxxxxxx)
  const extractPhone = txt => {
    if (!txt) return '';
    const norm = String(txt).replace(/([0-9])[\s.\-]+(?=[0-9])/g, '$1');
    const m = norm.match(PHONE_RE);
    if (!m) return '';
    let p = m[0].replace(/^\+?84/, '0');
    return p;
  };

  const headers = ["updated_date","created_date","page_name","snippet","from","message_count","unread","response_time_hrs","has_phone","customer_msgs","conv_id","phone_date","last_cust_date","phone"];
  const allRows = [];
  const cutoff31d = new Date(); cutoff31d.setDate(cutoff31d.getDate() - 31);
  const cutoff31dStr = Utilities.formatDate(cutoff31d, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');

  // Đọc dữ liệu tích lũy từ lần sync trước
  const knownPhoneIds = new Set();
  const phoneDateMap = {};  // conv_id → phone_date
  const phoneNumMap  = {};  // conv_id → số điện thoại đã lưu
  const custDateMap  = {};  // conv_id → { lcd: last_cust_date, ud: updated_date }
  const msgSh = ss.getSheetByName("Messages");
  if (msgSh && msgSh.getLastRow() > 1) {
    const existing = msgSh.getDataRange().getValues();
    const eHdr  = existing[0];
    const hpIdx  = eHdr.indexOf('has_phone');
    const cidIdx = eHdr.indexOf('conv_id');
    const pdIdx  = eHdr.indexOf('phone_date');
    const udIdx  = eHdr.indexOf('updated_date');
    const hlcd   = eHdr.indexOf('last_cust_date');
    const phIdx  = eHdr.indexOf('phone');
    if (cidIdx >= 0) {
      existing.slice(1).forEach(row => {
        const cid = String(row[cidIdx]||'');
        if (!cid) return;
        // Tích lũy custDateMap cho mọi conv (để tính Trong kỳ chính xác)
        custDateMap[cid] = {
          lcd: hlcd  >= 0 ? String(row[hlcd] ||'') : '',
          ud:  udIdx >= 0 ? String(row[udIdx] ||'') : '',
        };
        // Tích lũy phoneDateMap + số điện thoại chỉ cho conv có SĐT
        if (hpIdx >= 0 && +row[hpIdx] === 1) {
          knownPhoneIds.add(cid);
          phoneDateMap[cid] = (pdIdx >= 0 && row[pdIdx]) ? String(row[pdIdx]) : (udIdx >= 0 ? String(row[udIdx]||'') : '');
          if (phIdx >= 0 && row[phIdx]) phoneNumMap[cid] = String(row[phIdx]);
        }
      });
    }
  }
  Logger.log(`📂 Tích lũy: ${knownPhoneIds.size} SĐT, ${Object.keys(custDateMap).length} custDate`);

  Object.entries(pageMap).forEach(([pid, pname]) => {
    // Lấy page token qua /me/accounts (đúng cho system user token)
    const pt = _pageTokenFor(pid);

    let convList = [];
    try {
      convList = fetchPaged(`${BASE_URL}/${pid}/conversations`, {
        access_token: pt,
        fields: "id,snippet,updated_time,created_time,message_count,unread_count,participants",
        limit: "100",
        platform: "messenger",
      }, 20);
    } catch(e) { Logger.log(`❌ Messages ${pname}: ${e.message}`); return; }

    // ── Phát hiện SĐT: CHỈ từ tin nhắn của KHÁCH (không tính snippet/tin của page) ──
    // Giá trị tích lũy (knownPhoneIds) chỉ dùng làm khởi tạo; khi quét lại sẽ tính lại chính xác.
    const phoneSet = new Set();
    convList.forEach(c => {
      if (knownPhoneIds.has(c.id)) phoneSet.add(c.id);
    });

    const toVnDate = t => t ? Utilities.formatDate(new Date(t), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd') : '';
    let rtCount = 0, phoneCount = 0, lcdCount = 0;
    const scanStart = Date.now();
    const SCAN_BUDGET_MS = 4 * 60 * 1000;
    convList.forEach(c => {
      let responseTimeHrs = '';
      let customerMsgs = 0;
      let hasPhone = phoneSet.has(c.id) ? 1 : 0;
      let phoneNum = phoneNumMap[c.id] || '';   // giữ số đã lưu; ghi đè khi quét lại

      const withinPeriod = new Date(c.updated_time) >= cutoff31d;
      const timeOk = (Date.now() - scanStart) < SCAN_BUDGET_MS;
      const convUpdated = toVnDate(c.updated_time);

      const stored = custDateMap[c.id] || null;
      // lcdIsStale: lcd cũ hơn 31 ngày và conv đã có activity mới hơn → khách có thể đã nhắn lại
      const lcdIsStale = stored && stored.lcd && stored.lcd !== '0000-00-00'
        && stored.lcd < cutoff31dStr && convUpdated > stored.lcd;
      // needLcd: chưa scan, lcd trống, có activity mới hơn lần scan, hoặc lcd cũ (cần làm mới)
      const needLcd = withinPeriod && (!stored || !stored.lcd || convUpdated > (stored.ud || '') || lcdIsStale) && lcdCount < 200 && timeOk;
      let last_cust_date = stored ? stored.lcd : '';

      const doRt    = withinPeriod && rtCount < 80 && timeOk;
      // Quét lại CẢ conv đã cờ SĐT (bỏ !hasPhone) để tính lại chính xác, sửa false-positive cũ
      const doPhone = withinPeriod && phoneCount < 500 && timeOk;
      const doScan  = doRt || doPhone || needLcd;

      if (doScan) {
        if (doRt)                       rtCount++;
        if (doPhone)                    phoneCount++;
        if (needLcd && !doRt && !doPhone) lcdCount++;
        try {
          const msgs = apiGet(`${BASE_URL}/${c.id}/messages`, {
            access_token: pt, fields: "from,created_time,message", limit: "50",
          });
          const msgArr = msgs.data || [];
          // Chỉ tính SĐT do KHÁCH gửi (m.from.id !== page id). Tính lại từ đầu → sửa được sai cũ.
          if (doPhone) {
            hasPhone = 0; phoneNum = '';
            for (const m of msgArr) {
              if (m.from?.id !== pid) {
                const ph = extractPhone(m.message);
                if (ph) { hasPhone = 1; phoneNum = ph; break; }
              }
            }
          }
          const latestCust = msgArr.find(m => m.from?.id !== pid);
          // '0000-00-00' = đã scan nhưng không có tin từ khách (chỉ outbound từ page)
          last_cust_date = latestCust?.created_time ? toVnDate(latestCust.created_time) : '0000-00-00';
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
        hasPhone === 1 ? phoneNum : '',
      ]);
    });
    Logger.log(`✅ Messages ${pname}: ${convList.length} conv (RT:${rtCount} Phone:${phoneCount} LCD:${lcdCount})`);
  });

  _writeSheet(ss, "Messages", headers, allRows);
  return `${allRows.length} hội thoại`;
}

// ============================================================
// 4a. DANH SÁCH SĐT KHÁCH — đọc từ Messages, dedup theo số, ghi ra sheet riêng
// ============================================================
function syncPhoneList() {
  const ss = _getSpreadsheet();
  const msgSh = ss.getSheetByName("Messages");
  if (!msgSh || msgSh.getLastRow() < 2) {
    _writeSheet(ss, "Danh sách SĐT", ["ten_tai_khoan", "so_dien_thoai", "trang", "ngay_de_lai"], []);
    return "0 SĐT (chưa có Messages)";
  }
  const vals = msgSh.getRange(1, 1, msgSh.getLastRow(), msgSh.getLastColumn()).getValues();
  const hdr = vals[0];
  const ci = n => hdr.indexOf(n);
  const iHas = ci('has_phone'), iPhone = ci('phone'), iFrom = ci('from'),
        iPage = ci('page_name'), iPd = ci('phone_date'), iUd = ci('updated_date');

  const seen = {}; // phone → { name, phone, page, date }
  vals.slice(1).forEach(r => {
    if (+r[iHas] !== 1) return;
    const phone = String(iPhone >= 0 ? (r[iPhone] || '') : '').trim();
    if (!phone) return;
    const date = String((iPd >= 0 && r[iPd]) ? r[iPd] : (iUd >= 0 ? r[iUd] : '') || '');
    const rec = { name: String(r[iFrom] || '').trim(), phone, page: String(r[iPage] || ''), date };
    if (!seen[phone] || date > seen[phone].date) seen[phone] = rec;
  });

  const rows = Object.values(seen)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(p => [p.name, p.phone, p.page, p.date]);

  _writeSheet(ss, "Danh sách SĐT", ["ten_tai_khoan", "so_dien_thoai", "trang", "ngay_de_lai"], rows);
  return `${rows.length} SĐT`;
}

// ============================================================
// 4b-0. ADS CONV STATS — Lấy messaging_conversation_started từ Ads API (account level)
// ============================================================
// Gọi ở account level → Facebook dedup unique người → khớp "Tài khoản Meta" trong Ads Manager
function getAdsConvStats(from, to) {
  if (!from || !to) return { total: 0, byAccount: {} };
  let total = 0;
  const byAccount = {};
  AD_ACCOUNTS.forEach(acct => {
    try {
      const rows = fetchPaged(`${BASE_URL}/${acct.id}/insights`, {
        access_token: CFG.TOKEN,
        fields:       "actions",
        time_range:   JSON.stringify({ since: from, until: to }),
        level:        "account",
      });
      let acctTotal = 0;
      rows.forEach(d => {
        const act = toActionMap(d.actions);
        acctTotal += act["onsite_conversion.messaging_conversation_started_7d"]
                  || act["onsite_conversion.messaging_first_reply"] || 0;
      });
      byAccount[acct.name] = acctTotal;
      total += acctTotal;
    } catch(e) {
      Logger.log('getAdsConvStats ' + acct.name + ': ' + e.message);
    }
  });
  return { total, byAccount };
}

// ============================================================
// 4b-0a. PAGE MSG DEDUP — Người liên hệ nhắn tin dedup theo TỪNG TRANG
// ============================================================
// Lọc campaign.id của từng trang ở level=account (Facebook dedup trong phạm vi lọc),
// dùng Batch API để tránh lỗi URL dài. Trả { byPage, byAccount, total }.
function getPageMsgDedup(from, to) {
  if (!from || !to) return { byPage: {}, byAccount: {}, total: { c:0, n:0, d:0 } };
  return _computePageMsgDedup(from, to);
}

// POST Batch API tới graph, retry khi GAS/FB throttle ("too much traffic"/#17/#4)
function _fbBatchPost(items, token) {
  const tk = token || CFG.TOKEN;
  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = UrlFetchApp.fetch(`${BASE_URL}/`, {
        method: 'post', muteHttpExceptions: true,
        payload: { access_token: tk, batch: JSON.stringify(items) },
      });
      const txt = res.getContentText();
      const arr = JSON.parse(txt);
      if (Array.isArray(arr)) return arr;
      lastErr = txt;                       // lỗi cấp batch (vd rate limit) → thử lại
    } catch(e) { lastErr = e.message; }    // "too much traffic" từ UrlFetch → thử lại
    Utilities.sleep(2000 * (attempt + 1)); // backoff tăng dần
  }
  Logger.log('_fbBatchPost thất bại sau 4 lần: ' + lastErr);
  return [];
}

// Trả { byPage:{name:{c,n}}, byAccount:{name:{c,n}}, total:{c,n} }
//   c = messaging contacts (conversation_started_7d), n = new messaging contacts (first_reply)
function _computePageMsgDedup(from, to) {
  function extractPageId(ad) {
    const s = ad.effective_object_story_id || '';
    if (s) return s.split('_')[0];
    const spec = ad.creative && ad.creative.object_story_spec;
    if (spec && spec.page_id) return spec.page_id;
    if (ad.creative && ad.creative.actor_id) return ad.creative.actor_id;
    return '';
  }
  const MSG  = 'onsite_conversion.messaging_conversation_started_7d';   // Messaging contacts
  const MSGN = 'onsite_conversion.messaging_first_reply';               // New messaging contacts
  const MSGD = 'onsite_conversion.messaging_user_depth_3_message_send'; // Gửi ≥3 tin

  // pageId → tên (từ Ad Creatives)
  const ss = _getSpreadsheet();
  const cr = ss.getSheetByName('Ad Creatives');
  const pidName = {};
  if (cr && cr.getLastRow() > 1) {
    const cv = cr.getRange(1,1,cr.getLastRow(),cr.getLastColumn()).getValues();
    const cH = cv[0], iPid = cH.indexOf('page_id'), iPn = cH.indexOf('page_name');
    cv.slice(1).forEach(row => {
      const pid = String(row[iPid]||'').trim();
      if (pid) pidName[pid] = String(row[iPn]||pid).trim();
    });
  }

  // pageId → { accountId → Set(campaignId) }, và tên account
  const pageMap = {};
  const acctName = {};
  AD_ACCOUNTS.forEach(acct => {
    acctName[acct.id] = acct.name;
    const ads = fetchPaged(`${BASE_URL}/${acct.id}/ads`, {
      access_token: CFG.TOKEN,
      fields: 'campaign{id},effective_object_story_id,creative{object_story_spec{page_id},actor_id}',
      limit: '200',
    }, 10);
    ads.forEach(ad => {
      const pid = extractPageId(ad);
      if (!pid || !ad.campaign || !ad.campaign.id) return;
      pageMap[pid] = pageMap[pid] || {};
      pageMap[pid][acct.id] = pageMap[pid][acct.id] || {};
      pageMap[pid][acct.id][ad.campaign.id] = true;
    });
  });

  // (Không giải tên page qua batch — POST thứ 2 vào cùng URL gây throttle. Page ngoài Ad Creatives
  //  giữ raw id, không khớp bảng Messages nên tự động bị loại khỏi tổng hiển thị.)

  // Chuẩn bị batch: mỗi (page, account) 1 request
  const reqs = [];       // { pid, acctId }
  const relUrls = [];
  Object.keys(pageMap).forEach(pid => {
    Object.keys(pageMap[pid]).forEach(acctId => {
      const ids = Object.keys(pageMap[pid][acctId]);
      if (!ids.length) return;
      const qs = [
        'level=account',
        'fields=actions',
        'time_range=' + encodeURIComponent(JSON.stringify({ since: from, until: to })),
        'filtering=' + encodeURIComponent(JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: ids }])),
      ].join('&');
      reqs.push({ pid, acctId });
      relUrls.push(`${acctId}/insights?${qs}`);
    });
  });

  // Gọi Batch API theo lô 50 (giới hạn batch của FB), có sleep giữa các lô để tránh throttle
  const results = [];
  for (let i = 0; i < relUrls.length; i += 50) {
    const batch = relUrls.slice(i, i + 50).map(u => ({ method: 'GET', relative_url: u }));
    if (i > 0) Utilities.sleep(1200);
    _fbBatchPost(batch).forEach(x => results.push(x));
  }

  // Gộp kết quả (2 metric: c = messaging contacts, n = new messaging contacts)
  const byPage = {}, byAccount = {};
  const total = { c: 0, n: 0, d: 0 };
  results.forEach((item, idx) => {
    const meta = reqs[idx];
    if (!item || item.code !== 200) return;
    let body;
    try { body = JSON.parse(item.body); } catch(e) { return; }
    let c = 0, n = 0, d3 = 0;
    (body.data || []).forEach(d => (d.actions || []).forEach(a => {
      if (a.action_type === MSG)  c  += Number(a.value) || 0;
      if (a.action_type === MSGN) n  += Number(a.value) || 0;
      if (a.action_type === MSGD) d3 += Number(a.value) || 0;
    }));
    const pname = pidName[meta.pid] || meta.pid;
    const aname = acctName[meta.acctId] || meta.acctId;
    byPage[pname]    = byPage[pname]    || { c:0, n:0, d:0 };
    byAccount[aname] = byAccount[aname] || { c:0, n:0, d:0 };
    byPage[pname].c += c;    byPage[pname].n += n;    byPage[pname].d += d3;
    byAccount[aname].c += c; byAccount[aname].n += n; byAccount[aname].d += d3;
    total.c += c;            total.n += n;            total.d += d3;
  });

  return { byPage, byAccount, total };
}

// ============================================================
// 4b-0b. ADS DAILY — Lấy live dữ liệu campaign/adset theo NGÀY từ Ads API
// ============================================================
// from, to: 'yyyy-MM-dd'. accountName: tên tài khoản ('' hoặc 'all' = tất cả)
// Trả về { headers, rows } cùng cấu trúc "Ads Data" để dashboard render trực tiếp.
function getAdsDaily(from, to, accountName) {
  const headers = [
    "date", "account", "campaign", "adset",
    "spend", "impressions", "reach",
    "clicks", "ctr", "cpc", "cpm", "frequency",
    "link_clicks", "purchases", "add_to_cart",
    "landing_page_view", "messaging_reply", "page_like",
    "roas"
  ];
  if (!from || !to) return { headers, rows: [] };

  const fields = [
    "campaign_name", "adset_name",
    "spend", "impressions", "reach",
    "clicks", "ctr", "cpc", "cpm",
    "frequency", "actions", "purchase_roas",
    "date_start", "date_stop"
  ].join(",");

  const wanted = String(accountName || '').trim().toLowerCase();
  const accts  = AD_ACCOUNTS.filter(a =>
    !wanted || wanted === 'all' || a.name.toLowerCase() === wanted);

  const rows = [];
  accts.forEach(acct => {
    try {
      const data = fetchPaged(`${BASE_URL}/${acct.id}/insights`, {
        access_token:   CFG.TOKEN,
        time_range:     JSON.stringify({ since: from, until: to }),
        level:          "adset",
        fields:         fields,
        limit:          "200",
        time_increment: "1",
      });
      data.forEach(d => {
        const act  = toActionMap(d.actions);
        const roas = d.purchase_roas ? parseFloat(d.purchase_roas[0]?.value || 0) : 0;
        rows.push([
          d.date_start,
          acct.name,
          d.campaign_name,
          d.adset_name,
          num(d.spend),
          num(d.impressions),
          num(d.reach),
          num(d.clicks),
          num(d.ctr),
          num(d.cpc),
          num(d.cpm),
          num(d.frequency),
          act["link_click"]                                                || 0,
          act["purchase"]                                                  || 0,
          act["add_to_cart"]                                               || 0,
          act["landing_page_view"]                                         || 0,
          act["onsite_conversion.messaging_conversation_started_7d"]
            || act["onsite_conversion.messaging_first_reply"]              || 0,
          act["like"]                                                      || 0,
          roas,
        ]);
      });
    } catch(e) {
      Logger.log('getAdsDaily ' + acct.name + ': ' + e.message);
    }
  });
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return { headers, rows };
}

// ============================================================
// 4b-1. PAGE MSG STATS — Lấy số liệu tổng kỳ từ Page Insights
// ============================================================
// Trả về { page_name: { inPeriod, newConvs } } dùng period=total_over_range
// → khớp chính xác "Tổng số người liên hệ" của Meta Business Suite
function getPageMsgStats(from, to) {
  if (!from || !to) return {};
  const crSh = SS.getSheetByName("Ad Creatives");
  const pageMap = {};
  if (crSh && crSh.getLastRow() > 1) {
    const vals = crSh.getRange(1,1,crSh.getLastRow(),crSh.getLastColumn()).getValues();
    const hdr  = vals[0];
    const pidI = hdr.indexOf('page_id'), pnI = hdr.indexOf('page_name');
    if (pidI >= 0) vals.slice(1).forEach(r => {
      const pid = String(r[pidI]||'').trim();
      if (pid && pid !== '0') pageMap[pid] = String(r[pnI]||pid).trim();
    });
  }
  if (!Object.keys(pageMap).length) pageMap[CFG.PAGE_ID] = 'Main Page';

  const sinceTs = String(Math.floor(new Date(from).getTime() / 1000));
  const untilTs = String(Math.floor(new Date(to + 'T23:59:59+07:00').getTime() / 1000));
  const out = {};
  Object.entries(pageMap).forEach(([pid, pname]) => {
    // Lấy page token qua /me/accounts (đúng cho system user token)
    const pt = _pageTokenFor(pid);
    try {
      const r = apiGet(`${BASE_URL}/${pid}/insights`, {
        access_token: pt,
        metric: "page_messages_active_threads_unique,page_messages_new_conversations_unique",
        period: "total_over_range",
        since: sinceTs,
        until: untilTs,
      });
      const vals = {};
      (r.data || []).forEach(m => { vals[m.name] = m.values?.[0]?.value ?? 0; });
      out[pname] = {
        inPeriod: vals['page_messages_active_threads_unique']      || 0,
        newConvs:  vals['page_messages_new_conversations_unique']   || 0,
      };
    } catch(e) {
      Logger.log('getPageMsgStats ' + pname + ': ' + e.message);
    }
  });
  return out;
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
function syncMetaAll() {
  const log = [];
  const run = (label, fn) => {
    try   { log.push(`${label}: ${fn()}`); }
    catch (e) { log.push(`${label} lỗi: ${e.message}`); }
  };
  run("Ads",       syncAds);
  run("Page",      syncPage);
  run("Posts",     syncPosts);
  run("Messages",  syncMessages);
  run("SĐT",       syncPhoneList);
  run("Creatives", syncAdCreatives);

  // Lưu account-level messaging metric (dedup unique người) vào Properties
  try {
    const today  = Utilities.formatDate(new Date(),    'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
    const from31 = Utilities.formatDate(daysAgo(30),   'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
    const stats  = getAdsConvStats(from31, today);
    PropertiesService.getScriptProperties().setProperty('ADS_CONV_STATS', JSON.stringify(stats));
    log.push(`AdsConvStats: ${stats.total} (${from31} → ${today})`);
  } catch(e) { log.push('AdsConvStats lỗi: ' + e.message); }

  const msg = "✅ syncAllFull — " + new Date().toLocaleString("vi-VN") + "\n" + log.join("\n");
  Logger.log(msg);
  return msg;
}

// Điểm vào chính mà dashboard gọi ("Đồng bộ ngay") — chạy cả Meta lẫn TikTok,
// và tự lưu 1 mốc backup code vào Sheet trước khi bắt đầu.
// Meta sync (backup + Ads/Page/Posts/Messages/SĐT/Creatives) đã gần chạm 6 phút một mình
// (Messages có thể quét tới 4 phút). TikTok (Ads/Shop/Products/Page) nay còn nặng hơn vì
// Products phải phân trang qua orders. Gộp cả 2 trong 1 lần chạy sẽ vượt giới hạn cứng 6
// phút của GAS → nên tách TikTok ra chạy ở 1 execution RIÊNG qua trigger, có 6 phút của
// chính nó, không cộng dồn với phần Meta.
function syncAllFull() {
  try { backupCodeToSheet(); pruneOldBackups(15); }
  catch (e) { Logger.log('⚠️ Backup code bỏ qua (chưa cấp quyền script.projects?): ' + e.message); }

  const log = [];
  const run = (label, fn) => {
    try   { log.push(`${label}: ${fn()}`); }
    catch (e) { log.push(`${label} lỗi: ${e.message}`); }
  };
  run("Meta", syncMetaAll);

  // TikTok chạy riêng sau 5 giây (execution mới, không tính chung 6 phút với Meta ở trên)
  ScriptApp.newTrigger('syncTikTokAll').timeBased().after(5 * 1000).create();
  log.push("TikTok: đã lên lịch chạy riêng (~5 giây nữa, xem log của syncTikTokAll)");

  const msg = "✅ syncAllFull — " + new Date().toLocaleString("vi-VN") + "\n" + log.join("\n");
  Logger.log(msg);
  return msg;
}

// Cập nhật trigger dùng syncMetaAll và syncTikTokAll (chạy 1 lần mỗi ngày)
function setupTriggerFull() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncMetaAll")
    .timeBased().atHour(6).everyDays(1)
    .inTimezone("Asia/Ho_Chi_Minh")
    .create();
  ScriptApp.newTrigger("syncTikTokAll")
    .timeBased().atHour(6).nearMinute(30).everyDays(1) // Chạy lệch giờ Meta để tránh timeout
    .inTimezone("Asia/Ho_Chi_Minh")
    .create();
  Logger.log("⏰ Trigger: syncMetaAll lúc 6:00 AM, syncTikTokAll lúc 6:30 AM mỗi ngày");
}
