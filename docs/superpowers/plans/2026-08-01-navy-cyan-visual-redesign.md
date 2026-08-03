# Navy/Cyan Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the dashboard's shared design tokens and card/KPI/sidebar/chart components to match a navy+cyan reference direction, in both light and dark theme, including semantically-correct icon badges on all 21 KPI cards.

**Architecture:** This is a token-and-shared-component redesign, not a per-tab rewrite. `index.html` already reads nearly all color/shape values from CSS custom properties (`:root` / `html[data-theme="dark"]`) and shared classes (`.card`, `.kpi-card`, `table`/`th`/`td`, `.btn*`, `.badge-pill`, `.date-btn`, `.nav-tab`) that every tab reuses — changing the tokens and these shared rules restyles every tab automatically. The one exception is the per-KPI icon badges (Task 3), which touch 3 specific JS render functions because the icon is semantic content, not a token.

**Tech Stack:** Plain CSS custom properties, vanilla JS template strings, Chart.js 4.4.0 (already in use). No build step, no new dependencies.

## Global Constraints

- No automated test framework exists in this project (no npm, no test runner, no CI). Verification is manual: live Browser-pane preview with computed-style JS assertions (`getComputedStyle(...)`) plus `read_console_messages({onlyErrors:true})` — this project's established verification method (see the Content Plan feature's plan for precedent). Screenshot tooling has been unreliable in this environment recently (renders at a fixed ~800px width regardless of requested resize) — treat computed-style assertions as the primary evidence, screenshots as a bonus if they happen to work, never as a blocking requirement.
- This is **styling only** — no data/logic changes, no new features.
- Explicitly **out of scope** (do not touch, per the spec): the `tile()` mini-stat component (Bài đăng/GSC/GA4 summaries) and the Content Plan tab's modals/forms (hardcoded inline hex colors). If you notice either looking visually inconsistent with the new theme after this plan's changes, that is expected and correct — do not "fix" them.
- Spec reference: `docs/superpowers/specs/2026-08-01-navy-cyan-visual-redesign-design.md` — re-read it if a task's intent is unclear.
- `--sidebar-grad` already exists as a token (`:root` only, currently shared by both themes) — Task 1 edits its existing `:root` value and adds a **new** dark-mode-specific declaration inside `html[data-theme="dark"]`. Do not introduce a second, differently-named token for this.
- All edits are inside `index.html`. Every task's "Find" snippets are copied verbatim from the file as it stood when this plan was written — if a snippet doesn't match exactly when you go to apply it (e.g. a prior task in this same plan already changed nearby lines), search for the nearest unique anchor mentioned in the step rather than guessing.

---

## File Structure

- **Modify:** `index.html` only, in 4 distinct regions:
  - `:root` / `html[data-theme="dark"]` CSS blocks (~lines 19-44) — Task 1
  - `.card` / `.kpi-card` / `.kpi-card::before` / `.kpi-card::after` / `.kpi-card.gold` etc. CSS (~lines 160-171) — Task 2
  - 3 KPI-array render sites: `renderOverview` (~line 2039), `renderPage` organic (~line 2722), `renderPage` paid (~line 2839) — Task 3
  - `PAGE_COLORS` (~line 2206) and `getChartThemeColors()` (~line 4508) — Task 4

No new files. No file is large enough here to warrant a split — all changes are small, targeted edits to existing CSS rules and existing JS array literals.

---

## Task 1: Root design tokens + shape

**Files:**
- Modify: `index.html:19-44` (`:root` and `html[data-theme="dark"]` blocks)

**Interfaces:**
- Produces: updated values for `--bg`, `--surface`, `--surface2`, `--border`, `--border2`, `--accent`, `--accent-soft`, `--accent-text`, `--text`, `--text2`, `--text3`, `--gold`, `--green`, `--red`, `--purple`, `--blue`, `--cyan`, `--sidebar-grad` (dark-mode override, new), `--radius`, `--radius-sm`. Tasks 2-4 read these same token names — do not rename any of them.

