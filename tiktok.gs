// ============================================================
// TIKTOK — OAuth + quản lý token (Developer/fanpage + Shop/Seller)
// TIKTOK.* định nghĩa trong config.gs
// ============================================================

// Redirect URI = URL web app đã deploy (phải khớp CHÍNH XÁC với cấu hình trong TikTok app)
// Ưu tiên TIKTOK.REDIRECT_URI (/exec); nếu trống dùng URL hiện tại (có thể là /dev khi chạy editor)
function _ttRedirectUri() {
  if (TIKTOK.REDIRECT_URI && /^https/.test(TIKTOK.REDIRECT_URI)) return TIKTOK.REDIRECT_URI;
  return ScriptApp.getService().getUrl();
}

// ---- Đổi code thủ công (dán code lấy từ URL sau khi authorize) ----
function ttManualExchange() {
  const CODE = 'DÁN_CODE_VÀO_ĐÂY';
  try {
    const d = _ttDevExchange(decodeURIComponent(CODE));
    Logger.log('✅ Đã đổi token. open_id: ' + (d.open_id || '?'));
  } catch(e) { Logger.log('❌ ' + e.message); }
}

// ============================================================
// DỮ LIỆU FANPAGE — cho dashboard (gọi live theo khoảng ngày)
// ============================================================
// from/to: yyyy-MM-dd. end_date phải < hôm nay (tự clamp).
function getTikTokFanpage(from, to) {
  const token  = ttGetDevToken();
  const openId = JSON.parse(PropertiesService.getScriptProperties().getProperty('TT_DEV')).open_id;

  // clamp end_date về hôm qua nếu >= hôm nay (TikTok yêu cầu)
  const yst = new Date(); yst.setDate(yst.getDate() - 1);
  const ystStr = Utilities.formatDate(yst, 'GMT', 'yyyy-MM-dd');
  if (!to || to >= ystStr) to = ystStr;
  if (!from) { const f = new Date(yst); f.setDate(yst.getDate() - 29); from = Utilities.formatDate(f, 'GMT', 'yyyy-MM-dd'); }

  const fields = ["username","display_name","is_verified","followers_count","following_count",
                  "videos_count","total_likes","profile_views","video_views","likes","comments",
                  "shares","engagement_rate","daily_new_followers","daily_lost_followers","daily_total_followers"];
  const url = 'https://business-api.tiktok.com/open_api/v1.3/business/get/'
    + `?business_id=${encodeURIComponent(openId)}`
    + `&fields=${encodeURIComponent(JSON.stringify(fields))}`
    + `&start_date=${from}&end_date=${to}`;
  const res = UrlFetchApp.fetch(url, { headers: { 'Access-Token': token }, muteHttpExceptions: true });
  const j = JSON.parse(res.getContentText());
  if (j.code !== 0) return { error: j.message || 'lỗi', summary: {}, daily: [] };
  const d = j.data || {};
  const daily = (d.metrics || []).map(m => ({
    date: m.date,
    video_views:   Number(m.video_views)   || 0,
    profile_views: Number(m.profile_views) || 0,
    likes:         Number(m.likes)         || 0,
    comments:      Number(m.comments)      || 0,
    shares:        Number(m.shares)        || 0,
    followers:     Number(m.followers_count) || 0,
    new_followers: Number(m.daily_new_followers)  || 0,
    lost_followers:Number(m.daily_lost_followers) || 0,
    net_followers: Number(m.daily_total_followers)|| 0,
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return {
    summary: {
      username:        d.username || '',
      display_name:    d.display_name || '',
      followers_count: Number(d.followers_count) || 0,
      following_count: Number(d.following_count) || 0,
      videos_count:    Number(d.videos_count) || 0,
      total_likes:     Number(d.total_likes) || 0,
      is_verified:     !!d.is_verified,
      engagement_rate: d.engagement_rate || 0,
    },
    daily,
    range: { from, to },
  };
}

// ---- Test lấy dữ liệu fanpage (field đúng + khoảng ngày) ----
function ttTestFanpage() {
  const token  = ttGetDevToken();
  const openId = JSON.parse(PropertiesService.getScriptProperties().getProperty('TT_DEV')).open_id;
  const fmt = d => Utilities.formatDate(d, 'GMT', 'yyyy-MM-dd');
  const to = new Date(); to.setDate(to.getDate() - 1);        // end_date phải < hôm nay
  const from = new Date(to); from.setDate(to.getDate() - 29);

  const fields = ["username","display_name","is_verified","followers_count","following_count",
                  "videos_count","total_likes","profile_views","video_views","likes","comments",
                  "shares","engagement_rate","daily_total_followers","daily_new_followers","daily_lost_followers"];
  const url = 'https://business-api.tiktok.com/open_api/v1.3/business/get/'
    + `?business_id=${encodeURIComponent(openId)}`
    + `&fields=${encodeURIComponent(JSON.stringify(fields))}`
    + `&start_date=${fmt(from)}&end_date=${fmt(to)}`;
  const res = UrlFetchApp.fetch(url, { headers: { 'Access-Token': token }, muteHttpExceptions: true });
  Logger.log('=== business/get ===\nHTTP ' + res.getResponseCode() + '\n' + res.getContentText().substring(0, 3000));
}

// ---- Đổi code TikTok SHOP thủ công (dán code từ URL sau khi authorize shop) ----
function ttShopManualExchange() {
  const CODE = 'DÁN_CODE_SHOP_VÀO_ĐÂY';
  try {
    const d = _ttShopExchange(decodeURIComponent(CODE));
    Logger.log('✅ Đã kết nối Shop. seller: ' + (d.seller_name || d.shop_name || 'OK'));
    Logger.log(JSON.stringify(d).substring(0, 500));
  } catch(e) { Logger.log('❌ ' + e.message); }
}

// ---- Kiểm tra đã kết nối chưa ----
function ttStatus() {
  const dev  = PropertiesService.getScriptProperties().getProperty('TT_DEV');
  const shop = PropertiesService.getScriptProperties().getProperty('TT_SHOP');
  Logger.log('TikTok Developer: ' + (dev  ? '✅ đã kết nối' : '❌ chưa'));
  Logger.log('TikTok Shop:      ' + (shop ? '✅ đã kết nối' : '❌ chưa'));
  if (dev)  Logger.log('  dev open_id: ' + (JSON.parse(dev).open_id || '?'));
  if (shop) { const d = JSON.parse(shop); Logger.log('  shop: ' + (d.seller_name || d.shop_name || '?')); }
}

// ---- In ra thông tin thiết lập: redirect URI + link authorize Developer ----
function ttSetup() {
  const uri = _ttRedirectUri();
  Logger.log('REDIRECT URI (dán vào cả 2 app TikTok):\n' + uri);
  Logger.log('\n--- 1) Authorize FANPAGE (TikTok Developer) — mở link này trên trình duyệt ---');
  Logger.log(ttDevAuthUrl());
  Logger.log('\n--- 2) Authorize SHOP ---');
  Logger.log('Lấy "Authorization URL" trong TikTok Shop Partner Center → mở link đó,');
  Logger.log('đặt Redirect/Callback URL của app = REDIRECT URI ở trên.');
  Logger.log('\n--- 3) Authorize ADS (TikTok Advertiser) — mở link này ---');
  Logger.log(ttAdsAuthUrl());
}

// ============================================================
// A) TIKTOK DEVELOPER (fanpage / content)
// ============================================================
function ttDevAuthUrl() {
  // Scopes phân tích content/fanpage (business/get cần user.insights)
  const scopes = ['user.info.basic','user.info.profile','user.info.stats','user.insights',
                  'video.list','video.insights','biz.creator.insights','biz.creator.info'].join(',');
  const p = {
    client_key:    TIKTOK.DEV_CLIENT_KEY,
    scope:         scopes,
    response_type: 'code',
    redirect_uri:  _ttRedirectUri(),
    state:         'dev',
  };
  const qs = Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return 'https://www.tiktok.com/v2/auth/authorize/?' + qs;
}

// TikTok for Business — token exchange qua business-api (khác Login Kit)
function _ttDevExchange(code) {
  const res = UrlFetchApp.fetch('https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({
      client_id:     TIKTOK.DEV_CLIENT_KEY,
      client_secret: TIKTOK.DEV_CLIENT_SECRET,
      grant_type:    'authorization_code',
      auth_code:     code,
      redirect_uri:  _ttRedirectUri(),
    }),
  });
  const j = JSON.parse(res.getContentText());
  const d = j.data || {};
  if (!d.access_token) throw new Error('Dev token: ' + res.getContentText().substring(0, 400));
  d._saved_at = Date.now();
  PropertiesService.getScriptProperties().setProperty('TT_DEV', JSON.stringify(d));
  return d;
}

