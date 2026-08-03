# Navy/Cyan Visual Redesign — Design Spec

Date: 2026-08-01
Status: Approved by user, ready for implementation planning

## Background

The user shared a reference image of a "Smart Home" mobile app UI kit: dark
navy screens, a thin cyan-blue gradient accent bar on the left edge of each
card, circular soft-tinted icon badges, toggle switches, and a cyan donut
progress ring. They asked to restyle the dashboard's whole interface (both
light and dark modes) in this direction.

A brainstorming session (using the visual-companion browser tool to compare
3 concrete color/shape directions side by side) established the following,
confirmed by the user at each step:

- **Direction chosen**: "A" — Dark mode changes fully to a navy+cyan palette
  matching the reference; Light mode keeps a light background but adopts the
  same rounded/shadow/icon-badge visual language, with its accent color also
  shifted to cyan-blue (not staying on the current Google-blue `#1a73e8`) for
  consistency between the two modes.
- **Sidebar**: the floating gradient sidebar built in an earlier session gets
  re-themed to match the new navy/cyan palette (not left as a separate blue).
- **KPI card icons**: the user explicitly chose *per-KPI, semantically
  correct* icons (e.g. "Mua hàng" → 🛒) over the cheaper "one icon per color
  category" shortcut, despite the extra implementation work.

## Key architectural fact this design leans on

The dashboard already uses CSS custom properties (design tokens) for nearly
all color/shape values, and shared component classes (`.card`, `.kpi-card`,
`table`/`th`/`td`, `.btn*`, `.badge-pill`, `.date-btn`, `.nav-tab`) that every
tab reuses. **Changing the root tokens and these shared component rules
restyles every tab automatically** — this is a token-and-shared-component
redesign, not a per-tab rewrite. The one exception is per-KPI icons, which
requires touching each of the 3 places that build a `.kpi-card` array (21
KPI items total), because the icon is semantic content, not a token.

## Explicit non-goals (documented scope boundaries)

- **The `tile()` mini-stat component** (used in Bài đăng/GSC/GA4 summaries —
  a different, simpler component from `.kpi-card`, already has its own
  per-metric inline hex color) is **not** touched in this pass. It keeps its
  current look. A later pass could extend icon-badges to it if wanted.
- **The Content Plan tab's modals/forms** (built in an earlier SDD session)
  use hardcoded inline hex colors rather than CSS custom properties, so they
  will **not** automatically pick up the new palette. Bringing them onto
  tokens is out of scope here — noted as a known follow-up, not silently
  fixed or silently left inconsistent without documentation.
- No new features, no data/logic changes — this is styling only.

## Section 1 — Color tokens

### Dark mode (`html[data-theme="dark"]`) — full navy+cyan repaint

| Token | Old | New |
|---|---|---|
| `--bg` | `#202124` | `#0d1017` |
| `--surface` | `#292a2d` | `#171b26` |
| `--surface2` | `#35363a` | `#1f2532` |
| `--border` | `#3c4043` | `#262c3b` |
| `--border2` | `#5f6368` | `#333a4d` |
| `--accent` | `#8ab4f8` | `#38bdf8` |
| `--accent-soft` | `rgba(138,180,248,.16)` | `rgba(56,189,248,.16)` |
| `--accent-text` | `#8ab4f8` | `#7dd3fc` |
| `--text` | `#e8eaed` | `#eef2f7` |
| `--text2` | `#9aa0a6` | `#9aa7bb` |
| `--text3` | `#80868b` | `#6b7688` |
| `--gold/--green/--red/--purple/--blue/--cyan` | (existing) | `#fbbf24 / #34d399 / #f87171 / #a78bfa / #38bdf8 / #5eead4` |
| `--sidebar-grad` | n/a (new token) | `linear-gradient(165deg,#22315a 0%,#101a33 55%,#0a1224 100%)` |

Cards in dark mode drop their visible 1px border in favor of the
surface/background contrast plus a soft shadow (`0 16px 34px -12px
rgba(15,79,176,.35)`-style glow, reusing the shadow approach already built
for the sidebar) — matching the reference's borderless "floating on dark"
card look.

### Light mode (`:root`) — accent shifts to cyan-blue, shell stays light

| Token | Old | New |
|---|---|---|
| `--bg` | `#f8f9fa` | `#f3f6fb` |
| `--accent` | `#1a73e8` | `#0ea5e9` |
| `--accent-soft` | `#e8f0fe` | `#e0f2fe` |
| `--accent-text` | `#1967d2` | `#0284c7` |
| `--gold/--green/--red/--purple/--blue/--cyan` | (existing) | `#f59e0b / #10b981 / #ef4444 / #8b5cf6 / #0ea5e9 / #06b6d4` |
| `--sidebar-grad` | n/a (new token) | `linear-gradient(165deg,#38bdf8 0%,#0ea5e9 45%,#0369a1 100%)` |

`--surface`, `--border`, `--text*` stay at their current light-mode values —
only the accent family and sidebar move to cyan-blue; the light shell itself
is not otherwise darkened or re-hued.

### Shape tokens (both modes)

| Token | Old | New |
|---|---|---|
| `--radius` | `12px` | `18px` |
| `--radius-sm` | `8px` | `12px` |