- [ ] **Step 1: Update `:root` (light mode) token values**

Find:
```css
:root{
  --bg:#f8f9fa; --surface:#ffffff; --surface2:#f1f3f4;
  --border:#e8eaed; --border2:#dadce0;
  --sidebar:#ffffff; --sidebar-w:252px; --sidebar-w-collapsed:76px;
  --sidebar-grad:linear-gradient(165deg,#3b8bf0 0%,#1a73e8 45%,#0f4fb0 100%);
  --accent:#1a73e8; --accent-soft:#e8f0fe; --accent-text:#1967d2;
  --blue:#1a73e8; --gold:#f9ab00; --green:#1e8e3e; --red:#d93025; --purple:#a142f4; --cyan:#12a4af;
  --text:#202124; --text2:#5f6368; --text3:#80868b;
  --muted:#5f6368; --primary:#1a73e8; --card:#ffffff;
  --radius:12px; --radius-sm:8px;
  --shadow:0 1px 2px 0 rgba(60,64,67,.30),0 2px 6px 2px rgba(60,64,67,.15);
  --shadow-sm:0 1px 2px 0 rgba(60,64,67,.30),0 1px 3px 1px rgba(60,64,67,.15);
  --transition:.2s ease;
  --font-head:'Google Sans','Roboto',Arial,sans-serif;
}
```

Replace with:
```css
:root{
  --bg:#f3f6fb; --surface:#ffffff; --surface2:#f1f3f4;
  --border:#e8eaed; --border2:#dadce0;
  --sidebar:#ffffff; --sidebar-w:252px; --sidebar-w-collapsed:76px;
  --sidebar-grad:linear-gradient(165deg,#38bdf8 0%,#0ea5e9 45%,#0369a1 100%);
  --accent:#0ea5e9; --accent-soft:#e0f2fe; --accent-text:#0284c7;
  --blue:#0ea5e9; --gold:#f59e0b; --green:#10b981; --red:#ef4444; --purple:#8b5cf6; --cyan:#06b6d4;
  --text:#202124; --text2:#5f6368; --text3:#80868b;
  --muted:#5f6368; --primary:#0ea5e9; --card:#ffffff;
  --radius:18px; --radius-sm:12px;
  --shadow:0 1px 2px 0 rgba(60,64,67,.30),0 2px 6px 2px rgba(60,64,67,.15);
  --shadow-sm:0 1px 2px 0 rgba(60,64,67,.30),0 1px 3px 1px rgba(60,64,67,.15);
  --transition:.2s ease;
  --font-head:'Google Sans','Roboto',Arial,sans-serif;
}
```