// Trả access token còn hạn (tự refresh nếu gần hết hạn)
function ttGetDevToken() {
  const raw = PropertiesService.getScriptProperties().getProperty('TT_DEV');
  if (!raw) throw new Error('Chưa authorize TikTok — chạy ttSetup() và mở link.');
  let t = JSON.parse(raw);
  const ageSec = (Date.now() - (t._saved_at || 0)) / 1000;
  if (ageSec > (t.expires_in || 86400) - 300) {
    const res = UrlFetchApp.fetch('https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({
        client_id: TIKTOK.DEV_CLIENT_KEY, client_secret: TIKTOK.DEV_CLIENT_SECRET,
        grant_type: 'refresh_token', refresh_token: t.refresh_token,
      }),
    });
    const j = JSON.parse(res.getContentText());
    if (j.data && j.data.access_token) { j.data._saved_at = Date.now(); t = j.data;
      PropertiesService.getScriptProperties().setProperty('TT_DEV', JSON.stringify(j.data)); }
  }
  return t.access_token;
}

// ============================================================
// A2) TIKTOK ADS (Marketing API — Advertiser authorization)
// ============================================================
function ttAdsAuthUrl() {
  const p = { app_id: TIKTOK.DEV_CLIENT_KEY, state: 'ads', redirect_uri: _ttRedirectUri() };
  const qs = Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return 'https://business-api.tiktok.com/portal/auth?' + qs;
}

function _ttAdsExchange(authCode) {
  const res = UrlFetchApp.fetch('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({
      app_id: TIKTOK.DEV_CLIENT_KEY, secret: TIKTOK.DEV_CLIENT_SECRET, auth_code: authCode,
    }),
  });
  const j = JSON.parse(res.getContentText());
  const d = j.data || {};
  if (!d.access_token) throw new Error('Ads token: ' + res.getContentText().substring(0, 400));
  PropertiesService.getScriptProperties().setProperty('TT_ADS', JSON.stringify(d));
  return d;   // { access_token, advertiser_ids:[...], scope }
}

function ttGetAdsToken() {
  const raw = PropertiesService.getScriptProperties().getProperty('TT_ADS');
  if (!raw) throw new Error('Chưa authorize TikTok Ads.');
  return JSON.parse(raw).access_token;
}

const TT_ADS_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

function _ttAdsGet(path, params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = UrlFetchApp.fetch(`${TT_ADS_BASE}${path}?${qs}`,
    { headers: { 'Access-Token': ttGetAdsToken() }, muteHttpExceptions: true });
  return JSON.parse(res.getContentText());
}
function _ttAdvIds() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('TT_ADS') || '{}').advertiser_ids || [];
}