## Section 2 — Shared components

- **`.card`**: bigger radius (18px). Dark mode: border removed, soft glow
  shadow added on the base state (not just `:hover` as today).
- **`.kpi-card`**: keeps its existing structure (`::before` = 4px left
  accent stripe in the category color, already matches the reference's
  accent-bar language) — only token values change, plus the new icon badge
  (see Section 3). The existing `::after` big soft background circle is
  **removed** — the new icon badge replaces it as the card's visual accent
  in the top-right corner, avoiding two competing decorative elements.
- **Sidebar**: re-themed from the flat `--accent` blue gradient to
  `var(--sidebar-grad)` (defined per-mode above) — same floating/collapsible
  mechanics already built, only the color changes.
- **Table, buttons, badge-pill, date-btn**: no structural changes — they
  already read from `var(--...)` tokens, so the new palette applies
  automatically with zero additional edits.

## Section 3 — Per-KPI icon badges

A new `.kpi-ico` element (real DOM, not a CSS pseudo-element) is added to
each `.kpi-card`: a 34px circle, absolutely positioned top-right, tinted
background per category color, emoji centered inside at 15px.

`.kpi-card.gold/.green/.red/.purple/.blue/.teal` already set `color:
var(--gold|...)` (existing code), so `.kpi-ico`'s background must be a
*solid, theme-adaptive* tint of that same `currentColor` — not `opacity`,
which would also fade the emoji glyph nested inside it. Use CSS
`color-mix()`, which produces a real solid color and only affects the
element it's set on:

```css
.kpi-ico{
  position:absolute;top:16px;right:16px;width:34px;height:34px;border-radius:50%;
  background:color-mix(in srgb, currentColor 16%, transparent);
  display:flex;align-items:center;justify-content:center;font-size:15px;
}
```

This one rule automatically produces the correct tint for every category in
both themes (since `currentColor` already resolves per `.kpi-card.<class>`
and per active theme) — no per-category, per-theme rgba() overrides needed.

```html
<div class="kpi-card ${k.c}">
  <div class="kpi-ico">${k.icon}</div>
  <div class="kpi-label">${k.l}</div>
  <div class="kpi-value">${k.v}</div>
  <div class="kpi-sub">${k.s}</div>
</div>
```

`.kpi-card` gets `padding-right` increased so label/value/sub text doesn't
collide with the badge.

### Full icon assignment (21 KPI items, 3 render sites)

**Overview (`#kpi-grid`, `renderOverview`)**

| Label | Icon |
|---|---|
| Tổng chi phí | 💰 |
| ROAS trung bình | 📈 |
| Tổng tiếp cận | 👥 |
| Tổng hiển thị | 👁️ |
| Mua hàng | 🛒 |
| Thêm giỏ hàng | 🛍️ |
| Link Clicks | 🔗 |
| CTR trung bình | 🖱️ |

**Trang — Organic (`#page-kpi-grid`, `renderPage`)**

| Label | Icon |
|---|---|
| Follow mới | ⬆️ |
| Bỏ Follow | ⬇️ |
| Thay đổi net | 🔀 |
| Lượt xem trang | 👁️ |
| Tương tác bài viết | 💬 |
| Hành động trang | ⚡ |
| Video views | ▶️ |

**Trang — Paid (`#page-paid-kpi`, `renderPage`)**

| Label | Icon |
|---|---|
| Chi phí | 💰 |
| Tiếp cận | 👥 |
| Hiển thị | 👁️ |
| Kết quả | ✅ |
| CPR | 🎯 |
| CPM | 📐 |

(Icons repeat across the 3 sites where the metric is conceptually the same,
e.g. 💰 for every "chi phí" — this is intentional, not an oversight.)

## Section 4 — Charts

- `getChartThemeColors()` (the function feeding Chart.js grid/tick/tooltip
  colors per light/dark mode) is updated to read the new token values so
  chart chrome (axis lines, tooltip background) matches the new palette
  automatically.
- `PAGE_COLORS` (the categorical series palette used by `mkDoughnut`) is
  updated to a set that stays visually distinct against both the new light
  and dark surfaces while keeping the same cyan-blue family lead color.

## Error handling / risk notes

- **Emoji rendering consistency**: emoji glyphs render via the OS/browser's
  color-emoji font and ignore CSS `color`, so the icon badges' appearance is
  consistent regardless of the category tint behind them — no dark-mode
  contrast risk for the icons themselves.
- **Existing inline-hex code untouched**: because Content Plan's modals and
  the `tile()` component are explicitly out of scope (Section "non-goals"),
  no attempt is made to retrofit them — reviewers should not flag their
  continued use of hardcoded colors as a defect introduced by this change.
- **`--sidebar-grad` already exists as a token** (added in the prior
  sidebar-redesign session) but is currently only defined once in `:root` —
  the dark-mode override block (`html[data-theme="dark"]`) does not
  redefine it, so today both modes silently share the same blue gradient.
  This pass adds a dark-mode-specific `--sidebar-grad` override so each
  theme gets its own value, per Section 1's table — implementers should
  edit the existing declaration in `:root` (light value) and add a new one
  inside the dark override block, not introduce a second, differently-named
  token.
