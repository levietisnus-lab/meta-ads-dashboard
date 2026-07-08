// ============================================================
// SHOPEE — OAuth + gọi API có ký HMAC-SHA256 (Shopee Open Platform v2)
// SHOPEE.* định nghĩa trong config.gs. Dùng chung _hexHmac() từ tiktok.gs.
// ============================================================

const SHOPEE_DOMAIN = 'https://partner.shopeemobile.com';

function _shopeeRedirectUri() {
  if (SHOPEE.REDIRECT_URI && /^https/.test(SHOPEE.REDIRECT_URI)) return SHOPEE.REDIRECT_URI;
  return ScriptApp.getService().getUrl();
}

// Chữ ký Shopee cho bước AUTHORIZE / TOKEN EXCHANGE (chưa có access_token/shop_id):
// HMAC-SHA256( partner_id + path + timestamp , partner_key ) → hex
function _shopeeSignBase(path, ts) {
  const base = String(SHOPEE.PARTNER_ID) + path + ts;
  return _hexHmac(base, SHOPEE.PARTNER_KEY);
}

// Chữ ký cho các API CẦN access_token + shop_id:
// HMAC-SHA256( partner_id + path + timestamp + access_token + shop_id , partner_key ) → hex
function _shopeeSignAuthed(path, ts, accessToken, shopId) {
  const base = String(SHOPEE.PARTNER_ID) + path + ts + accessToken + String(shopId);
  return _hexHmac(base, SHOPEE.PARTNER_KEY);
}

// ---- In link authorize + redirect URI ----
function shopeeSetup() {
  const uri = _shopeeRedirectUri();
  Logger.log('REDIRECT URI (dán vào Redirect URL của app Shopee):\n' + uri);
  Logger.log('\n--- Authorize SHOP — mở link này trên trình duyệt (đăng nhập đúng shop Fujiwa) ---');
  Logger.log(shopeeAuthUrl());
}