// Dò: tên advertiser + thử report campaign (xem metric nào hợp lệ, có GMV Max không)
function ttTestAds() {
  const advIds = _ttAdvIds();
  Logger.log('advertiser_ids: ' + JSON.stringify(advIds));

  const info = _ttAdsGet('/advertiser/info/', {
    advertiser_ids: JSON.stringify(advIds),
    fields: JSON.stringify(["advertiser_id", "name", "currency", "status"]),
  });
  Logger.log('=== advertiser/info ===\n' + JSON.stringify(info).substring(0, 1500));

  const to = new Date(); to.setDate(to.getDate() - 1);
  const from = new Date(to); from.setDate(to.getDate() - 29);
  const f = d => Utilities.formatDate(d, 'GMT', 'yyyy-MM-dd');
  advIds.forEach(adv => {
    const rep = _ttAdsGet('/report/integrated/get/', {
      advertiser_id: adv, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
      dimensions: JSON.stringify(["campaign_id"]),
      metrics: JSON.stringify(["campaign_name","spend","impressions","clicks","ctr","conversion",
                               "onsite_shopping","total_onsite_shopping_value","onsite_shopping_roas"]),
      start_date: f(from), end_date: f(to), page: '1', page_size: '30',
    });
    const list = (rep.data && rep.data.list) || [];
    Logger.log(`\n=== adv ${adv} → ${list.length} campaign (30 ngày) ===`);
    list.slice(0, 5).forEach(r => {
      const m = r.metrics || {};
      Logger.log(`  ${m.campaign_name} | spend=${m.spend} | GMV=${m.total_onsite_shopping_value} | ROAS=${m.onsite_shopping_roas} | shop=${m.onsite_shopping}`);
    });
  });
}

// Dữ liệu Ads cho dashboard: tổng quan campaign + tách riêng GMV Max (theo objective_type)
// advertiserId: '' hoặc bỏ trống = dùng advertiser mặc định (account đang hoạt động)
const TT_DEFAULT_ADVERTISER = '7275258271878332417'; // Fujiwa Vietnam 1

function getTikTokAdvertisers() {
  const advIds = _ttAdvIds();
  if (!advIds.length) return [];
  const j = _ttAdsGet('/advertiser/info/', {
    advertiser_ids: JSON.stringify(advIds),
    fields: JSON.stringify(["advertiser_id", "name", "status"]),
  });
  return (j.data && j.data.list || []).map(a => ({ id: a.advertiser_id, name: a.name, status: a.status }));
}

function getTikTokAds(advertiserId, from, to) {
  const adv = advertiserId || TT_DEFAULT_ADVERTISER;
  const j = _ttAdsGet('/report/integrated/get/', {
    advertiser_id: adv, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
    dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
    metrics: JSON.stringify(["campaign_name","spend","impressions","clicks","ctr","cpc","cpm",
                             "conversion","cost_per_conversion","onsite_shopping",
                             "total_onsite_shopping_value","onsite_shopping_roas"]),
    start_date: from, end_date: to, page: '1', page_size: '1000',
  });
  if (j.code !== 0) return { error: j.message || ('code '+j.code), summary:{}, campaigns:[], gmvMax:{} };

  const list = (j.data && j.data.list) || [];
  const campMap = {};
  
  list.forEach(r => {
    const cid = r.dimensions && r.dimensions.campaign_id;
    if (!cid) return;
    if (!campMap[cid]) campMap[cid] = { id: cid, name: '', spend: 0, impressions: 0, clicks: 0, conversion: 0, gmv: 0, shopOrders: 0, daily: [] };
    
    const m = r.metrics || {};
    const date = r.dimensions.stat_time_day;
    const spend = Number(m.spend)||0;
    const gmv = Number(m.total_onsite_shopping_value)||0;
    
    campMap[cid].name = m.campaign_name || campMap[cid].name;
    campMap[cid].spend += spend;
    campMap[cid].impressions += Number(m.impressions)||0;
    campMap[cid].clicks += Number(m.clicks)||0;
    campMap[cid].conversion += Number(m.conversion)||0;
    campMap[cid].gmv += gmv;
    campMap[cid].shopOrders += Number(m.onsite_shopping)||0;
    
    campMap[cid].daily.push({ date, spend, gmv });
  });
  // Lấy GMV Max (Bổ sung vào campMap)
  try {
    const jStore = _ttAdsGet('/gmv_max/store/list/', { advertiser_id: adv });
    if (jStore.code === 0 && jStore.data && jStore.data.store_list) {
      const storeIds = jStore.data.store_list.map(s => s.store_id).filter(Boolean);
      if (storeIds.length > 0) {
        const jGmv = _ttAdsGet('/gmv_max/report/get/', {
          advertiser_id: adv, start_date: from, end_date: to, page: '1', page_size: '1000',
          store_ids: JSON.stringify(storeIds),
          dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
          metrics: JSON.stringify(["cost","gross_revenue","orders"])
        });
        if (jGmv.code === 0 && jGmv.data && jGmv.data.list) {
          jGmv.data.list.forEach(r => {
            const cid = r.dimensions && r.dimensions.campaign_id;
            if (!cid) return;
            if (!campMap[cid]) campMap[cid] = { id: cid, name: '[GMV Max] ID: ' + cid, spend: 0, impressions: 0, clicks: 0, conversion: 0, gmv: 0, shopOrders: 0, daily: [], isGmvMaxExplicit: true };
            
            const m = r.metrics || {};
            const date = r.dimensions.stat_time_day;
            const cost = Number(m.cost) || 0;
            const rev = Number(m.gross_revenue) || 0;
            const ord = Number(m.orders) || 0;
            
            campMap[cid].spend += cost;
            campMap[cid].gmv += rev;
            campMap[cid].shopOrders += ord;
            campMap[cid].daily.push({ date, spend: cost, gmv: rev });
          });
        }
      }
    }
  } catch (e) {
    Logger.log('Lỗi khi lấy GMV Max qua API mới: ' + e);
  }

  const activeCampIds = Object.keys(campMap);

  const typeMap = {};
  if (activeCampIds.length > 0) {
    // Chia nhỏ mảng IDs ra để tránh lỗi URLFetch URL Length Exceeded (URL quá dài)
    // Tối đa khoảng 30 ID mỗi lần request để đảm bảo an toàn sau khi URL encode
    for (let i = 0; i < activeCampIds.length; i += 30) {
      const chunk = activeCampIds.slice(i, i + 30);
      const typeJ = _ttAdsGet('/campaign/get/', {
        advertiser_id: adv, page: '1', page_size: '100',
        filtering: JSON.stringify({ campaign_ids: chunk }),
        fields: JSON.stringify(["campaign_id","objective_type","campaign_type","campaign_automation_type","is_smart_performance_campaign"]),
      });
      (typeJ.data && typeJ.data.list || []).forEach(c => { typeMap[c.campaign_id] = c; });
    }
  }

  const isGmvMax = cid => {
    const t = typeMap[cid];
    if (!t) return false;
    const obj = String(t.objective_type||'').toUpperCase();
    const ctype = String(t.campaign_type||'').toUpperCase();
    const auto = String(t.campaign_automation_type||'').toUpperCase();
    const isSmartPerf = t.is_smart_performance_campaign === true;
    
    // GMV Max của TikTok là sự kết hợp giữa Product Sales/Shop Purchases và tính năng Smart Automation (Tự động hoá)
    const isProductSales = obj.includes('PRODUCT_SALES') || obj.includes('SHOP_PURCHASES');
    const isSmart = auto.includes('SMART') || auto.includes('ADVANCED') || isSmartPerf;
    
    return (isProductSales && isSmart) || ctype.includes('GMV');
  };


  let tSpend=0,tImpr=0,tClicks=0,tConv=0,tGmv=0,tShopConv=0;
  let gmvSpend=0, gmvGmv=0, gmvOrders=0;
  
  const campaigns = activeCampIds.map(cid => {
    const c = campMap[cid];
    c.ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
    c.roas = c.spend > 0 ? +(c.gmv / c.spend).toFixed(2) : 0;
    c.daily.sort((a,b) => a.date.localeCompare(b.date)); // Sắp xếp daily theo ngày
    
    tSpend += c.spend;
    tImpr += c.impressions;
    tClicks += c.clicks;
    tConv += c.conversion;
    tGmv += c.gmv;
    tShopConv += c.shopOrders;
    
    const gmvMax = c.isGmvMaxExplicit || isGmvMax(cid) || String(c.name||'').toUpperCase().includes('GMV MAX');
    c.gmvMax = gmvMax;
    if (gmvMax) { gmvSpend += c.spend; gmvGmv += c.gmv; gmvOrders += c.shopOrders; }
    
    return c;
  }).sort((a,b) => b.spend - a.spend);

  return {
    summary: { spend:tSpend, impressions:tImpr, clicks:tClicks, conversion:tConv,
               gmv:tGmv, shopOrders:tShopConv, roas: tSpend>0 ? +(tGmv/tSpend).toFixed(2) : 0 },
    gmvMax: { spend:gmvSpend, gmv:gmvGmv, orders:gmvOrders,
              roas: gmvSpend>0 ? +(gmvGmv/gmvSpend).toFixed(2) : 0 },
    campaigns, range: { from, to },
  };
}