(Only `--bg`, `--sidebar-grad`, `--accent`, `--accent-soft`, `--accent-text`, `--blue/--gold/--green/--red/--purple/--cyan`, `--primary`, `--radius`, `--radius-sm` change. `--surface`, `--border*`, `--text*`, `--shadow*` stay identical — the spec deliberately keeps the light shell's neutrals unchanged, only shifting the accent family and shape.)

- [ ] **Step 2: Update `html[data-theme="dark"]` token values**

Find:
```css
html[data-theme="dark"]{
  --bg:#202124; --surface:#292a2d; --surface2:#35363a;
  --border:#3c4043; --border2:#5f6368;
  --sidebar:#292a2d;
  --accent:#8ab4f8; --accent-soft:rgba(138,180,248,.16); --accent-text:#8ab4f8;
  --blue:#8ab4f8; --gold:#fdd663; --green:#81c995; --red:#f28b82; --purple:#d7aefb; --cyan:#78d9ec;
  --text:#e8eaed; --text2:#9aa0a6; --text3:#80868b;
  --muted:#9aa0a6; --primary:#8ab4f8; --card:#292a2d;
  --shadow:0 1px 2px 0 rgba(0,0,0,.55),0 2px 6px 2px rgba(0,0,0,.35);
  --shadow-sm:0 1px 2px 0 rgba(0,0,0,.55),0 1px 3px 1px rgba(0,0,0,.35);
}
```

Replace with:
```css
html[data-theme="dark"]{
  --bg:#0d1017; --surface:#171b26; --surface2:#1f2532;
  --border:#262c3b; --border2:#333a4d;
  --sidebar:#171b26;
  --sidebar-grad:linear-gradient(165deg,#22315a 0%,#101a33 55%,#0a1224 100%);
  --accent:#38bdf8; --accent-soft:rgba(56,189,248,.16); --accent-text:#7dd3fc;
  --blue:#38bdf8; --gold:#fbbf24; --green:#34d399; --red:#f87171; --purple:#a78bfa; --cyan:#5eead4;
  --text:#eef2f7; --text2:#9aa7bb; --text3:#6b7688;
  --muted:#9aa7bb; --primary:#38bdf8; --card:#171b26;
  --shadow:0 16px 34px -14px rgba(15,79,176,.45),0 2px 8px rgba(0,0,0,.35);
  --shadow-sm:0 8px 18px -10px rgba(15,79,176,.4),0 1px 3px rgba(0,0,0,.35);
}
```

(This block now also declares `--sidebar-grad`, overriding the `:root` value only when dark mode is active — this is the "new dark-mode-specific declaration" mentioned in Global Constraints, not a new token name.)

- [ ] **Step 3: Verify in the Browser pane**

Navigate to `index.html`, hide `#app-loading` via `javascript_tool`, then run:

```javascript
(function(){
  const light = getComputedStyle(document.documentElement);
  document.documentElement.setAttribute('data-theme','dark');
  const dark = getComputedStyle(document.documentElement);
  const r = { lightBg: light.getPropertyValue('--bg').trim(), lightAccent: light.getPropertyValue('--accent').trim(),
    lightRadius: light.getPropertyValue('--radius').trim(),
    darkBg: dark.getPropertyValue('--bg').trim(), darkAccent: dark.getPropertyValue('--accent').trim(),
    darkSidebarGrad: dark.getPropertyValue('--sidebar-grad').trim() };
  document.documentElement.removeAttribute('data-theme');
  return JSON.stringify(r);
})();
```

Expected: `lightBg:"#f3f6fb"`, `lightAccent:"#0ea5e9"`, `lightRadius:"18px"`, `darkBg:"#0d1017"`, `darkAccent:"#38bdf8"`, `darkSidebarGrad` starts with `"linear-gradient(165deg,#22315a"`. Confirm `read_console_messages({onlyErrors:true})` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: navy/cyan design tokens for light and dark theme"
```

---

## Task 2: Card, KPI-card base, and sidebar shared component restyle

**Files:**
- Modify: `index.html:160-171` (`.card`, `.kpi-card`, `.kpi-card::before`, `.kpi-card::after`)

**Interfaces:**
- Consumes: tokens from Task 1 (`--radius`, `--surface`, `--border`, `--shadow`, category color vars).
- Produces: `.kpi-card` with `::before` kept (left accent stripe) and `::after` **removed** (Task 3's `.kpi-ico` replaces it) — Task 3 depends on `::after` being gone so the new icon badge is the only decorative accent in the top-right area.

- [ ] **Step 1: Update `.card`**

Find:
```css
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:18px;transform-origin:center center;transition:border-color .28s cubic-bezier(.2,.8,.2,1),box-shadow .28s cubic-bezier(.2,.8,.2,1),transform .28s cubic-bezier(.2,.8,.2,1)}
.card:hover{border-color:var(--border2);box-shadow:var(--shadow);transform:scale(1.008)}
```

Replace with:
```css
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:18px;transform-origin:center center;box-shadow:var(--shadow-sm);transition:border-color .28s cubic-bezier(.2,.8,.2,1),box-shadow .28s cubic-bezier(.2,.8,.2,1),transform .28s cubic-bezier(.2,.8,.2,1)}
.card:hover{border-color:var(--border2);box-shadow:var(--shadow);transform:scale(1.008)}
html[data-theme="dark"] .card{border-color:transparent}
```

(Base `box-shadow:var(--shadow-sm)` now applies at rest, not just on hover — in dark mode this is the soft navy glow from Task 1's new `--shadow-sm`; in light mode `--shadow-sm` is unchanged from before, so light mode's resting look is effectively identical to today, just with the bigger radius. The dark-mode-only border removal keeps the "borderless, floating on dark" look from the spec without touching light mode's existing border.)

- [ ] **Step 2: Update `.kpi-card`, remove `::after`, keep `::before`**

Find:
```css
.kpi-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:19px 21px;position:relative;overflow:hidden;transform-origin:center center;color:var(--accent);transition:transform .28s cubic-bezier(.2,.8,.2,1),box-shadow .28s cubic-bezier(.2,.8,.2,1)}
.kpi-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:currentColor;opacity:.9;border-radius:4px 0 0 4px}
.kpi-card::after{content:'';position:absolute;top:-28px;right:-28px;width:96px;height:96px;border-radius:50%;background:currentColor;opacity:.045}
.kpi-card:hover{box-shadow:var(--shadow);transform:scale(1.02)}
```

Replace with:
```css
.kpi-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:19px 56px 19px 21px;position:relative;overflow:hidden;transform-origin:center center;box-shadow:var(--shadow-sm);color:var(--accent);transition:transform .28s cubic-bezier(.2,.8,.2,1),box-shadow .28s cubic-bezier(.2,.8,.2,1)}
.kpi-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:currentColor;opacity:.9;border-radius:4px 0 0 4px}
.kpi-card:hover{box-shadow:var(--shadow);transform:scale(1.02)}
html[data-theme="dark"] .kpi-card{border-color:transparent}
```

(`padding-right` goes from `21px` to `56px` to leave room for the icon badge Task 3 adds. `::after` is deleted entirely — do not leave a dangling empty rule.)

- [ ] **Step 3: Verify in the Browser pane**

```javascript
(function(){
  const kpi = document.querySelector('.kpi-card') || (function(){
    // if no kpi-card is present yet (data not loaded), create a throwaway one to inspect the rule
    const d = document.createElement('div'); d.className = 'kpi-card gold'; document.body.appendChild(d);
    return d;
  })();
  const cs = getComputedStyle(kpi);
  const r = { radius: cs.borderRadius, paddingRight: cs.paddingRight, boxShadow: cs.boxShadow.slice(0,30) };
  if (kpi.parentElement === document.body) kpi.remove(); // clean up the throwaway node
  return JSON.stringify(r);
})();
```

Expected: `radius:"18px"`, `paddingRight:"56px"`, `boxShadow` non-empty (matches `--shadow-sm`). Confirm no console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: restyle .card and .kpi-card for navy/cyan direction"
```

