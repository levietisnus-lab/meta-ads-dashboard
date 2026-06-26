# Meta Ads Dashboard — Tài liệu dự án

> Cập nhật: 2026-06-23

---

## 1. Tổng quan

Dashboard tự động đồng bộ dữ liệu từ **Facebook/Meta Ads API** vào **Google Sheets**, hiển thị qua **Google Apps Script Web App** với giao diện 6 tab.

| Thành phần | Giá trị |
|---|---|
| Google Sheet ID | `1UhBB5Hlgik0AIqCAzASsLgYcfBCSVAdFZmCWI1YNoz0` |
| Ad Account | `act_208110432165351` |
| Page ID | `497184357695598` |
| API Version | `https://graph.facebook.com/v19.0` |

---

## 2. Cấu trúc file

```
GAS Project
├── Mã.gs           — Sync chính: syncAds, syncPage, syncPosts + helpers
├── Meta.gs         — Web app: doGet, getDashboardData, syncMessages, syncAdCreatives, syncAllFull
├── dashboard.html  — Giao diện dashboard 6 tab (Chart.js v4.4.0)
└── appsscript.json — Manifest GAS
```

---

## 3. Cấu hình CFG

Đặt trong `Mã.gs`:

```javascript
const CFG = {
  TOKEN:      "...",              // System User Token — dùng cho Ads API
  PAGE_TOKEN: "...",              // Page Access Token — dùng cho Page/Posts/Messages
  AD_ACCOUNT: "act_208110432165351",
  PAGE_ID:    "497184357695598",
};

const BASE_URL = "https://graph.facebook.com/v19.0";
const SS       = SpreadsheetApp.getActiveSpreadsheet();
```

> **QUAN TRỌNG:** `SS` là `null` khi gọi từ web app URL. Dùng `_getSpreadsheet()` trong `Meta.gs` thay thế.

---

## 4. Phân biệt Token

| Token | Biến | Dùng cho | Endpoint |
|---|---|---|---|
| **System User Token** | `CFG.TOKEN` | Ads, Ad Creatives | `/{ad_account}/insights`, `/{ad_account}/ads` |
| **Page Access Token** | `CFG.PAGE_TOKEN` | Page Insights, Posts, Messages | `/{page_id}/insights`, `/{page_id}/posts`, `/{page_id}/conversations` |

### Cách lấy Page Access Token

```javascript
function getPageToken() {
  const result = apiGet(`${BASE_URL}/${CFG.PAGE_ID}`, {
    access_token: CFG.TOKEN,
    fields: "access_token,name",
  });
  Logger.log("Page: " + result.name);
  Logger.log("PAGE_TOKEN: " + result.access_token);
  return result.access_token;
}
```

Copy chuỗi token từ log → paste vào `CFG.PAGE_TOKEN`.

> **Yêu cầu:** System User phải có quyền **Admin** trên Facebook Page (không phải Advertiser).  
> Nâng quyền tại: Business Manager → Cài đặt → Trang → chọn Page → Vai trò → Sửa thành Admin.

---

## 5. Quyền OAuth cần thiết

| Permission | Dùng cho |
|---|---|
| `ads_management` | Ads API |
| `ads_read` | Đọc dữ liệu quảng cáo |
| `read_insights` | Page Insights |
| `pages_read_engagement` | Bài đăng, tương tác |
| `pages_read_user_content` | Nội dung trang |
| `pages_messaging` | Tin nhắn Messenger |
| `pages_show_list` | Lấy Page Access Token |
| `pages_manage_posts` | Quản lý bài đăng |

---

## 6. Các sheet được tạo

| Sheet | Hàm sync | Token dùng |
|---|---|---|
| `Ads Data` | `syncAds()` | System User Token |
| `Page Insights` | `syncPage()` | Page Access Token |
| `Post Engagement` | `syncPosts()` | Page Access Token |
| `Messages` | `syncMessages()` | Page Access Token |
| `Ad Creatives` | `syncAdCreatives()` | System User Token |

---

## 7. Code các hàm sync

### 7.1 syncAds() — trong `Mã.gs`

