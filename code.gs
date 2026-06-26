// CFG và AD_ACCOUNTS được định nghĩa trong config.gs (không commit lên git)
// Xem config.example.gs để biết cấu trúc

// ─── HẰNG SỐ ────────────────────────────────────────────────
const BASE_URL  = "https://graph.facebook.com/v19.0";
const SS        = SpreadsheetApp.getActiveSpreadsheet();

// ============================================================
// ĐIỂM VÀO CHÍNH
// ============================================================
function syncAll() {
  const log = [];
  try { log.push("Ads: "   + syncAds());   } catch(e) { log.push("Ads lỗi: "  + e.message); }
  try { log.push("Page: "  + syncPage());  } catch(e) { log.push("Page lỗi: " + e.message); }
  try { log.push("Posts: " + syncPosts()); } catch(e) { log.push("Post lỗi: " + e.message); }
  Logger.log("✅ " + new Date().toLocaleString("vi-VN") + "\n" + log.join("\n"));
}

// ============================================================
// 1. ADS DATA
// ============================================================
function syncAds() {
  const fields = [
    "campaign_name", "adset_name",
    "spend", "impressions", "reach",
    "clicks", "ctr", "cpc", "cpm",
    "frequency", "actions",
    "purchase_roas",
    "date_start", "date_stop"
  ].join(",");

  const headers = [
    "date", "account", "campaign", "adset",
    "spend", "impressions", "reach",
    "clicks", "ctr", "cpc", "cpm", "frequency",
    "link_clicks", "purchases", "add_to_cart",
    "landing_page_view", "messaging_reply", "page_like",
    "roas"
  ];

  const allRows = [];

  AD_ACCOUNTS.forEach(acct => {
    try {
      const data = fetchPaged(`${BASE_URL}/${acct.id}/insights`, {
        access_token:   CFG.TOKEN,
        date_preset:    "last_30d",
        level:          "adset",
        fields:         fields,
        limit:          "200",
        time_increment: "1",
      });

      data.forEach(d => {
        const act  = toActionMap(d.actions);
        const roas = d.purchase_roas ? parseFloat(d.purchase_roas[0]?.value || 0) : 0;
        allRows.push([
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
      Logger.log(`✅ ${acct.name}: ${data.length} rows`);
    } catch(e) {
      Logger.log(`❌ ${acct.name}: ${e.message}`);
    }
  });

  writeSheet("Ads Data", headers, allRows);
  return `${allRows.length} rows tổng (${AD_ACCOUNTS.map(a=>a.name).join(', ')})`;
}

// ============================================================
// DEBUG — tìm metrics NPE còn hoạt động
// ============================================================
function diagnosePage() {
  const since = Math.floor(daysAgo(7).getTime() / 1000).toString();
  const until = Math.floor(new Date().getTime() / 1000).toString();

  let pt = CFG.PAGE_TOKEN;
  try {
    const info = apiGet(`${BASE_URL}/${CFG.PAGE_ID}`, { access_token: CFG.TOKEN, fields: "access_token" });
    pt = info.access_token || pt;
  } catch(e) {}

  // Danh sách candidates cho New Pages Experience
  const candidates = [
    "page_total_actions",
    "page_fan_adds",
    "page_fan_removes",
    "page_views_total",
    "page_post_engagements",
    "page_video_views",
    "page_daily_follows",
    "page_daily_unfollows",
    "page_follows",
    "page_content_activity",
    "page_reactions_total",
    "page_negative_feedback",
  ];

  const ok = [], fail = [];
  candidates.forEach(m => {
    try {
      const r = apiGet(`${BASE_URL}/${CFG.PAGE_ID}/insights`, {
        access_token: pt, metric: m, period: "day", since, until,
      });
      const n = r.data?.[0]?.values?.length || 0;
      ok.push(`✅ ${m} (${n} values)`);
    } catch(e) {
      fail.push(`❌ ${m}`);
    }
  });

  Logger.log("=== HOẠT ĐỘNG ===\n" + ok.join("\n"));
  Logger.log("=== LỖI ===\n" + fail.join("\n"));
}

// ============================================================
// 2. PAGE INSIGHTS (New Pages Experience — chỉ dùng metrics hợp lệ)
// ============================================================
function syncPage() {
  // Lấy tất cả page_id từ Ad Creatives sheet
  const crSh = SS.getSheetByName("Ad Creatives");
  const pageMap = {}; // { page_id: page_name }

  if (crSh && crSh.getLastRow() > 1) {
    const vals = crSh.getRange(1, 1, crSh.getLastRow(), crSh.getLastColumn()).getValues();
    const hdr  = vals[0];
    const pidI = hdr.indexOf('page_id');
    const pnI  = hdr.indexOf('page_name');
    if (pidI >= 0) {
      vals.slice(1).forEach(r => {
        const pid = String(r[pidI] || '').trim();
        if (pid && pid !== '0') pageMap[pid] = String(r[pnI] || pid).trim();
      });
    }
  }
  // Fallback: dùng page được cấu hình
  if (!Object.keys(pageMap).length) pageMap[CFG.PAGE_ID] = 'Main Page';

  const since = Math.floor(daysAgo(30).getTime() / 1000).toString();
  const until = Math.floor(new Date().getTime() / 1000).toString();
  const COLS  = ["page_views_total","page_post_engagements","page_total_actions",
                 "page_video_views","page_daily_follows","page_daily_unfollows",
                 "page_messages_new_conversations_unique",
                 "page_messages_active_threads_unique"];
  const headers = ["date", "page_name", ...COLS];
  const allRows = [];

  Object.entries(pageMap).forEach(([pid, pname]) => {
    // Lấy page token riêng cho từng trang
    let pt = CFG.PAGE_TOKEN;
    try {
      const info = apiGet(`${BASE_URL}/${pid}`, { access_token: CFG.TOKEN, fields: "access_token" });
      if (info.access_token) pt = info.access_token;
    } catch(e) {
      Logger.log(`⚠️ Không lấy được token cho "${pname}" (${pid}): ${e.message}`);
      return; // bỏ qua page này nếu không lấy được token
    }

    const base   = { access_token: pt, period: "day", since, until };
    const byDate = {};
    const merge  = raw => {
      (raw.data || []).forEach(m => {
        (m.values || []).forEach(v => {
          const d = (v.end_time || "").split("T")[0];
          if (!d) return;
          if (!byDate[d]) byDate[d] = { date: d };
          byDate[d][m.name] = (typeof v.value === "object") ? 0 : (v.value || 0);
        });
      });
    };

    try {
      merge(apiGet(`${BASE_URL}/${pid}/insights`, {
        ...base, metric: "page_total_actions,page_views_total,page_post_engagements",
      }));
    } catch(e) { Logger.log(`⚠️ ${pname} batch1: ${e.message}`); }

    try {
      merge(apiGet(`${BASE_URL}/${pid}/insights`, {
        ...base, metric: "page_daily_follows,page_daily_unfollows,page_video_views",
      }));
    } catch(e) { Logger.log(`⚠️ ${pname} batch2: ${e.message}`); }

    try {
      merge(apiGet(`${BASE_URL}/${pid}/insights`, {
        ...base, metric: "page_messages_new_conversations_unique",
      }));
    } catch(e) { Logger.log(`⚠️ ${pname} new_conv: ${e.message}`); }

    try {
      merge(apiGet(`${BASE_URL}/${pid}/insights`, {
        ...base, metric: "page_messages_active_threads_unique",
      }));
    } catch(e) { Logger.log(`⚠️ ${pname} active_threads: ${e.message}`); }

    const pageRows = Object.values(byDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => [d.date, pname, ...COLS.map(k => d[k] ?? 0)]);

    allRows.push(...pageRows);
    Logger.log(`✅ Page "${pname}": ${pageRows.length} ngày`);
  });

  _writeSheet(SS, "Page Insights", headers, allRows);
  return `${allRows.length} rows (${Object.keys(pageMap).length} pages)`;
}

// ============================================================
// 3. POST ENGAGEMENT
// ============================================================
function syncPosts() {
  const raw = apiGet(`${BASE_URL}/${CFG.PAGE_ID}/posts`, {
    access_token: CFG.PAGE_TOKEN,
    fields: "id,message,created_time,story",
    limit: "50",
  });

  const headers = ["date","message","story","impressions","reach","engaged","clicks","post_id"];
  const rows = (raw.data || []).map(p => {
    const ins = {};
    (p.insights?.data || []).forEach(m => { ins[m.name] = m.values?.[0]?.value ?? 0; });
    return [
      (p.created_time || "").split("T")[0],
      (p.message || p.story || "").substring(0, 200),
      p.story || "",
      ins.post_impressions || 0,
      ins.post_impressions_unique || 0,
      ins.post_engaged_users || 0,
      ins.post_clicks || 0,
      p.id || "",
    ];
  });

  _writeSheet(SS || _getSpreadsheet(), "Post Engagement", headers, rows);
  return `${rows.length} bài viết`;
}

// ============================================================
// HELPERS
// ============================================================
function apiGet(url, params) {
  const qs  = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const res = UrlFetchApp.fetch(`${url}?${qs}`, { muteHttpExceptions: true });
  const json = JSON.parse(res.getContentText());
  if (json.error) throw new Error(json.error.message);
  return json;
}

function fetchPaged(url, params, maxPages = 5) {
  let all = [], page = 0;
  let json = apiGet(url, params);
  all = all.concat(json.data || []);
  while (json.paging?.next && ++page < maxPages) {
    json = JSON.parse(UrlFetchApp.fetch(json.paging.next).getContentText());
    all = all.concat(json.data || []);
  }
  return all;
}

function writeSheet(name, headers, rows) {
  let sh = SS.getSheetByName(name) || SS.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight("bold")
    .setBackground("#1e3a5f")
    .setFontColor("white");
  if (rows.length > 0)
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function toActionMap(actions) {
  if (!actions) return {};
  return Object.fromEntries(actions.map(a => [a.action_type, parseFloat(a.value || 0)]));
}

function num(v) { return parseFloat(v || 0); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function isoDate(d) { return Utilities.formatDate(d, "Asia/Ho_Chi_Minh", "yyyy-MM-dd"); }

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncAll")
    .timeBased().atHour(6).everyDays(1)
    .inTimezone("Asia/Ho_Chi_Minh")
    .create();
  Logger.log("⏰ Trigger đã cài: 6:00 AM mỗi ngày");
}