---

## Task 3: Per-KPI icon badges

**Files:**
- Modify: `index.html` — new `.kpi-ico` CSS rule (near the `.kpi-card` rules from Task 2, ~line 171) and the 3 KPI-array render sites (~lines 2039, 2722, 2839).

**Interfaces:**
- Consumes: `.kpi-card.gold/.green/.red/.purple/.blue/.teal` (existing, sets `color: var(--gold|...)`, unaffected by this task) and the removed `::after` slot from Task 2.
- Produces: `.kpi-ico` CSS class (icon badge). Each KPI object literal across the 3 sites gains an `icon:'<emoji>'` field, and each site's template string gains a `<div class="kpi-ico">${k.icon}</div>` as the KPI card's first child.

- [ ] **Step 1: Add the `.kpi-ico` CSS rule**

Find (this is the line Task 2 left as the last line of the `.kpi-card` block):
```css
html[data-theme="dark"] .kpi-card{border-color:transparent}
```

Add immediately after it:
```css
.kpi-ico{position:absolute;top:16px;right:16px;width:34px;height:34px;border-radius:50%;background:color-mix(in srgb, currentColor 16%, transparent);display:flex;align-items:center;justify-content:center;font-size:15px}
```

- [ ] **Step 2: Add icons to the Overview KPI array + template**

