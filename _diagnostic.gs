function diagByAccount() {
  const raw = PropertiesService.getScriptProperties().getProperty('ADS_CONV_STATS');
  Logger.log('=== ADS_CONV_STATS (raw) ===');
  Logger.log(raw);
}

// Xem raw response của posts API (kèm insights + reactions/comments/shares)
function diagPostsRaw() {
  let pt = CFG.PAGE_TOKEN;
  try {
    const info = JSON.parse(UrlFetchApp.fetch(
      `${BASE_URL}/${CFG.PAGE_ID}?fields=access_token&access_token=${encodeURIComponent(CFG.TOKEN)}`,
      { muteHttpExceptions: true }).getContentText());
    if (info.access_token) { pt = info.access_token; Logger.log('→ dùng page token tươi'); }
    else Logger.log('→ không lấy được token tươi: ' + JSON.stringify(info).substring(0,300));
  } catch(e) { Logger.log('lấy token tươi lỗi: ' + e.message); }

  const url = `${BASE_URL}/${CFG.PAGE_ID}/posts`;
  const fields = "id,message,created_time,shares," +
    "reactions.summary(true).limit(0)," +
    "comments.summary(true).limit(0)," +
    "insights.metric(post_impressions,post_impressions_unique,post_engaged_users,post_clicks)";
  const qs = `access_token=${encodeURIComponent(pt)}&limit=2&fields=${encodeURIComponent(fields)}`;
  const res = UrlFetchApp.fetch(`${url}?${qs}`, { muteHttpExceptions: true });
  Logger.log('HTTP ' + res.getResponseCode());
  Logger.log(res.getContentText().substring(0, 4000));
}

// Liệt kê các Page mà token truy cập được (kèm page token riêng) qua /me/accounts
function diagListPages() {
  [['CFG.TOKEN', CFG.TOKEN], ['CFG.PAGE_TOKEN', CFG.PAGE_TOKEN]].forEach(([label, tk]) => {
    Logger.log('======== ' + label + ' → /me/accounts ========');
    try {
      const res = UrlFetchApp.fetch(
        `${BASE_URL}/me/accounts?fields=id,name,access_token,tasks&limit=100&access_token=${encodeURIComponent(tk)}`,
        { muteHttpExceptions: true });
      const j = JSON.parse(res.getContentText());
      if (j.error) { Logger.log('lỗi: ' + j.error.message); return; }
      (j.data || []).forEach(p => Logger.log(`${p.id} | ${p.name} | token:${p.access_token?'CÓ':'—'} | tasks:${(p.tasks||[]).join(',')}`));
      if (!(j.data||[]).length) Logger.log('(không có page nào)');
    } catch(e) { Logger.log('lỗi: ' + e.message); }
  });
}

// Thử đọc name + posts của 1 page bằng CFG.TOKEN trực tiếp (system user token)
function diagPageDirect() {
  const PID = CFG.PAGE_ID;
  ['name', 'posts.limit(1){id,message}'].forEach(f => {
    const res = UrlFetchApp.fetch(
      `${BASE_URL}/${PID}?fields=${encodeURIComponent(f)}&access_token=${encodeURIComponent(CFG.TOKEN)}`,
      { muteHttpExceptions: true });
    Logger.log(`[${f}] HTTP ${res.getResponseCode()} → ${res.getContentText().substring(0,500)}`);
  });
}

