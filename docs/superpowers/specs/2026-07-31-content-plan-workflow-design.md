# Content Plan + Workflow — Design Spec

Date: 2026-07-31
Status: Approved by user, ready for implementation planning

## Background

While onboarding a reference spreadsheet (`Marketing FUjiwa.xlsx`, a separate, much larger
marketing-ops workbook the user also uses), we identified a useful pattern not present in the
Apps Script dashboard (`meta.gs`/`code.gs`/`index.html`): a **Config-driven content production
workflow** — a roster + per-format stage template (`⚙️ Config`) that, combined with a content
plan (`📋 Posts`), auto-generates a task list (`🔄 Workflow`) with computed deadlines and
role-based assignment.

The user asked to replicate this pattern — scoped down — inside the existing dashboard, as a new
capability alongside the Meta/TikTok reporting already built.

## Goal

Let the Fujiwa marketing team plan upcoming content (not yet published) and track its production
pipeline (Brief → Design/Script/Quay → Caption → Review, per content Format) directly from the
existing dashboard web app, with automatic deadline computation and a personal "my tasks" view.

## Non-goals (explicitly out of scope for this iteration)

- No "edit an existing content plan item" form — only create. Corrections happen by editing the
  `Kế hoạch nội dung` sheet directly (rare, not the common path).
- No Kanban/drag-and-drop board — a filterable table is enough.
- No dashboard UI for editing `Config ND` (roster / stage templates) — edited directly in the
  Sheet, same as `config.gs` constants are today. This data changes rarely.
- Nothing from the reference workbook's other modules (Ads Library / Gap Analysis / CDP /
  Moodboard / KPI systems) is in scope — those are separate, much larger features.

## Data model — 3 new Sheets

### `Config ND` (edited by hand in Sheets; rarely changes)

Two independent tables sharing the sheet (same layout as the reference workbook):

**Roster** — columns A–D: `Tên | Role | Pages | Email`
- `Pages` is a comma-separated list of Page names this person can be assigned to.
- A person can appear multiple times conceptually is not needed — one row per person, with
  multiple Pages in one cell.

**Stage templates** — columns G–K: `Format | Thứ tự | Giai đoạn | Assign Role | Ngày trước publish`
- One row per (Format, stage). `Format` ∈ {Video, Carousel, Image, Reels} (extensible — the
  generator reads whatever Format values exist, not a hardcoded list).
- `Ngày trước publish` is a negative or zero integer: days offset from the content's publish date
  (e.g. `-7` = 7 days before publish; `0` = due on publish day).

### `Kế hoạch nội dung` (written via dashboard form; read-only display of existing rows)

`Post ID | Ngày đăng | Page | Format | Pillar | Mô tả | Người phụ trách chính | Status | Link bài`

- `Post ID` auto-generated on create: `P` + zero-padded incrementing number, computed as
  `max existing numeric suffix + 1` (scanning column A), matching the reference's `P001` style.
- `Pillar` is a free-choice from a fixed list carried over from the reference's `pillarsColors`
  (Brand Authority, Product Science, Lifestyle Reset, Industry Insight, Holiday, PR / Event,
  PR / Sales, Product / Edu, Engage / Meme, Corporate Brand, Livestream, Engage) — used for
  color-coded filtering, not for computation.
- `Status` starts as `Planned` and is not otherwise driven by this feature (no auto status
  rollup in this iteration — see Non-goals).

### `Workflow` (written by the generator on Content Plan save, and by "mark Done")

`Task ID | Post ID | Thứ tự | Giai đoạn | Người phụ trách | Email | Role | Deadline | Status | Ngày hoàn thành | Ghi chú`

- `Task ID = "{Post ID}-{Thứ tự}"` (e.g. `P001-3`) — the stable key used for all updates. Chosen
  over row-index addressing because multiple people may interact with the sheet/dashboard
  concurrently, and row order isn't guaranteed to stay stable (manual sorting, filtering,
  insertions elsewhere).
- `Deadline` computed once at generation time: `Ngày đăng + Ngày trước publish` (date arithmetic,
  stored as a real date, not recomputed later).
- `Status` ∈ {`To Do`, `Done`}.
- "Trễ?" (overdue) is **not** a stored column — computed client-side per render:
  `today > Deadline && Status !== 'Done'`. This avoids a second write path that could drift out
  of sync with the Status column.

## Backend — new file `content-plan.gs`

Kept separate from `meta.gs`/`code.gs`/`tiktok.gs` since it's a distinct feature area with its
own sheet triad. Reuses the existing `_writeSheet` / `SS.getSheetByName` patterns already
established in `meta.gs` — no new persistence mechanism introduced.