Find:
```javascript
  document.getElementById('kpi-grid').innerHTML = [
    { l:'Tổng chi phí',      v: spend,   fmt:'num', s: dayLabel,           c:'' },
    { l:'ROAS trung bình',   v: avgROAS, fmt:'x',   s:'Doanh thu/Chi phí', c:'green' },
    { l:'Tổng tiếp cận',     v: reach,   fmt:'num', s:'Unique users',      c:'purple' },
    { l:'Tổng hiển thị',     v: impr,    fmt:'num', s:'Impressions',       c:'' },
    { l:'Mua hàng',          v: purch,   fmt:'num', s:'Purchases',         c:'gold' },
    { l:'Thêm giỏ hàng',     v: cart,    fmt:'num', s:'Add to Cart',       c:'gold' },
    { l:'Link Clicks',       v: lclicks, fmt:'num', s:'Lượt click link',   c:'' },
    { l:'CTR trung bình',    v: avgCTR,  fmt:'%',   s:'Click-through rate',c: avgCTR>=1?'green':'red' },
  ].map(k => `
    <div class="kpi-card ${k.c}">
      <div class="kpi-label">${k.l}</div>
      <div class="kpi-value kpi-num" data-val="${k.v}" data-fmt="${k.fmt}">0</div>
      <div class="kpi-sub">${k.s}</div>
    </div>`).join('');
```

Replace with:
```javascript
  document.getElementById('kpi-grid').innerHTML = [
    { l:'Tổng chi phí',      v: spend,   fmt:'num', s: dayLabel,           c:'',       icon:'💰' },
    { l:'ROAS trung bình',   v: avgROAS, fmt:'x',   s:'Doanh thu/Chi phí', c:'green',  icon:'📈' },
    { l:'Tổng tiếp cận',     v: reach,   fmt:'num', s:'Unique users',      c:'purple', icon:'👥' },
    { l:'Tổng hiển thị',     v: impr,    fmt:'num', s:'Impressions',       c:'',       icon:'👁️' },
    { l:'Mua hàng',          v: purch,   fmt:'num', s:'Purchases',         c:'gold',   icon:'🛒' },
    { l:'Thêm giỏ hàng',     v: cart,    fmt:'num', s:'Add to Cart',       c:'gold',   icon:'🛍️' },
    { l:'Link Clicks',       v: lclicks, fmt:'num', s:'Lượt click link',   c:'',       icon:'🔗' },
    { l:'CTR trung bình',    v: avgCTR,  fmt:'%',   s:'Click-through rate',c: avgCTR>=1?'green':'red', icon:'🖱️' },
  ].map(k => `
    <div class="kpi-card ${k.c}">
      <div class="kpi-ico">${k.icon}</div>
      <div class="kpi-label">${k.l}</div>
      <div class="kpi-value kpi-num" data-val="${k.v}" data-fmt="${k.fmt}">0</div>
      <div class="kpi-sub">${k.s}</div>
    </div>`).join('');
```

- [ ] **Step 3: Add icons to the Page (organic) KPI array + template**

Find:
```javascript
    document.getElementById('page-kpi-grid').innerHTML = [
      { l:'Follow mới',         v: '+'+fmtNum(totalNew),                     s:'30 ngày',             c:'green'  },
      { l:'Bỏ Follow',          v: '-'+fmtNum(totalLost),                    s:'30 ngày',             c:'red'    },
      { l:'Thay đổi net',       v: (netFol>=0?'+':'')+fmtNum(netFol),       s:'30 ngày',             c: netFol>=0?'green':'red' },
      { l:'Lượt xem trang',     v: fmtNum(totalViews),                       s:'Page views',          c:''       },
      { l:'Tương tác bài viết', v: fmtNum(totalEng),                         s:'Post engagements',    c:'gold'   },
      { l:'Hành động trang',    v: fmtNum(totalAct),                         s:'Page actions',        c:''       },
      { l:'Video views',        v: fmtNum(totalVid),                         s:'30 ngày',             c:'purple' },
    ].map(k=>`<div class="kpi-card ${k.c}"><div class="kpi-label">${k.l}</div><div class="kpi-value">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');