```javascript
function syncAds() {
  const since = isoDate(daysAgo(30));
  const until = isoDate(new Date());
  const raw = fetchPaged(`${BASE_URL}/${CFG.AD_ACCOUNT}/insights`, {
    access_token: CFG.TOKEN,
    fields: [
      "date_start","campaign_name","adset_name",
      "spend","reach","impressions","clicks","ctr","cpc","cpm","frequency",
      "actions","action_values","cost_per_action_type","purchase_roas",
    ].join(","),
    level: "adset",
    time_increment: "1",
    limit: "500",
    time_range: JSON.stringify({ since, until }),
  }, 20);

  const headers = [
    "date","campaign","adset","spend","reach","impressions",
    "clicks","ctr","cpc","cpm","frequency","link_clicks",
    "purchases","add_to_cart","roas",
  ];
  const rows = raw.map(r => {
    const act  = key => (r.actions||[]).find(a=>a.action_type===key)?.value||0;
    const roas = (r.purchase_roas||[]).find(a=>a.action_type==="omni_purchase")?.value||0;
    return [
      r.date_start, r.campaign_name, r.adset_name,
      +r.spend||0, +r.reach||0, +r.impressions||0,
      +r.clicks||0, +r.ctr||0, +r.cpc||0, +r.cpm||0, +r.frequency||0,
      act("link_click"), act("purchase"), act("add_to_cart"), +roas||0,
    ];
  });
  _writeSheet(SS, "Ads Data", headers, rows);
  return `${rows.length} rows`;
}
```

---

### 7.2 syncPage() — trong `Mã.gs` *(phiên bản đầy đủ nhất)*

```javascript
function syncPage() {
  const since = isoDate(daysAgo(30));
  const until = isoDate(new Date());
  const base  = { access_token: CFG.PAGE_TOKEN, period: "day", since, until };

  const byDate = {};
  const merge = raw => {
    (raw.data || []).forEach(m => {
      (m.values || []).forEach(v => {
        const d = (v.end_time || "").split("T")[0];
        if (!d) return;
        if (!byDate[d]) byDate[d] = { date: d };
        // value có thể là object (breakdown) — chỉ lấy số đơn
        byDate[d][m.name] = (typeof v.value === "object") ? 0 : (v.value || 0);
      });
    });
  };

  // Nhóm 1: Core metrics
  try {
    merge(apiGet(`${BASE_URL}/${CFG.PAGE_ID}/insights`, {
      ...base,
      metric: [
        "page_impressions",
        "page_impressions_unique",
        "page_impressions_paid",
        "page_impressions_organic_v2",
        "page_engaged_users",
        "page_fans",
        "page_fan_adds",
        "page_fan_removes",
        "page_views_total",
      ].join(","),
    }));
  } catch(e) { Logger.log("Page core: " + e.message); }

  // Nhóm 2: Messaging metrics (cần pages_messaging)
  try {
    merge(apiGet(`${BASE_URL}/${CFG.PAGE_ID}/insights`, {
      ...base,
      metric: [
        "page_messages_total_messaging_connections",
        "page_messages_new_conversations_unique",
        "page_messages_paid_conversations_unique",
      ].join(","),
    }));
  } catch(e) { Logger.log("Page msg: " + e.message); }

  const COLS = [
    "page_impressions", "page_impressions_unique",
    "page_impressions_paid", "page_impressions_organic_v2",
    "page_engaged_users",
    "page_fans", "page_fan_adds", "page_fan_removes",
    "page_views_total",
    "page_messages_total_messaging_connections",
    "page_messages_new_conversations_unique",
    "page_messages_paid_conversations_unique",
  ];
  const headers = ["date", ...COLS];
  const rows = Object.values(byDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => headers.map(k => d[k] ?? 0));

  _writeSheet(SS, "Page Insights", headers, rows);
  return `${rows.length} ngày`;
}
```

**Metrics được sync:**