function shopeeAuthUrl() {
  const path = '/api/v2/shop/auth_partner';
  const ts = Math.floor(Date.now() / 1000);
  const sign = _shopeeSignBase(path, ts);
  const p = {
    partner_id: SHOPEE.PARTNER_ID,
    timestamp:  ts,
    sign:       sign,
    redirect:   _shopeeRedirectUri(),
  };
  const qs = Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${SHOPEE_DOMAIN}${path}?${qs}`;
}

// Đổi code (+ shop_id) lấy access_token
function _shopeeExchange(code, shopId) {
  const path = '/api/v2/auth/token/get';
  const ts = Math.floor(Date.now() / 1000);
  const sign = _shopeeSignBase(path, ts);
  const qs = `partner_id=${encodeURIComponent(SHOPEE.PARTNER_ID)}&timestamp=${ts}&sign=${sign}`;
  const res = UrlFetchApp.fetch(`${SHOPEE_DOMAIN}${path}?${qs}`, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ code: code, shop_id: Number(shopId), partner_id: Number(SHOPEE.PARTNER_ID) }),
  });
  const j = JSON.parse(res.getContentText());
  if (!j.access_token) throw new Error('Shopee token: ' + res.getContentText().substring(0, 400));
  j._saved_at = Date.now();
  j.shop_id = shopId;
  PropertiesService.getScriptProperties().setProperty('SHOPEE_TOKEN', JSON.stringify(j));
  return j;
}

// Đổi code thủ công (dán code + shop_id từ URL sau khi authorize)
function shopeeManualExchange() {
  const CODE    = 'DÁN_CODE_VÀO_ĐÂY';
  const SHOP_ID = 'DÁN_SHOP_ID_VÀO_ĐÂY'; // Shopee trả kèm ?shop_id=... trong URL redirect
  try {
    const d = _shopeeExchange(CODE, SHOP_ID);
    Logger.log('✅ Đã kết nối Shopee. shop_id: ' + d.shop_id);
  } catch(e) { Logger.log('❌ ' + e.message); }
}

// Trả access token còn hạn (tự refresh nếu gần hết hạn — Shopee access_token sống 4 giờ)
function shopeeGetToken() {
  const raw = PropertiesService.getScriptProperties().getProperty('SHOPEE_TOKEN');
  if (!raw) throw new Error('Chưa kết nối Shopee — chạy shopeeSetup() và mở link.');
  let t = JSON.parse(raw);
  const ageSec = (Date.now() - (t._saved_at || 0)) / 1000;
  if (ageSec > (t.expire_in || 14400) - 300) {
    const path = '/api/v2/auth/access_token/get';
    const ts = Math.floor(Date.now() / 1000);
    const sign = _shopeeSignBase(path, ts);
    const qs = `partner_id=${encodeURIComponent(SHOPEE.PARTNER_ID)}&timestamp=${ts}&sign=${sign}`;
    const res = UrlFetchApp.fetch(`${SHOPEE_DOMAIN}${path}?${qs}`, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ refresh_token: t.refresh_token, shop_id: Number(t.shop_id), partner_id: Number(SHOPEE.PARTNER_ID) }),
    });
    const j = JSON.parse(res.getContentText());
    if (j.access_token) { j._saved_at = Date.now(); j.shop_id = t.shop_id; t = j;
      PropertiesService.getScriptProperties().setProperty('SHOPEE_TOKEN', JSON.stringify(j)); }
  }
  return t;
}

// GET có ký (dùng cho các API cần access_token/shop_id)
function _shopeeGet(path, extra) {
  const t = shopeeGetToken();
  const ts = Math.floor(Date.now() / 1000);
  const sign = _shopeeSignAuthed(path, ts, t.access_token, t.shop_id);
  const params = Object.assign({
    partner_id: SHOPEE.PARTNER_ID, timestamp: ts, sign: sign,
    access_token: t.access_token, shop_id: t.shop_id,
  }, extra || {});
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = UrlFetchApp.fetch(`${SHOPEE_DOMAIN}${path}?${qs}`, { method: 'get', muteHttpExceptions: true });
  return JSON.parse(res.getContentText());
}

// POST có ký (body JSON)
function _shopeePost(path, extra, bodyObj) {
  const t = shopeeGetToken();
  const ts = Math.floor(Date.now() / 1000);
  const sign = _shopeeSignAuthed(path, ts, t.access_token, t.shop_id);
  const params = Object.assign({
    partner_id: SHOPEE.PARTNER_ID, timestamp: ts, sign: sign,
    access_token: t.access_token, shop_id: t.shop_id,
  }, extra || {});
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = UrlFetchApp.fetch(`${SHOPEE_DOMAIN}${path}?${qs}`, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify(bodyObj || {}),
  });
  return JSON.parse(res.getContentText());
}

// ---- Kiểm tra đã kết nối chưa ----
function shopeeStatus() {
  const raw = PropertiesService.getScriptProperties().getProperty('SHOPEE_TOKEN');
  Logger.log('Shopee: ' + (raw ? '✅ đã kết nối (shop_id: ' + JSON.parse(raw).shop_id + ')' : '❌ chưa'));
}

// ---- Test: lấy tên shop để xác nhận sign đúng ----
function shopeeTestShopInfo() {
  const j = _shopeeGet('/api/v2/shop/get_shop_info', {});
  Logger.log('=== /api/v2/shop/get_shop_info ===\n' + JSON.stringify(j).substring(0, 1500));
}

// ============================================================
// CALLBACK — gọi từ doGet khi Shopee redirect về (?code=&shop_id=)
// ============================================================
function handleShopeeOAuth(e) {
  const p = (e && e.parameter) || {};
  let msg = '';
  try {
    const d = _shopeeExchange(p.code, p.shop_id);
    msg = '✅ Đã kết nối Shopee shop_id: ' + d.shop_id;
  } catch (err) { msg = '❌ Lỗi: ' + err.message; }
  return HtmlService.createHtmlOutput(
    `<div style="font-family:sans-serif;padding:40px;text-align:center">
       <h2>${msg}</h2>
       <p>Bạn có thể đóng tab này và quay lại dashboard.</p>
     </div>`);
}