// Dò campaign/get để tìm field nhận biết GMV Max (objective_type/campaign_type)
function ttTestAdsCampaignTypes() {
  const adv = '7275258271878332417'; // Fujiwa Vietnam 1 — advertiser đang chạy
  const j = _ttAdsGet('/campaign/get/', {
    advertiser_id: adv, page: '1', page_size: '50',
    fields: JSON.stringify(["campaign_id","campaign_name","objective_type","campaign_type",
                            "budget","operation_status","campaign_automation_type"]),
  });
  Logger.log('=== campaign/get (adv ' + adv + ') ===');
  const list = (j.data && j.data.list) || [];
  if (!list.length) Logger.log(JSON.stringify(j).substring(0, 1500));
  list.forEach(c => Logger.log(
    `${c.campaign_name} | objective=${c.objective_type} | camp_type=${c.campaign_type} | auto_type=${c.campaign_automation_type} | status=${c.operation_status}`
  ));
}

function ttFindTheTruth() {
  const adv = '7275258271878332417'; // Fujiwa Vietnam 1
  const j = _ttAdsGet('/campaign/get/', {
    advertiser_id: adv, page: '1', page_size: '50',
    filtering: JSON.stringify({ primary_status: "STATUS_ALL" }), // Lấy tất cả, không filter tên để xem API trả về gì
  });
  
  // Tìm chính xác bằng API filter
  const j2 = _ttAdsGet('/campaign/get/', {
    advertiser_id: adv, page: '1', page_size: '50',
    filtering: JSON.stringify({ campaign_name: "Fujiwa" }),
  });
  
  Logger.log('=== KẾT QUẢ TÌM KIẾM TRỰC TIẾP TỪ TIKTOK API ===');
  const list = (j2.data && j2.data.list) || [];
  if (list.length === 0) {
    Logger.log('❌ TIKTOK API TRẢ LỜI: KHÔNG TỒN TẠI bất kỳ chiến dịch nào chứa chữ "Fujiwa" trong tài khoản Fujiwa Vietnam 1 (7275258271878332417).');
  } else {
    Logger.log('✅ TÌM THẤY! (Bạn đã đúng, tôi đã sai):');
    list.forEach(c => {
      Logger.log(`${c.campaign_name} | ID=${c.campaign_id} | obj=${c.objective_type} | ctype=${c.campaign_type} | auto=${c.campaign_automation_type}`);
    });
  }
}