| Metric | Ý nghĩa |
|---|---|
| `page_impressions` | Tổng lượt hiển thị |
| `page_impressions_unique` | Tiếp cận (unique users) |
| `page_impressions_paid` | Hiển thị từ quảng cáo trả phí |
| `page_impressions_organic_v2` | Hiển thị tự nhiên |
| `page_engaged_users` | Số người tương tác |
| `page_fans` | Tổng follow hiện tại |
| `page_fan_adds` | Follow mới trong ngày |
| `page_fan_removes` | Bỏ follow trong ngày |
| `page_views_total` | Lượt xem trang |
| `page_messages_total_messaging_connections` | Tổng kết nối tin nhắn |
| `page_messages_new_conversations_unique` | Hội thoại mới (organic + paid) |
| `page_messages_paid_conversations_unique` | Hội thoại từ click-to-message ads |

---

### 7.3 syncPosts() — trong `Mã.gs`

```javascript
function syncPosts() {
  const raw = fetchPaged(`${BASE_URL}/${CFG.PAGE_ID}/posts`, {
    access_token: CFG.PAGE_TOKEN,   // phải dùng PAGE_TOKEN
    fields: "id,message,created_time,story",
    limit: "100",
  }, 5);

  const headers = ["created_date", "type", "message", "post_id"];
  const rows = raw.map(p => [
    (p.created_time || "").split("T")[0],
    p.story ? "story" : "post",
    (p.message || p.story || "").substring(0, 500),
    p.id || "",
  ]);
  _writeSheet(SS, "Post Engagement", headers, rows);
  return `${rows.length} bài`;
}
```

---

### 7.4 syncMessages() — trong `Meta.gs`

```javascript
function syncMessages() {
  const raw = apiGet(`${BASE_URL}/${CFG.PAGE_ID}/conversations`, {
    access_token: CFG.PAGE_TOKEN,   // phải dùng PAGE_TOKEN
    fields: "id,snippet,updated_time,message_count,unread_count,participants",
    limit: "100",
    platform: "messenger",
  });

  const headers = ["updated_date","snippet","from","message_count","unread","conv_id"];
  const rows = (raw.data || []).map(c => [
    (c.updated_time || "").split("T")[0],
    (c.snippet || "").substring(0, 200),
    (c.participants?.data || []).map(p => p.name).filter(Boolean).join(", "),
    c.message_count || 0,
    c.unread_count  || 0,
    c.id            || "",
  ]);

  const ss = _getSpreadsheet();
  _writeSheet(ss, "Messages", headers, rows);
  return `${rows.length} hội thoại`;
}
```

---

### 7.5 syncAdCreatives() — trong `Meta.gs`

```javascript
function syncAdCreatives() {
  const raw = fetchPaged(`${BASE_URL}/${CFG.AD_ACCOUNT}/ads`, {
    access_token: CFG.TOKEN,
    fields: [
      "name","status","effective_status",
      "campaign{name}","adset{name}",
      "creative{title,body,image_url,call_to_action_type,thumbnail_url}",
    ].join(","),
    limit: "200",
  }, 10);

  const headers = ["campaign","adset","ad_name","status","title","body","cta","image_url"];
  const rows = raw.map(ad => [
    ad.campaign?.name || "",
    ad.adset?.name    || "",
    ad.name           || "",
    ad.effective_status || ad.status || "",
    ad.creative?.title || "",
    (ad.creative?.body || "").substring(0, 300),
    ad.creative?.call_to_action_type || "",
    ad.creative?.image_url || ad.creative?.thumbnail_url || "",
  ]);

  const ss = _getSpreadsheet();
  _writeSheet(ss, "Ad Creatives", headers, rows);
  return `${rows.length} ads`;
}
```

---

### 7.6 syncAllFull() — trong `Meta.gs`

```javascript
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
```

---

## 8. Web App — Meta.gs

### doGet()