// Test TỪNG post insights metric để biết cái nào Facebook còn cho phép
function diagPostMetrics() {
  const pt = _pageTokenFor(CFG.PAGE_ID);
  // Lấy 1 post id
  const p = apiGet(`${BASE_URL}/${CFG.PAGE_ID}/posts`, { access_token: pt, fields: "id", limit: "1" });
  const postId = p.data?.[0]?.id;
  if (!postId) { Logger.log('Không có post nào'); return; }
  Logger.log('Test trên post: ' + postId);

  const metrics = [
    "post_impressions", "post_impressions_unique",
    "post_impressions_organic", "post_impressions_paid",
    "post_clicks", "post_clicks_by_type",
    "post_reactions_by_type_total",
    "post_reactions_like_total",
    "post_video_views", "post_video_views_organic",
    "post_engaged_users", "post_engagements", "post_activity",
  ];
  const ok = [], fail = [];
  metrics.forEach(m => {
    const res = UrlFetchApp.fetch(
      `${BASE_URL}/${postId}/insights?metric=${m}&access_token=${encodeURIComponent(pt)}`,
      { muteHttpExceptions: true });
    const j = JSON.parse(res.getContentText());
    if (j.error) fail.push(`❌ ${m}`);
    else { const v = j.data?.[0]?.values?.[0]?.value; ok.push(`✅ ${m} = ${JSON.stringify(v)}`); }
  });
  Logger.log('=== METRIC DÙNG ĐƯỢC ===\n' + ok.join('\n'));
  Logger.log('=== BỊ CHẶN ===\n' + fail.join('\n'));
}

// Test page-level metrics (impressions/reach toàn page) — cái nào còn dùng được
function diagPageMetrics() {
  const pt = _pageTokenFor(CFG.PAGE_ID);
  const since = Math.floor((Date.now() - 30*864e5)/1000).toString();
  const until = Math.floor(Date.now()/1000).toString();
  const metrics = [
    "page_impressions", "page_impressions_unique",
    "page_impressions_organic_unique", "page_impressions_paid",
    "page_posts_impressions", "page_posts_impressions_unique",
    "page_post_engagements", "page_views_total",
    "page_fans", "page_fan_adds", "page_fan_adds_unique",
    "page_daily_follows", "page_follows",
    "page_actions_post_reactions_total",
  ];
  const ok = [], fail = [];
  metrics.forEach(m => {
    const res = UrlFetchApp.fetch(
      `${BASE_URL}/${CFG.PAGE_ID}/insights?metric=${m}&period=day&since=${since}&until=${until}&access_token=${encodeURIComponent(pt)}`,
      { muteHttpExceptions: true });
    const j = JSON.parse(res.getContentText());
    if (j.error) { fail.push(`❌ ${m}`); return; }
    const vals = j.data?.[0]?.values || [];
    const total = vals.reduce((s,v)=> s + (typeof v.value==='number'? v.value : 0), 0);
    ok.push(`✅ ${m} | tổng 30 ngày = ${total} (${vals.length} ngày)`);
  });
  Logger.log('=== PAGE METRIC DÙNG ĐƯỢC ===\n' + ok.join('\n'));
  Logger.log('=== BỊ CHẶN ===\n' + fail.join('\n'));
}

// Chạy trực tiếp syncPosts, in kết quả/lỗi
function diagRunSyncPosts() {
  try { Logger.log('syncPosts OK: ' + syncPosts()); }
  catch(e) { Logger.log('syncPosts LỖI: ' + e.message); }
}

// Kiểm tra quyền (scopes) của access token đang dùng
function diagTokenScopes() {
  _inspectToken('CFG.TOKEN (token chính)', CFG.TOKEN);
  if (CFG.PAGE_TOKEN && CFG.PAGE_TOKEN !== CFG.TOKEN) {
    Logger.log('');
    _inspectToken('CFG.PAGE_TOKEN (token trang)', CFG.PAGE_TOKEN);
  }
}