function ttTestGmvMaxAPI() {
  const adv = '7275258271878332417'; // Fujiwa Vietnam 1
  
  Logger.log('=== THỬ NGHIỆM ENDPOINT MỚI DÀNH RIÊNG CHO GMV MAX (VÒNG 3) ===');
  
  // 1. Lấy danh sách cửa hàng
  const jStore = _ttAdsGet('/gmv_max/store/list/', {
    advertiser_id: adv
  });
  
  let storeIds = [];
  if (jStore.code === 0 && jStore.data && jStore.data.store_list) {
    storeIds = jStore.data.store_list.map(s => s.store_id).filter(Boolean);
    Logger.log('✅ Đã lấy được danh sách Store ID: ' + JSON.stringify(storeIds));
  } else {
    Logger.log('❌ Lỗi lấy danh sách Store: ' + JSON.stringify(jStore).substring(0, 500));
  }
  
  // 2. Thử gọi lấy report GMV Max
  if (storeIds.length > 0) {
    const to = new Date(); to.setDate(to.getDate() - 1);
    const from = new Date(to); from.setDate(to.getDate() - 7);
    const f = d => Utilities.formatDate(d, 'GMT', 'yyyy-MM-dd');
    
    const j2 = _ttAdsGet('/gmv_max/report/get/', {
      advertiser_id: adv, 
      start_date: f(from), end_date: f(to),
      page: '1', page_size: '50',
      store_ids: JSON.stringify(storeIds),
      dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
      metrics: JSON.stringify(["cost","gross_revenue","orders"])
    });
    
    if (j2.code === 0 && j2.data && j2.data.list && j2.data.list.length > 0) {
      Logger.log('✅ Đã tìm thấy báo cáo GMV MAX (Daily):');
      j2.data.list.forEach(r => {
        const m = r.metrics || {};
        Logger.log(`ID=${r.dimensions.campaign_id} | Day=${r.dimensions.stat_time_day} | RAW_METRICS=${JSON.stringify(m)}`);
      });
    } else {
      Logger.log('❌ Lỗi/Không có data report GMV Max: ' + JSON.stringify(j2).substring(0, 500));
    }
  } else {
    Logger.log('❌ Không có storeIds nên bỏ qua gọi report.');
  }
}

// Đổi code Ads thủ công (dán auth_code từ URL sau khi authorize advertiser)
function ttAdsManualExchange() {
  const CODE = 'DÁN_AUTH_CODE_ADS_VÀO_ĐÂY';
  try {
    const d = _ttAdsExchange(decodeURIComponent(CODE));
    Logger.log('✅ Đã kết nối Ads. advertiser_ids: ' + JSON.stringify(d.advertiser_ids || []));
  } catch(e) { Logger.log('❌ ' + e.message); }
}

// ============================================================
// B) TIKTOK SHOP (Seller Center)
// ============================================================
function _ttShopExchange(authCode) {
  const url = 'https://auth.tiktok-shops.com/api/v2/token/get'
    + `?app_key=${encodeURIComponent(TIKTOK.SHOP_APP_KEY)}`
    + `&app_secret=${encodeURIComponent(TIKTOK.SHOP_APP_SECRET)}`
    + `&auth_code=${encodeURIComponent(authCode)}`
    + `&grant_type=authorized_code`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const j = JSON.parse(res.getContentText());
  if (j.code !== 0 || !j.data) throw new Error('Shop token: ' + res.getContentText().substring(0, 300));
  j.data._saved_at = Date.now();
  PropertiesService.getScriptProperties().setProperty('TT_SHOP', JSON.stringify(j.data));
  return j.data;
}

function ttGetShopToken() {
  const raw = PropertiesService.getScriptProperties().getProperty('TT_SHOP');
  if (!raw) throw new Error('Chưa authorize TikTok Shop.');
  let d = JSON.parse(raw);
  const ageSec = (Date.now() - (d._saved_at || 0)) / 1000;
  if (ageSec > (d.access_token_expire_in ? 0 : 0) + 6 * 86400) { // refresh sau ~6 ngày
    const url = 'https://auth.tiktok-shops.com/api/v2/token/get'
      + `?app_key=${encodeURIComponent(TIKTOK.SHOP_APP_KEY)}`
      + `&app_secret=${encodeURIComponent(TIKTOK.SHOP_APP_SECRET)}`
      + `&refresh_token=${encodeURIComponent(d.refresh_token)}`
      + `&grant_type=refresh_token`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const j = JSON.parse(res.getContentText());
    if (j.code === 0 && j.data) { j.data._saved_at = Date.now(); d = j.data;
      PropertiesService.getScriptProperties().setProperty('TT_SHOP', JSON.stringify(j.data)); }
  }
  return d.access_token;
}

// ============================================================
// TIKTOK SHOP — gọi API có ký HMAC-SHA256 (v2 / 202309)
// ============================================================
const TT_SHOP_DOMAIN = 'https://open-api.tiktokglobalshop.com';

function _ttShopToken() {
  const raw = PropertiesService.getScriptProperties().getProperty('TT_SHOP');
  if (!raw) throw new Error('Chưa kết nối TikTok Shop.');
  return JSON.parse(raw).access_token;
}