```javascript
function doGet() {
  return HtmlService.createHtmlOutputFromFile("dashboard")
    .setTitle("Meta Ads Dashboard")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

### getDashboardData()

```javascript
function getDashboardData() {
  const ss  = _getSpreadsheet();
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
```

### _getSpreadsheet() — fallback khi web app context

```javascript
const SHEET_ID = "1UhBB5Hlgik0AIqCAzASsLgYcfBCSVAdFZmCWI1YNoz0";

function _getSpreadsheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) { /* web app context */ }
  return SpreadsheetApp.openById(SHEET_ID);
}
```

### _sheetToJson() — CRITICAL: sanitize Date objects

```javascript
function _sheetToJson(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) return { headers: [], rows: [] };
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
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
```

---

## 9. Dashboard — 6 tab

### Tab 1: Tổng quan (Ads Data)

| Thành phần | Nội dung |
|---|---|
| 8 KPI cards | Chi phí, ROAS, Tiếp cận, Hiển thị, Mua hàng, Thêm giỏ, Link Clicks, CTR |
| Chart: Chi phí theo ngày | Line chart 30 ngày |
| Chart: ROAS theo ngày | Line chart 30 ngày |
| Chart: Tiếp cận & Hiển thị | 2 lines 30 ngày |
| Chart: Mua hàng & Thêm giỏ | 2 lines 30 ngày |
| Bảng Campaign Breakdown | Xếp hạng campaign theo chi phí, có progress bar % tỷ trọng, ROAS màu (xanh ≥2x / vàng ≥1x / đỏ <1x) |

### Tab 2: Quảng cáo (Ads Data)

- Bảng chi tiết theo ngày, sort được từng cột
- Filter: tìm kiếm text, chọn Campaign, chọn Ad Set

### Tab 3: Trang (Page Insights)

| Thành phần | Nội dung |
|---|---|
| 8 KPI cards | Tổng follow, Follow mới, Bỏ follow, Net change, Tiếp cận, Tương tác, Hội thoại mới (trả phí / organic), Lượt xem |
| Chart: Tăng/Giảm Follow | Bar (follow mới xanh, bỏ follow đỏ âm) + Line (tổng follow, trục phải) |
| Chart: Tiếp cận Trả phí vs Tự nhiên | 3 lines: tổng / paid / organic |
| Chart: Tương tác trang | Người tương tác + Lượt xem trang |
| Chart: Tin nhắn Trả phí vs Tự nhiên | Tổng kết nối / Hội thoại mới / Click-to-message paid |
| Bảng chi tiết | Tất cả metrics theo ngày, mới nhất trước |

### Tab 4: Bài đăng (Post Engagement)

- Bảng danh sách bài đăng, sort được
- Filter: tìm kiếm text, chọn loại (post/story)

### Tab 5: Tin nhắn (Messages)

- Danh sách hội thoại Messenger
- Hiển thị: tên người, số tin chưa đọc, thời gian, preview nội dung
- Filter: tìm kiếm text

### Tab 6: Nội dung QC (Ad Creatives)

- Card grid với hình ảnh creative
- Hiển thị: campaign, ad set, tên ad, trạng thái, tiêu đề, nội dung, CTA
- Filter: tìm kiếm text, chọn trạng thái (Active/Paused/Archived), chọn Campaign

---

## 10. Các lỗi đã gặp và cách fix

### Lỗi 1: Dashboard trắng — "Đang tải..." không biến mất

**Nguyên nhân:** `getDashboardData()` trả về `null` vì Google Sheets lưu ngày dạng `Date` object — `google.script.run` không serialize được `Date` object, toàn bộ return value thành `null`.

**Fix** trong `_sheetToJson()` (Meta.gs):
```javascript
const sanitize = v => (v instanceof Date)
  ? Utilities.formatDate(v, "Asia/Ho_Chi_Minh", "yyyy-MM-dd")
  : v;