function _inspectToken(label, token) {
  Logger.log('======== ' + label + ' ========');

  // 1) debug_token: app_id, loại token, hạn dùng, scopes
  try {
    const r = UrlFetchApp.fetch(
      `${BASE_URL}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
      { muteHttpExceptions: true });
    const j = JSON.parse(r.getContentText());
    const d = j.data || {};
    Logger.log('app_id      : ' + (d.app_id || '?'));
    Logger.log('type        : ' + (d.type || '?'));
    Logger.log('valid       : ' + d.is_valid);
    Logger.log('expires_at  : ' + (d.expires_at ? new Date(d.expires_at*1000).toLocaleString('vi-VN') : '?')
                                 + (d.expires_at === 0 ? ' (không hết hạn)' : ''));
    Logger.log('data_access_expires_at: ' + (d.data_access_expires_at ? new Date(d.data_access_expires_at*1000).toLocaleString('vi-VN') : '?'));
    Logger.log('SCOPES      : ' + ((d.scopes || []).join(', ') || '(không có)'));
    if (d.granular_scopes) {
      Logger.log('--- granular_scopes (quyền + phạm vi tài nguyên) ---');
      d.granular_scopes.forEach(g => {
        Logger.log('  • ' + g.scope + (g.target_ids ? ' → ' + g.target_ids.join(', ') : ' → (tất cả)'));
      });
    }
    if (d.error) Logger.log('debug_token error: ' + JSON.stringify(d.error));
  } catch(e) { Logger.log('debug_token lỗi: ' + e.message); }

  // 2) /me/permissions: danh sách quyền đã cấp / bị từ chối
  try {
    const r2 = UrlFetchApp.fetch(
      `${BASE_URL}/me/permissions?access_token=${encodeURIComponent(token)}`,
      { muteHttpExceptions: true });
    const j2 = JSON.parse(r2.getContentText());
    if (j2.data) {
      const granted  = j2.data.filter(p => p.status === 'granted').map(p => p.permission);
      const declined = j2.data.filter(p => p.status !== 'granted').map(p => p.permission + '(' + p.status + ')');
      Logger.log('GRANTED     : ' + (granted.join(', ')  || '(không có)'));
      if (declined.length) Logger.log('DECLINED    : ' + declined.join(', '));
    } else if (j2.error) {
      Logger.log('/me/permissions: ' + j2.error.message + ' (token hệ thống/không phải user thì không có endpoint này)');
    }
  } catch(e) { Logger.log('/me/permissions lỗi: ' + e.message); }
}

// Dedup người liên hệ nhắn tin theo TỪNG TRANG, dùng Batch API (tránh lỗi URL dài)
function diagPageDedupBatch() {
  const from = '2026-06-02';
  const to   = '2026-07-01';
  const r = _computePageMsgDedup(from, to);
  Logger.log('=== DEDUP THEO TRANG (' + from + ' → ' + to + ') ===');
  Logger.log('(c = Messaging contacts, n = New messaging contacts, d = Gửi ≥3 tin)');
  Object.keys(r.byPage).forEach(p => Logger.log(`[${p}] c=${r.byPage[p].c}  n=${r.byPage[p].n}  d=${r.byPage[p].d}`));
  Logger.log('--- Theo tài khoản ---');
  Object.keys(r.byAccount).forEach(a => Logger.log(`[${a}] c=${r.byAccount[a].c}  n=${r.byAccount[a].n}  d=${r.byAccount[a].d}`));
  Logger.log(`>>> TỔNG: contacts=${r.total.c}  new=${r.total.n}  depth3=${r.total.d}`);
}
// _computePageMsgDedup + getPageMsgDedup đã chuyển sang meta.gs (dùng chung, tránh trùng định nghĩa)

// Tra tên page 497... bằng nhiều cách để biết vì sao không gộp được
function diagPageName() {
  const PID = '497184357695598';
  const tries = [
    ['CFG.TOKEN, GET name',        `${BASE_URL}/${PID}?fields=name&access_token=${encodeURIComponent(CFG.TOKEN)}`],
    ['CFG.PAGE_TOKEN, GET name',   `${BASE_URL}/${PID}?fields=name&access_token=${encodeURIComponent(CFG.PAGE_TOKEN)}`],
  ];
  tries.forEach(([label, url]) => {
    try {
      const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      Logger.log(`[${label}] HTTP ${r.getResponseCode()} → ${r.getContentText()}`);
    } catch(e) { Logger.log(`[${label}] lỗi: ${e.message}`); }
  });

  // Xem tất cả page_id + page_name trong Ad Creatives (để biết id nào tên FUJIWA VIETNAM)
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const cr = ss.getSheetByName('Ad Creatives');
  const cv = cr.getRange(1,1,cr.getLastRow(),cr.getLastColumn()).getValues();
  const cH = cv[0], iPid = cH.indexOf('page_id'), iPn = cH.indexOf('page_name');
  const seen = {};
  cv.slice(1).forEach(row => {
    const pid = String(row[iPid]||'').trim(), pn = String(row[iPn]||'').trim();
    if (pid) seen[pid] = pn;
  });
  Logger.log('--- page_id → page_name trong Ad Creatives ---');
  Object.keys(seen).forEach(pid => Logger.log(`${pid} → "${seen[pid]}"`));
}

// Kiểm tra dữ liệu messaging_reply trong sheet "Ads Data" (30 ngày sync)
function diagAdsMessaging() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName('Ads Data');
  const v  = sh.getRange(1,1,sh.getLastRow(),sh.getLastColumn()).getValues();
  const h  = v[0];
  const iMsg  = h.indexOf('messaging_reply');
  const iDate = h.indexOf('date');
  const iCamp = h.indexOf('campaign');
  Logger.log('headers: ' + h.join(', '));
  Logger.log('index messaging_reply = ' + iMsg);
  let total = 0, nonZero = 0;
  v.slice(1).forEach(r => {
    const m = Number(r[iMsg]) || 0;
    total += m; if (m > 0) nonZero++;
  });
  Logger.log(`Tổng messaging_reply (tất cả dòng) = ${total}, số dòng > 0 = ${nonZero}`);
  // Vài dòng mẫu
  v.slice(1, 6).forEach(r => Logger.log(`${r[iDate]} | ${r[iCamp]} | msg=${r[iMsg]}`));
}

// Kiểm tra getAdsDaily + AD_ACCOUNTS chạy được không (chạy từ editor)
function testGetAdsDaily() {
  Logger.log('typeof AD_ACCOUNTS = ' + (typeof AD_ACCOUNTS));
  try { Logger.log('AD_ACCOUNTS = ' + JSON.stringify(AD_ACCOUNTS)); }
  catch(e) { Logger.log('AD_ACCOUNTS lỗi: ' + e.message); }

  try {
    const r = getAdsDaily('2026-06-02', '2026-07-01', '');
    Logger.log('getAdsDaily OK — ' + r.rows.length + ' dòng');
  } catch(e) {
    Logger.log('getAdsDaily lỗi: ' + e.message);
  }
}

// Tính người liên hệ (dedup, đã lọc campaign) cho TẤT CẢ trang
function testAllPagesFiltered() {
  const from = '2026-06-02';
  const to   = '2026-07-01';

  const accounts = [
    { id: 'act_208110432165351', name: 'Fujiwa Ads 14' },
    { id: 'act_575643551319198', name: 'Fujiwa Ads 15' },
  ];

  function extractPageId(ad) {
    const s = ad.effective_object_story_id || '';
    if (s) return s.split('_')[0];
    const spec = ad.creative && ad.creative.object_story_spec;
    if (spec && spec.page_id) return spec.page_id;
    if (ad.creative && ad.creative.actor_id) return ad.creative.actor_id;
    return '';
  }

  // pageId -> tên (từ Ad Creatives sheet)
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const cr  = ss.getSheetByName('Ad Creatives');
  const cv  = cr.getRange(1,1,cr.getLastRow(),cr.getLastColumn()).getValues();
  const cH  = cv[0];
  const cPidI = cH.indexOf('page_id'), cPnI = cH.indexOf('page_name');
  const pidName = {};
  cv.slice(1).forEach(r => {
    const pid = String(r[cPidI]||'').trim();
    if (pid) pidName[pid] = String(r[cPnI]||pid).trim();
  });

  // pageId -> { accountId -> Set(campaignId) }
  const pageMap = {};
  accounts.forEach(acct => {
    const ads = fetchPaged(`${BASE_URL}/${acct.id}/ads`, {
      access_token: CFG.TOKEN,
      fields: 'campaign{id,name},effective_object_story_id,creative{object_story_spec{page_id},actor_id}',
      limit: '200',
    }, 10);
    ads.forEach(ad => {
      const pid = extractPageId(ad);
      if (!pid || !ad.campaign || !ad.campaign.id) return;
      pageMap[pid] = pageMap[pid] || {};
      pageMap[pid][acct.id] = pageMap[pid][acct.id] || new Set();
      pageMap[pid][acct.id].add(ad.campaign.id);
    });
  });

  // POST để tránh giới hạn độ dài URL khi filtering có nhiều campaign id
  function insightsFilteredPOST(acctId, campIds) {
    const res = UrlFetchApp.fetch(`${BASE_URL}/${acctId}/insights`, {
      method: 'post',
      muteHttpExceptions: true,
      payload: {
        access_token: CFG.TOKEN,
        fields:     'actions',
        level:      'account',
        time_range: JSON.stringify({ since: from, until: to }),
        filtering:  JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campIds }]),
      },
    });
    const json = JSON.parse(res.getContentText());
    let sum = 0;
    (json.data || []).forEach(d => (d.actions||[]).forEach(a => {
      if (a.action_type === 'onsite_conversion.messaging_conversation_started_7d')
        sum += Number(a.value) || 0;
    }));
    return sum;
  }

  Logger.log('=== NGƯỜI LIÊN HỆ THEO TRANG (dedup, lọc campaign, POST) ===');
  Object.keys(pageMap).forEach(pid => {
    let pageTotal = 0;
    accounts.forEach(acct => {
      const set = pageMap[pid][acct.id];
      if (!set || !set.size) return;
      pageTotal += insightsFilteredPOST(acct.id, [...set]);
    });
    Logger.log(`[${pidName[pid] || pid}] = ${pageTotal}`);
  });
}

// Test: lọc theo campaign của riêng trang FUJIWA VIETNAM CO., LTD (page_id 497184357695598)
// → account-level dedup trong phạm vi campaign đó → phải ra ~896
function testPageFiltered() {
  const from = '2026-06-02';
  const to   = '2026-07-01';
  const TARGET_PAGE_ID = '497184357695598'; // FUJIWA VIETNAM CO., LTD

  const accounts = [
    { id: 'act_208110432165351', name: 'Fujiwa Ads 14' },
    { id: 'act_575643551319198', name: 'Fujiwa Ads 15' },
  ];

  function extractPageId(ad) {
    const s = ad.effective_object_story_id || '';
    if (s) return s.split('_')[0];
    const spec = ad.creative && ad.creative.object_story_spec;
    if (spec && spec.page_id) return spec.page_id;
    if (ad.creative && ad.creative.actor_id) return ad.creative.actor_id;
    return '';
  }

  let grandTotal = 0;

  accounts.forEach(acct => {
    // 1) Lấy tất cả ads → map campaign_id thuộc trang đích
    const ads = fetchPaged(`${BASE_URL}/${acct.id}/ads`, {
      access_token: CFG.TOKEN,
      fields: 'campaign{id,name},effective_object_story_id,creative{object_story_spec{page_id},actor_id}',
      limit: '200',
    }, 10);

    const campIds = new Set();
    ads.forEach(ad => {
      if (extractPageId(ad) === TARGET_PAGE_ID && ad.campaign && ad.campaign.id) {
        campIds.add(ad.campaign.id);
      }
    });
    const ids = [...campIds];
    Logger.log(`${acct.name}: ${ids.length} campaign thuộc trang đích`);
    if (!ids.length) return;

    // 2) Insights account-level, lọc theo campaign.id IN ids
    const rows = fetchPaged(`${BASE_URL}/${acct.id}/insights`, {
      access_token: CFG.TOKEN,
      fields:     'actions',
      level:      'account',
      time_range: JSON.stringify({ since: from, until: to }),
      filtering:  JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: ids }]),
    });

    let sub = 0;
    rows.forEach(d => {
      (d.actions || []).forEach(a => {
        if (a.action_type === 'onsite_conversion.messaging_conversation_started_7d')
          sub += Number(a.value) || 0;
      });
    });
    Logger.log(`${acct.name}: ${sub} người liên hệ (đã lọc trang đích)`);
    grandTotal += sub;
  });

  Logger.log(`>>> TỔNG FUJIWA VIETNAM CO., LTD = ${grandTotal} (Meta báo ~896 trả phí)`);
}