function _hexHmac(str, key) {
  const raw = Utilities.computeHmacSha256Signature(str, key);
  return raw.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

// Chữ ký TikTok Shop: app_secret + path + (sorted key+value) + body + app_secret → HMAC-SHA256 hex
function _ttShopSign(path, params, body) {
  const keys = Object.keys(params).filter(k => k !== 'sign' && k !== 'access_token').sort();
  let s = path + keys.map(k => k + params[k]).join('');
  if (body) s += body;
  s = TIKTOK.SHOP_APP_SECRET + s + TIKTOK.SHOP_APP_SECRET;
  return _hexHmac(s, TIKTOK.SHOP_APP_SECRET);
}

// GET có ký. extra = query params thêm (vd shop_cipher, page_size...)
function _ttShopGet(path, extra, maxRetries = 2) {
  let attempts = 0;
  while (attempts <= maxRetries) {
    const params = Object.assign({
      app_key:   TIKTOK.SHOP_APP_KEY,
      timestamp: String(Math.floor(Date.now() / 1000)),
    }, extra || {});
    params.sign = _ttShopSign(path, params, '');
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const res = UrlFetchApp.fetch(`${TT_SHOP_DOMAIN}${path}?${qs}`, {
      method: 'get', muteHttpExceptions: true,
      headers: { 'x-tts-access-token': _ttShopToken(), 'content-type': 'application/json' },
    });
    
    const json = JSON.parse(res.getContentText());
    
    // Nếu request timeout hoặc mã lỗi nội bộ từ TikTok, thử lại sau 2 giây
    if (json.code !== 0 && (json.message || "").toLowerCase().includes("timeout") && attempts < maxRetries) {
      attempts++;
      Utilities.sleep(2000);
      continue;
    }
    
    return json;
  }
}

// POST có ký (body JSON)
function _ttShopPost(path, extra, bodyObj) {
  const body = JSON.stringify(bodyObj || {});
  const params = Object.assign({
    app_key:   TIKTOK.SHOP_APP_KEY,
    timestamp: String(Math.floor(Date.now() / 1000)),
  }, extra || {});
  params.sign = _ttShopSign(path, params, body);
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = UrlFetchApp.fetch(`${TT_SHOP_DOMAIN}${path}?${qs}`, {
    method: 'post', muteHttpExceptions: true, payload: body,
    headers: { 'x-tts-access-token': _ttShopToken(), 'content-type': 'application/json' },
  });
  return JSON.parse(res.getContentText());
}

// Lấy shop_cipher + shop_id (lưu vào TT_SHOP để dùng cho các call sau)
function ttTestShop() {
  const j = _ttShopGet('/authorization/202309/shops', {});
  Logger.log('=== /authorization/202309/shops ===');
  Logger.log(JSON.stringify(j, null, 2).substring(0, 2000));
  const shop = j.data && j.data.shops && j.data.shops[0];
  if (shop) {
    const raw = JSON.parse(PropertiesService.getScriptProperties().getProperty('TT_SHOP'));
    raw.shop_cipher = shop.cipher;
    raw.shop_id     = shop.id;
    raw.shop_name   = shop.name;
    PropertiesService.getScriptProperties().setProperty('TT_SHOP', JSON.stringify(raw));
    Logger.log(`✅ Đã lưu shop: ${shop.name} | cipher=${shop.cipher} | id=${shop.id}`);
  }
}

function _ttShopCipher() {
  const raw = JSON.parse(PropertiesService.getScriptProperties().getProperty('TT_SHOP') || '{}');
  if (!raw.shop_cipher) throw new Error('Chưa có shop_cipher — chạy ttTestShop() trước.');
  return raw.shop_cipher;
}

function _addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return Utilities.formatDate(d, 'GMT', 'yyyy-MM-dd');
}

// Dữ liệu Shop cho dashboard qua Analytics API: GMV + breakdown nguồn (Live/Video/Card) + daily
function getTikTokShop(from, to) {
  const cipher = _ttShopCipher();
  
  let gmv = 0, orders = 0, buyers = 0, units = 0, refunds = 0, visitors = 0, impressions = 0;
  const bySrcG = {}, bySrcB = {};
  const daily = [];
  let latest = '';
  
  // Cắt thành các khúc 7 ngày để tránh Timeout từ TikTok
  let currentFrom = new Date(from + 'T00:00:00Z');
  const finalTo = new Date(to + 'T00:00:00Z');
  
  while (currentFrom <= finalTo) {
    let currentTo = new Date(currentFrom);
    currentTo.setUTCDate(currentTo.getUTCDate() + 7);
    if (currentTo > finalTo) currentTo = new Date(finalTo);
    
    const chunkFromStr = Utilities.formatDate(currentFrom, 'GMT', 'yyyy-MM-dd');
    const chunkToStr = Utilities.formatDate(currentTo, 'GMT', 'yyyy-MM-dd');
    const endLt = _addDays(chunkToStr, 1);
    
    const j = _ttShopGet('/analytics/202405/shop/performance', {
      shop_cipher: cipher, start_date_ge: chunkFromStr, end_date_lt: endLt,
      currency: 'LOCAL', granularity: '1D',
    });
    
    if (j.code !== 0) return { error: j.message || ('code ' + j.code), summary: {}, bySource: {}, daily: [] };
    
    latest = j.data && j.data.latest_available_date || latest;
    const intervals = (j.data && j.data.performance && j.data.performance.intervals) || [];
    
    intervals.forEach(iv => {
      const g = Number(iv.gmv && iv.gmv.amount) || 0;
      gmv += g;
      orders     += Number(iv.orders) || 0;
      buyers     += Number(iv.buyers) || 0;
      units      += Number(iv.units_sold) || 0;
      refunds    += Number(iv.refunds && iv.refunds.amount) || 0;
      visitors   += Number(iv.avg_product_page_visitors) || 0;
      impressions+= Number(iv.product_impressions) || 0;
      (iv.gmv_breakdowns   || []).forEach(b => { bySrcG[b.type] = (bySrcG[b.type] || 0) + Number(b.amount || 0); });
      (iv.buyer_breakdowns || []).forEach(b => { bySrcB[b.type] = (bySrcB[b.type] || 0) + Number(b.amount || 0); });
      daily.push({ date: iv.start_date || iv.end_date, gmv: g, orders: Number(iv.orders) || 0 });
    });
    
    currentFrom = new Date(currentTo);
    currentFrom.setUTCDate(currentFrom.getUTCDate() + 1);
  }
  
  daily.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const rawShop = JSON.parse(PropertiesService.getScriptProperties().getProperty('TT_SHOP') || '{}');

  return {
    summary: {
      gmv, orders, buyers, units, refunds, impressions,
      aov: orders > 0 ? Math.round(gmv / orders) : 0,
      currency: 'VND',
      latest,
    },
    bySourceGmv:   bySrcG,   // { LIVE, VIDEO, PRODUCT_CARD }
    bySourceBuyer: bySrcB,
    daily,
    seller_name: rawShop.shop_name || rawShop.seller_name || '',
    range: { from, to },
  };
}