```

**Fix phụ** — null check trong `onLoad()` (dashboard.html):
```javascript
function onLoad(data) {
  if (!data) {
    onErr({ message: 'getDashboardData() trả về null — kiểm tra meta.gs đã lưu và deploy lại.' });
    return;
  }
  // ...
}
```

---

### Lỗi 2: `getActiveSpreadsheet()` trả về null trong web app

**Nguyên nhân:** Web app chạy trong context khác, không có "active spreadsheet".

**Fix** — dùng `openById()` làm fallback:
```javascript
function _getSpreadsheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) {}
  return SpreadsheetApp.openById(SHEET_ID);
}
```

---

### Lỗi 3: Page — `(#100) The value must be a valid insights metric`

**Nguyên nhân:** Một số metric deprecated trong API v19.0.

**Metric bị loại bỏ:**

| Metric | Lý do |
|---|---|
| `page_video_views` | Deprecated |
| `page_fan_removes` | Không hợp lệ nếu không có quyền Admin |
| `page_post_engagements` | Không hợp lệ với `period: "day"` |

**Fix:** Chỉ dùng metric hợp lệ. Chia thành 2 nhóm, mỗi nhóm try/catch riêng để nếu một nhóm lỗi, nhóm kia vẫn chạy.

---

### Lỗi 4: Posts — `(#12) deprecate_post_aggregated_fields_for_attachement`

**Nguyên nhân:** Field `attachments` deprecated từ API v3.3+.

**Fix:** Bỏ `attachments` khỏi fields, chỉ dùng `"id,message,created_time,story"`.

---

### Lỗi 5: Posts — `Invalid OAuth 2.0 Access Token`

**Nguyên nhân:** Dùng System User Token cho endpoint `/posts` — endpoint này cần Page Access Token.

**Fix:** Dùng `CFG.PAGE_TOKEN` trong `syncPosts()`.

---

### Lỗi 6: Messages — `(#10) Requested Page Does Not Match Page Access Token`

**Nguyên nhân:** Dùng System User Token cho `/conversations` endpoint.

**Fix:** Dùng `CFG.PAGE_TOKEN` trong `syncMessages()`.

---

### Lỗi 7: Tất cả Page metrics thất bại trừ `page_views_total`

**Nguyên nhân:** System User có quyền **Advertiser** (không phải **Admin**) trên Facebook Page → chỉ đọc được public metrics.

**Fix:** Nâng System User lên quyền **Admin**:
1. Facebook Business Manager → Cài đặt doanh nghiệp → Trang
2. Chọn Page → Người → tìm System User → Sửa vai trò → Admin
3. Chạy lại `getPageToken()` → paste token mới vào `CFG.PAGE_TOKEN`

---

### Lỗi 8: Cannot parse access token + có 2 AD_ACCOUNT

**Nguyên nhân:** CFG bị sửa nhầm — thêm account thứ 2 và làm hỏng chuỗi TOKEN.

**Fix:** Khôi phục CFG về đúng format với 1 `AD_ACCOUNT` và `TOKEN` không bị cắt.

---

## 11. Hàm debug

### Kiểm tra từng Page metric

```javascript
function debugPageMetrics() {
  const metrics = [
    "page_impressions", "page_impressions_unique",
    "page_impressions_paid", "page_impressions_organic_v2",
    "page_engaged_users",
    "page_fans", "page_fan_adds", "page_fan_removes",
    "page_views_total",
    "page_messages_total_messaging_connections",
    "page_messages_new_conversations_unique",
    "page_messages_paid_conversations_unique",
  ];
  const results = [];
  for (const m of metrics) {
    try {
      apiGet(`${BASE_URL}/${CFG.PAGE_ID}/insights`, {
        access_token: CFG.PAGE_TOKEN,
        metric: m, period: "day",
        since: isoDate(daysAgo(7)), until: isoDate(new Date()),
      });
      results.push("✅ " + m);
    } catch(e) {
      results.push("❌ " + m + ": " + e.message);
    }
  }
  Logger.log(results.join("\n"));
}
```

### Kiểm tra Page Access Token

```javascript
function checkPageToken() {
  try {
    const r = apiGet(`${BASE_URL}/${CFG.PAGE_ID}`, {
      access_token: CFG.PAGE_TOKEN,
      fields: "name,id,fan_count",
    });
    Logger.log("✅ Page Token OK — " + r.name + " | Fans: " + r.fan_count);
  } catch(e) {
    Logger.log("❌ Page Token lỗi: " + e.message);
  }
}
```

---

## 12. Trigger tự động

Chạy hàm này **1 lần** để cài trigger đồng bộ mỗi ngày lúc 6:00 AM:

```javascript
function setupTriggerFull() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncAllFull")
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .inTimezone("Asia/Ho_Chi_Minh")
    .create();
  Logger.log("⏰ Trigger: syncAllFull lúc 6:00 AM mỗi ngày");
}
```

---

## 13. Hướng dẫn deploy web app

1. GAS Editor → **Triển khai** → **Quản lý triển khai**
2. Click biểu tượng chỉnh sửa (bút) → **Phiên bản mới**
3. Thực thi với tư cách: **Tôi (email của bạn)**
4. Ai có quyền truy cập: **Mọi người**
5. Click **Triển khai** → copy URL mới
6. **QUAN TRỌNG:** Mỗi lần thay đổi code phải tạo **Phiên bản mới** — URL cũ vẫn chạy code cũ

---

## 14. Checklist khi gặp lỗi

- [ ] Token còn hiệu lực? → Chạy `checkPageToken()` để kiểm tra
- [ ] `CFG.PAGE_TOKEN` đã điền? (không để trống)
- [ ] `CFG.TOKEN` (System User) không bị cắt, không có 2 AD_ACCOUNT?
- [ ] System User có quyền **Admin** trên Page? (không phải Advertiser)
- [ ] Web app đã deploy **Phiên bản mới** sau khi sửa code?
- [ ] `Meta.gs` đã **Lưu** (Ctrl+S) trong GAS editor?
- [ ] `dashboard.html` đã **Lưu** (Ctrl+S) trong GAS editor?
- [ ] Sheet ID đúng trong `SHEET_ID` của `Meta.gs`?
- [ ] Dashboard trắng? → Kiểm tra `_sheetToJson` đã có sanitize Date chưa?

---

## 15. Kiến trúc dữ liệu

```
Facebook Graph API v19.0
        │
        ├── /act_{id}/insights  ──────────────→ Sheet: Ads Data
        │   (System User Token)                  (date, campaign, adset, spend, reach,
        │                                         impressions, clicks, ctr, cpc, cpm,
        │                                         frequency, link_clicks, purchases,
        │                                         add_to_cart, roas)
        │
        ├── /{page_id}/insights ──────────────→ Sheet: Page Insights
        │   (Page Access Token)                  (date, impressions, reach, paid,
        │                                         organic, engaged_users, fans,
        │                                         fan_adds, fan_removes, views,
        │                                         msg_connections, msg_new, msg_paid)
        │
        ├── /{page_id}/posts ─────────────────→ Sheet: Post Engagement
        │   (Page Access Token)                  (date, type, message, post_id)
        │
        ├── /{page_id}/conversations ─────────→ Sheet: Messages
        │   (Page Access Token)                  (date, snippet, from, msg_count,
        │                                         unread, conv_id)
        │
        └── /act_{id}/ads ────────────────────→ Sheet: Ad Creatives
            (System User Token)                  (campaign, adset, ad_name, status,
                                                  title, body, cta, image_url)

Google Sheets ──→ getDashboardData() ──→ google.script.run ──→ dashboard.html
(SHEET_ID)         (Meta.gs)              (serialize JSON)       (Chart.js v4.4.0)
```

---

## 16. Lịch sử thay đổi

| Ngày | Thay đổi |
|---|---|
| 2026-06-23 | Thêm tab Trang với KPI + 4 biểu đồ (fan growth, reach paid/organic, engagement, messaging paid/organic) |
| 2026-06-23 | Thêm Campaign Breakdown table trong tab Tổng quan |
| 2026-06-23 | Fix dashboard trắng: sanitize Date objects trong `_sheetToJson` |
| 2026-06-23 | Fix `syncMessages`, `syncPosts` dùng đúng `PAGE_TOKEN` |
| 2026-06-23 | Fix deprecated metrics trong `syncPage` (v19.0) |
| 2026-06-23 | Fix `_getSpreadsheet()` fallback `openById` cho web app context |
| 2026-06-23 | Thêm `syncAdCreatives` và `syncAllFull` trong Meta.gs |