```

Replace with:
```javascript
    document.getElementById('page-kpi-grid').innerHTML = [
      { l:'Follow mới',         v: '+'+fmtNum(totalNew),                     s:'30 ngày',             c:'green',  icon:'⬆️' },
      { l:'Bỏ Follow',          v: '-'+fmtNum(totalLost),                    s:'30 ngày',             c:'red',    icon:'⬇️' },
      { l:'Thay đổi net',       v: (netFol>=0?'+':'')+fmtNum(netFol),       s:'30 ngày',             c: netFol>=0?'green':'red', icon:'🔀' },
      { l:'Lượt xem trang',     v: fmtNum(totalViews),                       s:'Page views',          c:'',       icon:'👁️' },
      { l:'Tương tác bài viết', v: fmtNum(totalEng),                         s:'Post engagements',    c:'gold',   icon:'💬' },
      { l:'Hành động trang',    v: fmtNum(totalAct),                         s:'Page actions',        c:'',       icon:'⚡' },
      { l:'Video views',        v: fmtNum(totalVid),                         s:'30 ngày',             c:'purple', icon:'▶️' },
    ].map(k=>`<div class="kpi-card ${k.c}"><div class="kpi-ico">${k.icon}</div><div class="kpi-label">${k.l}</div><div class="kpi-value">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');
```

- [ ] **Step 4: Add icons to the Page (paid) KPI array + template**

Find:
```javascript
  document.getElementById('page-paid-kpi').innerHTML = [
    { l:'Chi phí',            v: fmtNum(tSpend)+'đ',   s:'Paid spend',           c:''       },
    { l:'Tiếp cận',           v: fmtNum(tReach),        s:'Paid reach',           c:'blue'   },
    { l:'Hiển thị',           v: fmtNum(tImpr),         s:'Impressions',          c:''       },
    { l:'Kết quả',            v: fmtNum(tResults),      s:'Paid results',         c:'green'  },
    { l:'CPR',                v: fmtNum(cpr)+'đ',       s:'Chi phí/kết quả',      c:'gold'   },
    { l:'CPM',                v: fmtNum(cpm)+'đ',       s:'Chi phí/1000 hiển thị',c:''       },
  ].map(k=>`<div class="kpi-card ${k.c}"><div class="kpi-label">${k.l}</div><div class="kpi-value">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');
```

Replace with:
```javascript
  document.getElementById('page-paid-kpi').innerHTML = [
    { l:'Chi phí',            v: fmtNum(tSpend)+'đ',   s:'Paid spend',           c:'',      icon:'💰' },
    { l:'Tiếp cận',           v: fmtNum(tReach),        s:'Paid reach',           c:'blue',  icon:'👥' },
    { l:'Hiển thị',           v: fmtNum(tImpr),         s:'Impressions',          c:'',      icon:'👁️' },
    { l:'Kết quả',            v: fmtNum(tResults),      s:'Paid results',         c:'green', icon:'✅' },
    { l:'CPR',                v: fmtNum(cpr)+'đ',       s:'Chi phí/kết quả',      c:'gold',  icon:'🎯' },
    { l:'CPM',                v: fmtNum(cpm)+'đ',       s:'Chi phí/1000 hiển thị',c:'',      icon:'📐' },
  ].map(k=>`<div class="kpi-card ${k.c}"><div class="kpi-ico">${k.icon}</div><div class="kpi-label">${k.l}</div><div class="kpi-value">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');
```

- [ ] **Step 5: Verify in the Browser pane**

Mock enough data to trigger a real render (or construct a throwaway element to test the CSS rule in isolation if full data isn't available):

```javascript
(function(){
  const el = document.createElement('div');
  el.className = 'kpi-card gold';
  el.innerHTML = '<div class="kpi-ico">💰</div><div class="kpi-label">Test</div><div class="kpi-value">1</div>';
  document.body.appendChild(el);
  const ico = el.querySelector('.kpi-ico');
  const cs = getComputedStyle(ico);
  const r = { width: cs.width, borderRadius: cs.borderRadius, background: cs.backgroundColor, position: cs.position, iconText: ico.textContent };
  el.remove();
  return JSON.stringify(r);
})();
```

Expected: `width:"34px"`, `borderRadius:"50%"`, `background` a non-transparent rgba/rgb value (the `color-mix()` result — if the browser doesn't support `color-mix()` this would read as `rgba(0, 0, 0, 0)` or the raw `color-mix(...)` string; if so, note this as a concern in your report rather than silently proceeding), `position:"absolute"`, `iconText:"💰"`.

Then confirm each of the 3 render functions was edited correctly by searching the file for `kpi-ico` and counting occurrences — expect exactly 4 (1 CSS rule + 3 template strings):

```bash
grep -c "kpi-ico" index.html
```

Expected: `4`.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add semantic icon badges to all 21 KPI cards"
```

---

## Task 4: Chart colors

**Files:**
- Modify: `index.html:2206` (`PAGE_COLORS`), `index.html:4508-4517` (`getChartThemeColors`)

**Interfaces:**
- Produces: updated `PAGE_COLORS` array (same length/shape, 8 hex strings) and `getChartThemeColors()` (same return shape: `{textColor, gridColor, tooltipBg, tooltipText, axisText}`) — no signature changes, only values, so no caller elsewhere in the file needs touching.

- [ ] **Step 1: Update `PAGE_COLORS`**

Find:
```javascript
const PAGE_COLORS = ['#2563eb','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#ec4899','#84cc16'];
```

Replace with:
```javascript
const PAGE_COLORS = ['#38bdf8','#34d399','#fbbf24','#a78bfa','#f87171','#5eead4','#f472b6','#a3e635'];
```

- [ ] **Step 2: Update `getChartThemeColors()`**

Find:
```javascript
function getChartThemeColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    textColor:   isDark ? '#e8eaed' : '#202124',
    gridColor:   isDark ? 'rgba(232,234,237,0.10)' : 'rgba(60,64,67,0.10)',
    tooltipBg:   isDark ? 'rgba(41,42,45,0.95)' : 'rgba(255,255,255,0.97)',
    tooltipText: isDark ? '#9aa0a6' : '#5f6368',
    axisText:    isDark ? '#9aa0a6' : '#5f6368'
  };
}
```

Replace with:
```javascript
function getChartThemeColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    textColor:   isDark ? '#eef2f7' : '#202124',
    gridColor:   isDark ? 'rgba(238,242,247,0.08)' : 'rgba(60,64,67,0.10)',
    tooltipBg:   isDark ? 'rgba(23,27,38,0.95)' : 'rgba(255,255,255,0.97)',
    tooltipText: isDark ? '#9aa7bb' : '#5f6368',
    axisText:    isDark ? '#9aa7bb' : '#5f6368'
  };
}
```

(Light-mode values are unchanged — only the `isDark` branch moves to the new dark palette, matching Task 1's new `--text`/`--surface`/`--text2` dark values.)

- [ ] **Step 3: Verify in the Browser pane**

```javascript
(function(){
  const light = getChartThemeColors();
  document.documentElement.setAttribute('data-theme','dark');
  const dark = getChartThemeColors();
  document.documentElement.removeAttribute('data-theme');
  return JSON.stringify({ light, dark, pageColorsFirst: typeof PAGE_COLORS !== 'undefined' ? PAGE_COLORS[0] : 'PAGE_COLORS not in scope here' });
})();
```

Expected: `light.textColor:"#202124"`, `dark.textColor:"#eef2f7"`, `dark.tooltipBg:"rgba(23,27,38,0.95)"`. If `PAGE_COLORS` reports "not in scope here" (it's a top-level `const`, should be globally accessible — if this happens, note it in your report rather than assuming it's fine), separately confirm via:

```bash
grep -n "const PAGE_COLORS" index.html
```

Expected: shows the new `#38bdf8` first entry.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: update chart colors (PAGE_COLORS, getChartThemeColors) for navy/cyan theme"
```

---

## Task 5: End-to-end visual verification

**Files:** none (verification only)

**Interfaces:** none — this task exercises Tasks 1-4 together across real tabs.

- [ ] **Step 1: Combined browser walkthrough**

Navigate to `index.html`, hide `#app-loading`. If live data isn't available in this environment (no `google.script.run` backend), mock `getDashboardData` (or whatever the main data-load call is — search for it if unsure) with a minimal realistic payload covering Ads/Page data, so `renderOverview()` and `renderPage()` actually populate `#kpi-grid`/`#page-kpi-grid`/`#page-paid-kpi` with real rendered cards (not empty states) — this is necessary to visually confirm the icon badges in context, not just via the isolated-element checks from Tasks 2-3.