// Xem full response shop/performance (currency=LOCAL) + thử breakdown theo nguồn
function ttTestShopAnalytics() {
  const cipher = _ttShopCipher();
  const to = new Date(); to.setDate(to.getDate() - 1);
  const from = new Date(to); from.setDate(to.getDate() - 6);
  const f = d => Utilities.formatDate(d, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  const base = { shop_cipher: cipher, start_date_ge: f(from), end_date_lt: f(to), currency: 'LOCAL' };

  // 1) Tổng quan
  Logger.log('=== shop/performance (LOCAL) ===');
  Logger.log(JSON.stringify(_ttShopGet('/analytics/202405/shop/performance', base)).substring(0, 2500));

  // 2) Thử breakdown theo loại nội dung (Live/Video/Card...)
  ['GMV', 'gmv'].forEach(() => {});
  [
    { ...base, breakdowns: 'gmv_breakdowns' },
    { ...base, request_option: 'gmv_breakdowns' },
  ].forEach((ex, i) => {
    try {
      const j = _ttShopGet('/analytics/202405/shop/performance', ex);
      Logger.log('=== breakdown thử ' + (i+1) + ' ===\n' + JSON.stringify(j).substring(0, 1500));
    } catch(e) { Logger.log('breakdown ' + (i+1) + ' lỗi: ' + e.message); }
  });
}

// Test lấy đơn hàng 7 ngày gần nhất
function ttTestOrders() {
  const now  = Math.floor(Date.now() / 1000);
  const from = now - 7 * 86400;
  const j = _ttShopPost('/order/202309/orders/search',
    { shop_cipher: _ttShopCipher(), page_size: '10' },
    { create_time_ge: from, create_time_lt: now });
  Logger.log('=== orders/search (7 ngày) ===');
  Logger.log(JSON.stringify(j, null, 2).substring(0, 3500));
}

// ============================================================
// CALLBACK — gọi từ doGet khi TikTok redirect về (có ?code=)
// ============================================================
function handleTikTokOAuth(e) {
  const p = (e && e.parameter) || {};
  let msg = '';
  try {
    if (p.app_key) {                              // TikTok Shop (kèm app_key)
      const d = _ttShopExchange(p.code);
      msg = '✅ Đã kết nối TikTok Shop: ' + (d.seller_name || d.shop_name || 'OK');
    } else if (p.state === 'ads' || p.auth_code) { // Ads (Advertiser) — trả auth_code
      const d = _ttAdsExchange(p.auth_code || p.code);
      msg = '✅ Đã kết nối TikTok Ads. advertiser_ids: ' + JSON.stringify(d.advertiser_ids || []);
    } else {                                       // Developer/fanpage (state=dev)
      const t = _ttDevExchange(p.code);
      msg = '✅ Đã kết nối TikTok Developer (open_id: ' + (t.open_id || 'OK') + ')';
    }
  } catch (err) { msg = '❌ Lỗi: ' + err.message; }

  return HtmlService.createHtmlOutput(
    `<div style="font-family:sans-serif;padding:40px;text-align:center">
       <h2>${msg}</h2>
       <p>Bạn có thể đóng tab này và quay lại dashboard.</p>
     </div>`);
}

// ============================================================
// ĐỒNG BỘ DỮ LIỆU TIKTOK XUỐNG GOOGLE SHEETS
// ============================================================

function syncTikTokAds() {
  const from = new Date(); from.setDate(from.getDate() - 30);
  const to = new Date(); to.setDate(to.getDate() - 1);
  const fromStr = Utilities.formatDate(from, 'GMT', 'yyyy-MM-dd');
  const toStr = Utilities.formatDate(to, 'GMT', 'yyyy-MM-dd');
  
  const headers = ["date", "advertiser", "campaign_id", "campaign_name", "objective_type", "campaign_type", "is_smart", "spend", "impressions", "clicks", "conversion", "shop_orders", "gmv", "is_gmv_max_explicit"];
  const allRows = [];
  
  const advs = getTikTokAdvertisers();
  if (!advs.length) advs.push({ id: TT_DEFAULT_ADVERTISER, name: 'Default' });
  
  advs.forEach(adv => {
    try {
      const j = _ttAdsGet('/report/integrated/get/', {
        advertiser_id: adv.id, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
        metrics: JSON.stringify(["campaign_name","spend","impressions","clicks","ctr","cpc","cpm",
                                 "conversion","cost_per_conversion","onsite_shopping",
                                 "total_onsite_shopping_value","onsite_shopping_roas"]),
        start_date: fromStr, end_date: toStr, page: '1', page_size: '1000',
      });
      if (j.code !== 0) throw new Error(j.message);
      const list = (j.data && j.data.list) || [];
      
      const cids = Array.from(new Set(list.map(r => r.dimensions && r.dimensions.campaign_id).filter(Boolean)));
      const typeMap = {};
      for (let i = 0; i < cids.length; i += 30) {
        const chunk = cids.slice(i, i + 30);
        const typeJ = _ttAdsGet('/campaign/get/', {
          advertiser_id: adv.id, page: '1', page_size: '100',
          filtering: JSON.stringify({ campaign_ids: chunk }),
          fields: JSON.stringify(["campaign_id","objective_type","campaign_type","campaign_automation_type","is_smart_performance_campaign"]),
        });
        (typeJ.data && typeJ.data.list || []).forEach(c => { typeMap[c.campaign_id] = c; });
      }
      
      list.forEach(r => {
        const cid = r.dimensions.campaign_id;
        const m = r.metrics || {};
        const t = typeMap[cid] || {};
        const isSmart = String(t.campaign_automation_type||'').toUpperCase().includes('SMART') || t.is_smart_performance_campaign === true;
        const obj = String(t.objective_type||'').toUpperCase();
        const ctype = String(t.campaign_type||'').toUpperCase();
        const isProductSales = obj.includes('PRODUCT_SALES') || obj.includes('SHOP_PURCHASES');
        const isGmvMax = ((isProductSales && isSmart) || ctype.includes('GMV') || String(m.campaign_name||'').toUpperCase().includes('GMV MAX')) ? 1 : 0;
        
        allRows.push([
          r.dimensions.stat_time_day, adv.name, cid, m.campaign_name || '', t.objective_type || '', t.campaign_type || '', isSmart ? 1 : 0,
          Number(m.spend) || 0, Number(m.impressions) || 0, Number(m.clicks) || 0, Number(m.conversion) || 0,
          Number(m.onsite_shopping) || 0, Number(m.total_onsite_shopping_value) || 0, isGmvMax
        ]);
      });
      
      const jStore = _ttAdsGet('/gmv_max/store/list/', { advertiser_id: adv.id });
      if (jStore.code === 0 && jStore.data && jStore.data.store_list) {
        const storeIds = jStore.data.store_list.map(s => s.store_id).filter(Boolean);
        if (storeIds.length > 0) {
          const jGmv = _ttAdsGet('/gmv_max/report/get/', {
            advertiser_id: adv.id, start_date: fromStr, end_date: toStr, page: '1', page_size: '1000',
            store_ids: JSON.stringify(storeIds),
            dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
            metrics: JSON.stringify(["cost","gross_revenue","orders"])
          });
          if (jGmv.code === 0 && jGmv.data && jGmv.data.list) {
            jGmv.data.list.forEach(r => {
              const cid = r.dimensions.campaign_id;
              const m = r.metrics || {};
              allRows.push([
                r.dimensions.stat_time_day, adv.name, cid, '[GMV Max] ID: ' + cid, '', '', 0,
                Number(m.cost) || 0, 0, 0, 0, Number(m.orders) || 0, Number(m.gross_revenue) || 0, 1
              ]);
            });
          }
        }
      }
    } catch(e) { throw new Error(`Lỗi sync TikTok Ads (${adv.name}): ` + e.message); }
  });
  
  writeSheet("TikTok Ads Data", headers, allRows);
  return `${allRows.length} rows`;
}

function syncTikTokShop() {
  const from = new Date(); from.setDate(from.getDate() - 30);
  const to = new Date(); to.setDate(to.getDate() - 1);
  const fromStr = Utilities.formatDate(from, 'GMT', 'yyyy-MM-dd');
  const toStr = Utilities.formatDate(to, 'GMT', 'yyyy-MM-dd');
  const endLt = Utilities.formatDate(new Date(to.getTime() + 86400000), 'GMT', 'yyyy-MM-dd');
  
  const headers = ["date", "gmv", "orders", "buyers", "units", "refunds", "live_gmv", "video_gmv", "card_gmv", "others_gmv"];
  const allRows = [];
  
  try {
    const cipher = _ttShopCipher();
    const j = _ttShopGet('/analytics/202405/shop/performance', {
      shop_cipher: cipher, start_date_ge: fromStr, end_date_lt: endLt,
      currency: 'LOCAL', granularity: '1D',
    });
    if (j.code !== 0) throw new Error(j.message);
    
    const intervals = (j.data && j.data.performance && j.data.performance.intervals) || [];
    intervals.forEach(iv => {
      const g = Number(iv.gmv && iv.gmv.amount) || 0;
      const bySrcG = {};
      (iv.gmv_breakdowns || []).forEach(b => { bySrcG[b.type] = Number(b.amount || 0); });
      
      allRows.push([
        iv.start_date || iv.end_date,
        g,
        Number(iv.orders) || 0,
        Number(iv.buyers) || 0,
        Number(iv.units_sold) || 0,
        Number(iv.refunds && iv.refunds.amount) || 0,
        bySrcG['LIVE'] || 0,
        bySrcG['VIDEO'] || 0,
        bySrcG['PRODUCT_CARD'] || 0,
        bySrcG['OTHERS'] || 0
      ]);
    });
  } catch(e) { throw new Error("Lỗi sync TikTok Shop: " + e.message); }
  
  writeSheet("TikTok Shop Data", headers, allRows);
  return `${allRows.length} rows`;
}

function syncTikTokPage() {
  const from = new Date(); from.setDate(from.getDate() - 30);
  const to = new Date(); to.setDate(to.getDate() - 1);
  const fromStr = Utilities.formatDate(from, 'GMT', 'yyyy-MM-dd');
  const toStr = Utilities.formatDate(to, 'GMT', 'yyyy-MM-dd');
  
  const headers = ["date", "video_views", "profile_views", "likes", "comments", "shares", "new_followers", "lost_followers", "total_followers"];
  const allRows = [];
  
  try {
    const data = getTikTokFanpage(fromStr, toStr);
    if (data.error) throw new Error(data.error);
    
    (data.daily || []).forEach(d => {
      allRows.push([
        d.date, d.video_views, d.profile_views, d.likes, d.comments, d.shares, d.new_followers, d.lost_followers, d.followers
      ]);
    });
  } catch(e) { throw new Error("Lỗi sync TikTok Page: " + e.message); }
  
  writeSheet("TikTok Page Data", headers, allRows);
  return `${allRows.length} rows`;
}

function syncTikTokAll() {
  const log = [];
  const run = (label, fn) => {
    try   { log.push(`${label}: ${fn()}`); }
    catch (e) { log.push(`${label} lỗi: ${e.message}`); }
  };
  
  run("TT Ads",    syncTikTokAds);
  run("TT Shop",   syncTikTokShop);
  run("TT Page",   syncTikTokPage);
  
  const msg = "✅ syncTikTokAll — " + new Date().toLocaleString("vi-VN") + "\n" + log.join("\n");
  Logger.log(msg);
  return msg;
}