| Function | Behavior |
|---|---|
| `getConfigND()` | Reads `Config ND`, returns `{ roster: [{name, role, pages[], email}], templates: { [format]: [{order, stage, role, offsetDays}] } }` for the form to build dropdowns and per-stage assignee suggestions. |
| `getContentPlan(from, to)` | Reads `Kế hoạch nội dung` filtered by `Ngày đăng` in range, left-joins a per-post completion summary from `Workflow` (e.g. `{done: 3, total: 5}`) computed in the same call. |
| `addContentPlanItem(data)` | `data = { pubDate, page, format, pillar, desc, ownerName, assignments: { [stage]: personName } }`. Steps: (1) compute next `Post ID`; (2) append one row to `Kế hoạch nội dung`; (3) look up the stage template for `format` in `Config ND`; (4) for each template stage, compute `Deadline`, resolve assignee's email/role from roster (or leave blank if `assignments[stage]` wasn't provided), append one row to `Workflow` with `Task ID = "{postId}-{order}"`; (5) return the new `Post ID` plus the generated task rows so the dashboard can render immediately without a full reload. |
| `getWorkflowTasks(from, to)` | Reads `Workflow` filtered by `Deadline` in range, joins `Mô tả`/`Page` from `Kế hoạch nội dung` by `Post ID`. |
| `markWorkflowTaskDone(taskId, quality, note)` | Scans `Workflow` column A for `taskId`; if found, sets `Status='Done'`, `Ngày hoàn thành=today`, optionally `Quality`/`Ghi chú`; if not found, returns an error object (not a thrown exception, so the client can show a clean message) — see Error Handling. |
| `reopenWorkflowTask(taskId)` | Same lookup; sets `Status='To Do'`, clears `Ngày hoàn thành`. |

All functions are plain `google.script.run`-callable functions, matching every other backend
entry point in this codebase (no new RPC pattern).

## Frontend — new tab "📅 Kế hoạch nội dung"

Added as a 9th tab (after "🌐 Website"), following the existing tab/panel/render-function
convention used by every other tab in `index.html`.

**Section A — Content list**
- "+ Thêm bài mới" button opens a modal form: `Ngày đăng`, `Page` (dropdown, sourced from
  `Config ND` roster's distinct Pages), `Format`, `Pillar`, `Mô tả`, `Người phụ trách chính`, and
  **one assignee dropdown per stage** in the selected Format's template (auto-selected when
  exactly one roster person matches `Role ∧ Page`; left blank — never guessed — when more than
  one matches, per the earlier decision).
- Table below: `Ngày đăng | Page | Format | Pillar (color chip) | Mô tả | Status | Tiến độ` (e.g.
  "3/5 giai đoạn"), filterable by Page / Format / Pillar / week — reusing the existing
  `date-btn`/filter-bar-light visual pattern already used on every other tab.

**Section B — "Việc của tôi" / Workflow**
- The web app is deployed with `executeAs: USER_DEPLOYING` (see `appsscript.json`), so
  `Session.getActiveUser()` always resolves to the deploying account, never the actual viewer —
  it cannot be used to detect "who is looking at this". Instead: on first visit, a small "Tôi là:
  [dropdown of roster names]" picker asks the viewer to self-identify once; the choice is stored
  in `localStorage` (client-side only, no login/auth involved) and reused on every later visit.
  A "Đổi người" link lets them switch if the browser is shared.
- Defaults to tasks whose `Email` matches the locally-remembered person — with a "Xem tất cả"
  toggle to drop the filter and see the whole team's tasks.
- Table: `Bài (linked) | Giai đoạn | Deadline | Status | [✓ Done button]`. Overdue rows
  (`Trễ?` computed as above) get the existing red/urgent styling already used elsewhere in the
  dashboard (e.g. the phone-lead / overdue styling patterns).
- Clicking "✓ Done" calls `markWorkflowTaskDone`, then patches just that row's DOM state
  in place (no full-table reload), consistent with how other tabs already do optimistic
  single-row updates.

## Error handling & edge cases

- **No roster match for a stage's Role+Page**: the assignee dropdown is left empty; the form
  still submits. The generated Workflow row has a blank `Người phụ trách`/`Email`, and the
  dashboard shows a "⚠️ Chưa gán người" badge on that task so it doesn't silently disappear.
- **Editing/deleting a `Post ID` by hand in the Sheet**: not synced back to `Workflow` in this
  iteration (no "edit" flow exists at all — see Non-goals). Documented as a known limitation.
- **`markWorkflowTaskDone`/`reopenWorkflowTask` called with an unknown `Task ID`** (row deleted by
  hand): the backend returns `{ ok: false, message: '...' }` rather than throwing, and the
  dashboard shows "Không tìm thấy nhiệm vụ, có thể đã bị xoá — tải lại trang."
- **A stage with no assignee** still gets a computed `Deadline` and is fully trackable — a missing
  person never blocks generation.

## Open questions carried into implementation (none blocking)

None — all four design sections were confirmed by the user before this document was written.