Then, in light mode:
1. Confirm `#kpi-grid` shows 8 cards, each with a visible circular icon badge top-right containing the correct emoji per Section 3's table.
2. Switch to the "Trang" tab, confirm `#page-kpi-grid` (7 cards) and `#page-paid-kpi` (6 cards) similarly show correct icons.
3. Check a `.card` (any tab with a plain card, e.g. a chart container) has the new 18px radius and a visible soft shadow at rest (not just on hover).
4. Check the sidebar still shows the (now re-themed) cyan-blue gradient, collapse/expand still works (this is Task 1's `--sidebar-grad` change, not new sidebar logic — confirm it didn't regress).

Then toggle to dark mode (`document.documentElement.setAttribute('data-theme','dark')` or the app's own theme-toggle button if present) and repeat 1-4, confirming the navy background, cyan accent, and borderless glowing cards.

Finally, click into the "Kế hoạch nội dung" tab (Content Plan) and confirm it still functions (loads, no JS errors) — its visual mismatch with the new theme is expected and correct per Global Constraints, not a bug to report.

2. **Console check:** `read_console_messages({onlyErrors:true})` across the whole walkthrough — expect zero entries.

- [ ] **Step 2: Confirm no unintended diff scope**

```bash
git log --oneline -6
```

This plan's Tasks 1-4 should be the 4 most recent commits (or the 4 most recent `feat:` commits touching `index.html`, if Task 5's own housekeeping commits are already present). Use the commit immediately before Task 1's first commit as `BASE` in:

```bash
git diff --stat BASE..HEAD -- index.html
```

Confirm the diff touches only the regions listed in this plan's File Structure section — if it looks much larger than 4 tasks' worth of targeted edits, investigate before proceeding, per this project's established commit-hygiene practice (an earlier feature's Task 4 once accidentally swept in ~1150 unrelated lines from a stale working tree).

- [ ] **Step 3: Final commit (if anything was left uncommitted)**

```bash
git status --short
```

If `index.html` shows as modified here, something wasn't committed in Tasks 1-4 — investigate and commit it with an accurate message. If clean, no commit is needed for this task.

---

## Self-Review Notes (already applied above)

- **Spec coverage:** Section 1 (tokens) → Task 1. Section 2 (shared components: card/kpi-card/sidebar) → Task 1 (`--sidebar-grad`) + Task 2 (`.card`/`.kpi-card`). Section 3 (icon badges, full 21-item table) → Task 3, every row of the spec's 3 tables has a corresponding line in Task 3's Steps 2-4. Section 4 (charts) → Task 4. Non-goals (`tile()`, Content Plan modals) → called out explicitly in Global Constraints and Task 5 Step 1, not silently touched anywhere.
- **Type consistency:** `getChartThemeColors()`'s return shape (`textColor/gridColor/tooltipBg/tooltipText/axisText`) is unchanged from the existing signature — Task 4 only edits values, confirmed no caller elsewhere needs updating. `.kpi-ico` is referenced identically (class name, no variants) across all 3 template-string edits in Task 3.
- **No placeholders:** every step above has the exact current file content as the "Find" block and the exact replacement as the "Replace" block — no task requires the implementer to invent unlisted values.
