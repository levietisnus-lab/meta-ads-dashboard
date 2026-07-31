# Content Plan + Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "📅 Kế hoạch nội dung" tab to the existing Fujiwa Ads Dashboard (Apps Script web app) that lets the team plan upcoming content and auto-generates a per-stage production task list (Brief/Design/Caption/...) with computed deadlines and role-based assignment, editable directly from the dashboard.

**Architecture:** New backend file `content-plan.gs` owns 3 new Google Sheets (`Config ND`, `Kế hoạch nội dung`, `Workflow`) via plain `SpreadsheetApp` calls, following the exact `_writeSheet`/`SS.getSheetByName` conventions already used by `meta.gs`/`code.gs`. New frontend tab in `index.html` follows the existing `nav-tab` / `tab-panel` / lazy-init pattern (same as the `website` tab). No new persistence layer, no new RPC pattern, no new CSS framework.

**Tech Stack:** Google Apps Script (server), vanilla JS + Chart.js-less plain DOM rendering (client, matching the rest of `index.html`), Google Sheets as the datastore.

## Global Constraints

- No automated test framework exists in this project (Apps Script + a single static `index.html`, no npm/test runner). Verification for backend tasks is: write a temporary `Logger.log`-based smoke-test function, run it from the Apps Script editor, read `Executions`/`Logger` output, delete the temp function once verified. Verification for frontend tasks is: open `index.html` in the Browser pane preview, mock `google.script.run` via `javascript_tool`, exercise the UI, check `read_console_messages` for errors — the same approach used throughout this project's history.
- Follow existing naming: Vietnamese labels in UI text, English-ish camelCase in JS variables, sheet/column headers in Vietnamese matching the approved spec exactly.
- Every new Sheet is created lazily (created-if-missing) the first time any `content-plan.gs` function runs — no manual setup step required from the user.
- `SS` (global `const SS = SpreadsheetApp.getActiveSpreadsheet();` from `code.gs`) is the only spreadsheet handle used — do not call `SpreadsheetApp.openById` for this feature, for consistency with every other function in the codebase.
- Spec reference: `docs/superpowers/specs/2026-07-31-content-plan-workflow-design.md` — every task below implements one section of it. Re-read it if a task's intent is unclear.

---

## File Structure

- **Create:** `content-plan.gs` — all backend functions for this feature (sheet bootstrap, Config ND reader, Content Plan CRUD-lite, Workflow read/generate/done/reopen).
- **Modify:** `index.html` —
  - Nav bar (~line 364): add one `nav-tab` button.
  - New `tab-panel` div (inserted after the `website` panel, ~line 1000): all new HTML for this feature.
  - `switchTab()` (~line 1199): add lazy-init branch.
  - New JS section (placed near the existing `website` tab's JS block, after `applyWebDate`/`fetchWebsite` functions): all new frontend logic.

No other existing file changes are needed — `appsscript.json` already declares the `spreadsheets` OAuth scope, which covers everything `SpreadsheetApp` does here.

---

## Task 1: Backend — sheet bootstrap + Config ND reader

**Files:**
- Create: `content-plan.gs`

**Interfaces:**
- Produces: `_ensureContentPlanSheets()` (void, idempotent), `getConfigND()` → `{ roster: [{name, role, pages: string[], email}], templates: { [format: string]: [{order: number, stage: string, role: string, offsetDays: number}] } }`

- [ ] **Step 1: Create `content-plan.gs` with the sheet-bootstrap function**

```javascript
// ============================================================
// CONTENT-PLAN.GS — Kế hoạch nội dung + Workflow tự động
// Dùng chung SS/CFG từ code.gs. Xem spec:
// docs/superpowers/specs/2026-07-31-content-plan-workflow-design.md
// ============================================================

// Tạo 3 sheet nếu chưa có (idempotent — gọi ở đầu mọi hàm public của file này)
function _ensureContentPlanSheets() {
  if (!SS.getSheetByName('Config ND')) {
    const sh = SS.insertSheet('Config ND');
    sh.getRange(1, 1, 1, 4).setValues([['Tên', 'Role', 'Pages', 'Email']])
      .setFontWeight('bold').setBackground('#1e3a5f').setFontColor('white');
    sh.getRange(1, 7, 1, 5).setValues([['Format', 'Thứ tự', 'Giai đoạn', 'Assign Role', 'Ngày trước publish']])
      .setFontWeight('bold').setBackground('#1e3a5f').setFontColor('white');
    sh.getRange(2, 1, 1, 4).setValues([['(Ví dụ) Lan', 'Content Marketing', 'Fujiwa Speed', 'vidu@fujiwavietnam.vn']]);
    sh.getRange(2, 7, 4, 5).setValues([
      ['Image', 1, 'Brief',  'Content',        -3],
      ['Image', 2, 'Design', 'Design Primary', -2],
      ['Image', 3, 'Caption','Content',        -1],
      ['Image', 4, 'Review', 'Content',         0],
    ]);
  }
  if (!SS.getSheetByName('Kế hoạch nội dung')) {
    const sh = SS.insertSheet('Kế hoạch nội dung');
    const headers = ['Post ID', 'Ngày đăng', 'Page', 'Format', 'Pillar', 'Mô tả', 'Người phụ trách chính', 'Status', 'Link bài'];
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#1e3a5f').setFontColor('white');
  }
  if (!SS.getSheetByName('Workflow')) {
    const sh = SS.insertSheet('Workflow');
    const headers = ['Task ID', 'Post ID', 'Thứ tự', 'Giai đoạn', 'Người phụ trách', 'Email', 'Role', 'Deadline', 'Status', 'Ngày hoàn thành', 'Ghi chú'];
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#1e3a5f').setFontColor('white');
  }
}

// Đọc nhân sự + template quy trình từ Config ND
function getConfigND() {
  _ensureContentPlanSheets();
  const sh = SS.getSheetByName('Config ND');
  const lastRow = sh.getLastRow();

  const roster = [];
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, 4).getValues().forEach(r => {
      const name = String(r[0] || '').trim();
      if (!name) return;
      roster.push({
        name: name,
        role: String(r[1] || '').trim(),
        pages: String(r[2] || '').split(',').map(s => s.trim()).filter(Boolean),
        email: String(r[3] || '').trim(),
      });
    });
  }

  const templates = {};
  if (lastRow > 1) {
    sh.getRange(2, 7, lastRow - 1, 5).getValues().forEach(r => {
      const format = String(r[0] || '').trim();
      if (!format) return;
      if (!templates[format]) templates[format] = [];
      templates[format].push({
        order: Number(r[1]) || 0,
        stage: String(r[2] || '').trim(),
        role: String(r[3] || '').trim(),
        offsetDays: Number(r[4]) || 0,
      });
    });
    Object.keys(templates).forEach(f => templates[f].sort((a, b) => a.order - b.order));
  }

  return { roster: roster, templates: templates };
}
```

- [ ] **Step 2: Manual smoke test in the Apps Script editor**

Temporarily paste this at the bottom of `content-plan.gs`, run it once from the editor (select `_smokeTest1` in the function dropdown, click Run), then read the log via View → Logs (or Executions):

```javascript
function _smokeTest1() {
  Logger.log(JSON.stringify(getConfigND(), null, 2));
}
```

Expected log output: a JSON object with `roster` containing one entry (`"(Ví dụ) Lan"`) and `templates.Image` containing 4 stages ordered `Brief, Design, Caption, Review` with `offsetDays` `-3, -2, -1, 0`. Also confirm in the Sheet UI that `Config ND`, `Kế hoạch nội dung`, and `Workflow` tabs now exist with the correct headers.

- [ ] **Step 3: Delete `_smokeTest1`**

Remove the temporary function from `content-plan.gs` before committing — it was only for manual verification.

- [ ] **Step 4: Commit**

```bash
git add content-plan.gs
git commit -m "feat: add content-plan.gs with sheet bootstrap and Config ND reader"
```

---

## Task 2: Backend — Content Plan list + create (with Workflow generation)

**Files:**
- Modify: `content-plan.gs`

**Interfaces:**
- Consumes: `getConfigND()` from Task 1.
- Produces: `_nextContentPlanPostId()` → `string` (e.g. `"P001"`); `_computeDeadline(pubDateStr: string, offsetDays: number)` → `Date`; `getContentPlan(from: string, to: string)` → `[{postId, pubDate, page, format, pillar, desc, owner, status, link, progress: {done, total}}]`; `addContentPlanItem(data: {pubDate, page, format, pillar, desc, ownerName, assignments: {[stage: string]: string}})` → `{ok: true, postId, tasks: [{taskId, postId, order, stage, assignee, email, role, deadline, status}]} | {ok: false, message}`.

- [ ] **Step 1: Add `_nextContentPlanPostId` and `_computeDeadline`**

```javascript
// Post ID kế tiếp dạng P001, P002... — quét cột A tìm số lớn nhất
function _nextContentPlanPostId() {
  const sh = SS.getSheetByName('Kế hoạch nội dung');
  const lastRow = sh.getLastRow();
  let maxNum = 0;
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, 1).getValues().forEach(r => {
      const m = String(r[0] || '').match(/^P(\d+)$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    });
  }
  return 'P' + String(maxNum + 1).padStart(3, '0');
}

// Deadline = ngày đăng + offsetDays (offsetDays thường âm — vd -7 = 7 ngày trước publish)
function _computeDeadline(pubDateStr, offsetDays) {
  const d = new Date(pubDateStr + 'T00:00:00+07:00');
  d.setDate(d.getDate() + offsetDays);
  return d;
}
```

- [ ] **Step 2: Add `getContentPlan(from, to)`**

```javascript
// Đọc Kế hoạch nội dung trong khoảng Ngày đăng [from,to], kèm tiến độ Workflow của mỗi bài
function getContentPlan(from, to) {
  _ensureContentPlanSheets();
  const cpSh = SS.getSheetByName('Kế hoạch nội dung');
  const cpLastRow = cpSh.getLastRow();
  const rows = [];
  if (cpLastRow > 1) {
    cpSh.getRange(2, 1, cpLastRow - 1, 9).getValues().forEach(r => {
      const postId = String(r[0] || '').trim();
      if (!postId) return;
      const pubDate = r[1] instanceof Date
        ? Utilities.formatDate(r[1], 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
        : String(r[1] || '');
      if (from && pubDate < from) return;
      if (to && pubDate > to) return;
      rows.push({
        postId: postId, pubDate: pubDate, page: String(r[2] || ''), format: String(r[3] || ''),
        pillar: String(r[4] || ''), desc: String(r[5] || ''), owner: String(r[6] || ''),
        status: String(r[7] || ''), link: String(r[8] || ''),
      });
    });
  }

  const wfSh = SS.getSheetByName('Workflow');
  const wfLastRow = wfSh.getLastRow();
  const progress = {};
  if (wfLastRow > 1) {
    wfSh.getRange(2, 1, wfLastRow - 1, 9).getValues().forEach(r => {
      const postId = String(r[1] || '').trim();
      if (!postId) return;
      if (!progress[postId]) progress[postId] = { done: 0, total: 0 };
      progress[postId].total++;
      if (String(r[8] || '').trim() === 'Done') progress[postId].done++;
    });
  }
  rows.forEach(r => { r.progress = progress[r.postId] || { done: 0, total: 0 }; });
  return rows;
}
```

- [ ] **Step 3: Add `addContentPlanItem(data)`**

```javascript
// Thêm 1 bài vào Kế hoạch nội dung + tự sinh các dòng Workflow theo template Format đã chọn
function addContentPlanItem(data) {
  _ensureContentPlanSheets();
  const pubDate = String((data && data.pubDate) || '').trim();
  const page = String((data && data.page) || '').trim();
  const format = String((data && data.format) || '').trim();
  if (!pubDate || !page || !format) {
    return { ok: false, message: 'Thiếu Ngày đăng / Page / Format.' };
  }

  const postId = _nextContentPlanPostId();
  const pillar = String((data && data.pillar) || '').trim();
  const desc = String((data && data.desc) || '').trim();
  const owner = String((data && data.ownerName) || '').trim();
  const assignments = (data && data.assignments) || {};

  SS.getSheetByName('Kế hoạch nội dung')
    .appendRow([postId, pubDate, page, format, pillar, desc, owner, 'Planned', '']);

  const cfg = getConfigND();
  const template = cfg.templates[format] || [];
  const rosterByName = {};
  cfg.roster.forEach(p => { rosterByName[p.name] = p; });

  const wfSh = SS.getSheetByName('Workflow');
  const generatedTasks = [];
  template.forEach(stage => {
    const deadline = _computeDeadline(pubDate, stage.offsetDays);
    const assignedName = String(assignments[stage.stage] || '').trim();
    const person = rosterByName[assignedName];
    const taskId = postId + '-' + stage.order;

    wfSh.appendRow([
      taskId, postId, stage.order, stage.stage,
      person ? person.name : '', person ? person.email : '', stage.role,
      deadline, 'To Do', '', '',
    ]);

    generatedTasks.push({
      taskId: taskId, postId: postId, order: stage.order, stage: stage.stage,
      assignee: person ? person.name : '', email: person ? person.email : '', role: stage.role,
      deadline: Utilities.formatDate(deadline, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd'),
      status: 'To Do',
    });
  });

  return { ok: true, postId: postId, tasks: generatedTasks };
}
```

- [ ] **Step 4: Manual smoke test**

```javascript
function _smokeTest2() {
  const res = addContentPlanItem({
    pubDate: '2026-08-10', page: 'Fujiwa Speed', format: 'Image', pillar: 'Brand Authority',
    desc: 'Test post', ownerName: 'Lan', assignments: { Brief: '(Ví dụ) Lan' },
  });
  Logger.log(JSON.stringify(res, null, 2));
  Logger.log(JSON.stringify(getContentPlan('2026-08-01', '2026-08-31'), null, 2));
}
```

Run it. Expected: `res.ok === true`, `res.postId === "P001"` (or next available), `res.tasks.length === 4` with `deadline` values `2026-08-07, 2026-08-08, 2026-08-09, 2026-08-10` for Brief/Design/Caption/Review respectively, and only the `Brief` task has a non-empty `assignee` (`"(Ví dụ) Lan"`). The second log line shows the new post with `progress: {done: 0, total: 4}`. Verify the `Workflow` sheet now has 4 new rows with matching `Task ID`s (`P001-1` .. `P001-4`).

- [ ] **Step 5: Delete `_smokeTest2`, remove the test row from both sheets**

Manually delete the `P001`/`P001-*` rows created by the smoke test from `Kế hoạch nội dung` and `Workflow` in the Sheet UI (leave the header rows and the Config ND example row intact) — the smoke test's `_nextContentPlanPostId` reads existing rows, so leftover test data would shift the next real Post ID.

- [ ] **Step 6: Commit**

```bash
git add content-plan.gs
git commit -m "feat: add Content Plan list/create with automatic Workflow generation"
```

---

## Task 3: Backend — Workflow read + mark-done/reopen

**Files:**
- Modify: `content-plan.gs`

**Interfaces:**
- Produces: `getWorkflowTasks(from: string, to: string)` → `[{taskId, postId, order, stage, assignee, email, role, deadline, status, doneDate, note, page, desc}]`; `markWorkflowTaskDone(taskId: string, note?: string)` → `{ok: true, taskId, doneDate} | {ok: false, message}`; `reopenWorkflowTask(taskId: string)` → `{ok: true, taskId} | {ok: false, message}`.

- [ ] **Step 1: Add `getWorkflowTasks(from, to)`**

```javascript
// Đọc Workflow theo khoảng Deadline [from,to], kèm Page/Mô tả join từ Kế hoạch nội dung
function getWorkflowTasks(from, to) {
  _ensureContentPlanSheets();
  const wfSh = SS.getSheetByName('Workflow');
  const wfLastRow = wfSh.getLastRow();
  const tasks = [];
  if (wfLastRow > 1) {
    wfSh.getRange(2, 1, wfLastRow - 1, 11).getValues().forEach(r => {
      const taskId = String(r[0] || '').trim();
      if (!taskId) return;
      const deadline = r[7] instanceof Date
        ? Utilities.formatDate(r[7], 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
        : String(r[7] || '');
      if (from && deadline < from) return;
      if (to && deadline > to) return;
      tasks.push({
        taskId: taskId, postId: String(r[1] || ''), order: r[2], stage: String(r[3] || ''),
        assignee: String(r[4] || ''), email: String(r[5] || ''), role: String(r[6] || ''),
        deadline: deadline, status: String(r[8] || ''),
        doneDate: r[9] instanceof Date ? Utilities.formatDate(r[9], 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd') : String(r[9] || ''),
        note: String(r[10] || ''),
      });
    });
  }

  const cpSh = SS.getSheetByName('Kế hoạch nội dung');
  const cpLastRow = cpSh.getLastRow();
  const postInfo = {};
  if (cpLastRow > 1) {
    cpSh.getRange(2, 1, cpLastRow - 1, 6).getValues().forEach(r => {
      const postId = String(r[0] || '').trim();
      if (!postId) return;
      postInfo[postId] = { page: String(r[2] || ''), desc: String(r[5] || '') };
    });
  }
  tasks.forEach(t => {
    const info = postInfo[t.postId] || { page: '', desc: '' };
    t.page = info.page; t.desc = info.desc;
  });
  return tasks;
}
```

- [ ] **Step 2: Add row-lookup helper + mark-done/reopen**

```javascript
// Tìm dòng Workflow theo Task ID (cột A) — trả về {sheet, row} hoặc null nếu không thấy
function _findWorkflowRow(taskId) {
  const wfSh = SS.getSheetByName('Workflow');
  const lastRow = wfSh.getLastRow();
  if (lastRow < 2) return null;
  const ids = wfSh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === taskId) return { sheet: wfSh, row: i + 2 };
  }
  return null;
}

function markWorkflowTaskDone(taskId, note) {
  _ensureContentPlanSheets();
  const found = _findWorkflowRow(taskId);
  if (!found) return { ok: false, message: 'Không tìm thấy nhiệm vụ, có thể đã bị xoá — tải lại trang.' };
  const today = new Date();
  found.sheet.getRange(found.row, 9).setValue('Done');   // I: Status
  found.sheet.getRange(found.row, 10).setValue(today);    // J: Ngày hoàn thành
  if (note) found.sheet.getRange(found.row, 11).setValue(String(note)); // K: Ghi chú
  return { ok: true, taskId: taskId, doneDate: Utilities.formatDate(today, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd') };
}

function reopenWorkflowTask(taskId) {
  _ensureContentPlanSheets();
  const found = _findWorkflowRow(taskId);
  if (!found) return { ok: false, message: 'Không tìm thấy nhiệm vụ, có thể đã bị xoá — tải lại trang.' };
  found.sheet.getRange(found.row, 9).setValue('To Do'); // I: Status
  found.sheet.getRange(found.row, 10).setValue('');      // J: Ngày hoàn thành
  return { ok: true, taskId: taskId };
}
```

- [ ] **Step 3: Manual smoke test**

```javascript
function _smokeTest3() {
  const created = addContentPlanItem({
    pubDate: '2026-08-15', page: 'Fujiwa Speed', format: 'Image', ownerName: 'Lan', assignments: {},
  });
  const firstTaskId = created.tasks[0].taskId;
  Logger.log('Before: ' + JSON.stringify(getWorkflowTasks('2026-08-01', '2026-08-31').find(t => t.taskId === firstTaskId)));
  Logger.log('Done result: ' + JSON.stringify(markWorkflowTaskDone(firstTaskId, 'test note')));
  Logger.log('After done: ' + JSON.stringify(getWorkflowTasks('2026-08-01', '2026-08-31').find(t => t.taskId === firstTaskId)));
  Logger.log('Reopen result: ' + JSON.stringify(reopenWorkflowTask(firstTaskId)));
  Logger.log('Unknown id result: ' + JSON.stringify(markWorkflowTaskDone('NOPE-1')));
}
```

Run it. Expected: "Before" shows `status: "To Do"`, empty `doneDate`. "After done" shows `status: "Done"`, `doneDate` = today's date, `note: "test note"`. "Reopen result" is `{ok: true, ...}`. "Unknown id result" is `{ok: false, message: "Không tìm thấy..."}`.

- [ ] **Step 4: Delete `_smokeTest3` and its leftover test row (`P00X` from this run) from both sheets**

- [ ] **Step 5: Commit**

```bash
git add content-plan.gs
git commit -m "feat: add Workflow read, mark-done, and reopen functions"
```

---

## Task 4: Frontend — new tab scaffold

**Files:**
- Modify: `index.html:364` (nav bar), `index.html:1000` (insert new tab-panel after `tab-website`), `index.html:1199` (`switchTab`), `index.html:2835` (near `_webInited` declaration)

**Interfaces:**
- Consumes: none yet (empty panel).
- Produces: `<div id="tab-content-plan">` exists and becomes visible via the standard `switchTab` mechanism; `_cpInited` flag + `initContentPlan()` stub (filled in by Task 5+) wired into `switchTab`.

- [ ] **Step 1: Add the nav button**

In `index.html`, find this block (~line 364):

```html
  <div class="nav-tab"         data-tab="website"     onclick="switchTab(this)">🌐 Website</div>
```

Add immediately after it:

```html
  <div class="nav-tab"         data-tab="content-plan" onclick="switchTab(this)">📅 Kế hoạch ND</div>
```

- [ ] **Step 2: Add the empty tab panel**

Find the end of the website tab panel (~line 1000, the `</div>` that closes `<div id="tab-website" class="tab-panel">`, immediately followed by `</main>`). Insert a new panel between them:

```html
<div id="tab-website" class="tab-panel">
  ...(existing content, unchanged)...
</div>

<div id="tab-content-plan" class="tab-panel">
  <div class="card" style="text-align:center;padding:30px;color:var(--muted)">Đang tải...</div>
</div>

</main>
```

- [ ] **Step 3: Wire lazy-init into `switchTab`**

Find (~line 1199):

```javascript
function switchTab(el) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + el.dataset.tab).classList.add('active');
  // Lazy-load posts live khi mở tab Bài đăng (tránh gọi FA đồng thời lúc load → throttle dedup tin nhắn)
  if (el.dataset.tab === 'posts'  && !_postsInited) { _postsInited = true; initPostsControls(); }
  if (el.dataset.tab === 'website' && !_webInited)  { _webInited   = true; initWebsite(); }
  if (el.dataset.tab === 'phones')                  { initPhones(); }
}
```

Replace with:

```javascript
function switchTab(el) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + el.dataset.tab).classList.add('active');
  // Lazy-load posts live khi mở tab Bài đăng (tránh gọi FA đồng thời lúc load → throttle dedup tin nhắn)
  if (el.dataset.tab === 'posts'  && !_postsInited) { _postsInited = true; initPostsControls(); }
  if (el.dataset.tab === 'website' && !_webInited)  { _webInited   = true; initWebsite(); }
  if (el.dataset.tab === 'phones')                  { initPhones(); }
  if (el.dataset.tab === 'content-plan' && !_cpInited) { _cpInited = true; initContentPlan(); }
}
```

- [ ] **Step 4: Declare the init flag and a stub `initContentPlan`**

Find (~line 2835): `let _webInited = false;` and add right after it:

```javascript
let _cpInited = false;
function initContentPlan() {
  document.getElementById('tab-content-plan').innerHTML = '<div class="card" style="text-align:center;padding:30px;color:var(--muted)">Đang xây dựng — sẽ hoàn thiện ở task tiếp theo.</div>';
}
```

(This stub is replaced by real logic in Task 5. It exists so this task is independently verifiable.)

- [ ] **Step 5: Verify in the Browser pane**

```
navigate to file:///C:/Users/VIET/Documents/Claude/CLAUDE-20260623T091812Z-3-001/CLAUDE/index.html
```

Then via `javascript_tool`: `document.getElementById('app-loading').style.display='none';` (the preview otherwise sits on the loading spinner since there's no live backend — this is expected and matches every prior verification in this project).

Use `read_page` to find the "📅 Kế hoạch ND" nav item, click it (`computer` → `left_click`), then `read_console_messages` with `onlyErrors: true` — expect no errors — and confirm via a screenshot or `get_page_text` that the panel shows "Đang xây dựng...".

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: scaffold Kế hoạch nội dung tab (nav, panel, lazy-init)"
```

---

## Task 5: Frontend — Content Plan list section

**Files:**
- Modify: `index.html` (tab-content-plan panel HTML; JS section near the other `initX`/`fetchX`/`renderX` functions)

**Interfaces:**
- Consumes: `getContentPlan(from, to)` from Task 2 (via `google.script.run`).
- Produces: `G_CP_DATE = {from, to}`; `setCpPreset(btn, val)`; `applyCpDate()`; `fetchContentPlan()`; `renderContentPlanList(rows)` — `rows` matches the `getContentPlan` return shape exactly.

- [ ] **Step 1: Replace the placeholder panel HTML**

Replace the panel body written in Task 4 Step 2 with:

```html
<div id="tab-content-plan" class="tab-panel">
  <div class="filter-bar-light" style="background:#fff;border-radius:10px;padding:10px 20px;box-shadow:0 1px 3px rgba(0,0,0,.07);margin-bottom:18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <span style="font-size:12px;font-weight:700;color:#374151">Khoảng:</span>
    <div id="cp-date-btns" style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="date-btn" onclick="setCpPreset(this,'thisMonth')">Tháng này</button>
      <button class="date-btn active" onclick="setCpPreset(this,'lastMonth')">Tháng trước</button>
      <button class="date-btn" onclick="setCpPreset(this,'all')">Tất cả</button>
    </div>
    <input type="date" id="cp-from" style="font-size:12px;border:1px solid #e2e8f0;border-radius:6px;padding:4px 8px;background:#fff;color:#0f172a">
    <span style="color:#94a3b8">→</span>
    <input type="date" id="cp-to" style="font-size:12px;border:1px solid #e2e8f0;border-radius:6px;padding:4px 8px;background:#fff;color:#0f172a">
    <button onclick="applyCpDate()" style="padding:5px 14px;background:var(--primary);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">Áp dụng</button>
    <button onclick="openContentPlanForm()" style="margin-left:auto;padding:6px 16px;background:#059669;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">+ Thêm bài mới</button>
  </div>

  <div class="card" style="margin-bottom:18px">
    <div class="card-title">📋 Danh sách bài <span class="badge-pill" id="cp-count"></span></div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th style="text-align:left">Ngày đăng</th><th style="text-align:left">Page</th>
          <th>Format</th><th style="text-align:left">Pillar</th>
          <th style="text-align:left">Mô tả</th><th>Status</th><th>Tiến độ</th>
        </tr></thead>
        <tbody id="cp-list-body"></tbody>
      </table>
    </div>
  </div>

  <div id="cp-workflow-section"></div>
</div>
```

(`cp-workflow-section` is filled in by Task 8. Leaving it as an empty container here keeps this task's diff focused on the list.)

- [ ] **Step 2: Replace the Task 4 stub with the real Pillar color map + `initContentPlan`**

Task 4 Step 4 defined a placeholder `initContentPlan`. Find it:

```javascript
function initContentPlan() {
  document.getElementById('tab-content-plan').innerHTML = '<div class="card" style="text-align:center;padding:30px;color:var(--muted)">Đang xây dựng — sẽ hoàn thiện ở task tiếp theo.</div>';
}
```

Replace that entire function (keep the `let _cpInited = false;` line above it untouched) with:

```javascript
const CP_PILLAR_COLORS = {
  'Brand Authority': '#0066CC', 'Product Science': '#00A86B', 'Lifestyle Reset': '#FF6B35',
  'Industry Insight': '#8B5CF6', 'Holiday': '#10B981', 'PR / Event': '#F59E0B',
  'PR / Sales': '#EF4444', 'Product / Edu': '#3B82F6', 'Engage / Meme': '#EC4899',
  'Corporate Brand': '#6366F1', 'Livestream': '#DC2626', 'Engage': '#14B8A6',
};

let G_CP_DATE = { from: '', to: '' };
let G_CP_CONFIG = null; // cache của getConfigND() — nạp 1 lần khi mở tab
let G_CP_ROWS = [];     // cache danh sách bài hiện tại (để cập nhật lạc quan sau khi thêm bài)

function initContentPlan() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const to = new Date(today.getFullYear(), today.getMonth(), 0);
  G_CP_DATE.from = fmtD(from); G_CP_DATE.to = fmtD(to);
  document.getElementById('cp-from').value = G_CP_DATE.from;
  document.getElementById('cp-to').value = G_CP_DATE.to;
  fetchContentPlan();
  google.script.run.withSuccessHandler(cfg => { G_CP_CONFIG = cfg; }).getConfigND();
}

function setCpPreset(btn, val) {
  document.querySelectorAll('#cp-date-btns .date-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const r = computeRangeForPreset(val);
  G_CP_DATE.from = r.from; G_CP_DATE.to = r.to;
  document.getElementById('cp-from').value = G_CP_DATE.from;
  document.getElementById('cp-to').value = G_CP_DATE.to;
  fetchContentPlan();
}

function applyCpDate() {
  document.querySelectorAll('#cp-date-btns .date-btn').forEach(b => b.classList.remove('active'));
  G_CP_DATE.from = document.getElementById('cp-from')?.value || '';
  G_CP_DATE.to   = document.getElementById('cp-to')?.value   || '';
  fetchContentPlan();
}

function fetchContentPlan() {
  const body = document.getElementById('cp-list-body');
  if (body) body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">⏳ Đang tải...</td></tr>';
  google.script.run
    .withSuccessHandler(rows => { G_CP_ROWS = rows || []; renderContentPlanList(G_CP_ROWS); })
    .withFailureHandler(err => { if (body) body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#dc2626">Lỗi: ${err.message}</td></tr>`; })
    .getContentPlan(G_CP_DATE.from, G_CP_DATE.to);
}

function renderContentPlanList(rows) {
  const body = document.getElementById('cp-list-body');
  const count = document.getElementById('cp-count');
  if (count) count.textContent = rows.length + ' bài';
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">Chưa có bài nào trong khoảng này</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => {
    const pillarColor = CP_PILLAR_COLORS[r.pillar] || '#64748b';
    const progressPct = r.progress.total > 0 ? Math.round(r.progress.done / r.progress.total * 100) : 0;
    return `<tr>
      <td>${r.pubDate}</td>
      <td>${r.page}</td>
      <td style="text-align:center">${r.format}</td>
      <td><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${pillarColor}22;color:${pillarColor}">${r.pillar || '—'}</span></td>
      <td>${r.desc}</td>
      <td style="text-align:center">${r.status}</td>
      <td style="text-align:center">${r.progress.done}/${r.progress.total} (${progressPct}%)</td>
    </tr>`;
  }).join('');
}
```

- [ ] **Step 3: Verify in the Browser pane**

Navigate to `index.html`, hide `#app-loading`, then via `javascript_tool` mock the backend and call the tab's init flow directly (mirroring the mocking pattern already used for the Trang tab's compare mode earlier in this project):

```javascript
function makeRunner() {
  const r = {};
  r.withSuccessHandler = fn => { r._s = fn; return r; };
  r.withFailureHandler = fn => { r._f = fn; return r; };
  r.getContentPlan = (from, to) => setTimeout(() => r._s([
    { postId:'P001', pubDate:'2026-07-10', page:'Fujiwa Speed', format:'Image', pillar:'Brand Authority',
      desc:'Test post', owner:'Lan', status:'Planned', link:'', progress:{done:2,total:4} },
  ]), 10);
  r.getConfigND = () => setTimeout(() => r._s({ roster: [], templates: {} }), 10);
  return r;
}
window.google = { script: { run: null } };
Object.defineProperty(google.script, 'run', { get: () => makeRunner() });
```

Click the "📅 Kế hoạch ND" nav tab, wait ~1s, then check `document.getElementById('cp-list-body').innerHTML` contains `"P001"`'s description and `"2/4 (50%)"`. Check `read_console_messages({onlyErrors: true})` returns none.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: render Content Plan list with date filter and progress column"
```

---

## Task 6: Frontend — "+ Thêm bài mới" form

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `G_CP_CONFIG` (from Task 5's `initContentPlan`), `addContentPlanItem(data)` from Task 2.
- Produces: `openContentPlanForm()`, `closeContentPlanForm()`, `onCpFormatChange()`, `submitContentPlanForm()`.

- [ ] **Step 1: Add the modal HTML**

Add right before the closing `</div>` of `tab-content-plan` (after `cp-workflow-section`):

```html
  <div id="cp-form-modal" style="display:none;position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.5);align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:12px;padding:24px;width:520px;max-width:92vw;max-height:86vh;overflow-y:auto">
      <div style="display:flex;align-items:center;margin-bottom:16px">
        <span style="font-size:16px;font-weight:800;color:#0f172a">+ Thêm bài mới</span>
        <span onclick="closeContentPlanForm()" style="margin-left:auto;cursor:pointer;font-size:20px;color:#94a3b8">✕</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <label style="font-size:12px;font-weight:700;color:#374151">Ngày đăng
          <input type="date" id="cp-f-pubdate" style="width:100%;margin-top:4px;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box">
        </label>
        <label style="font-size:12px;font-weight:700;color:#374151">Page
          <input type="text" id="cp-f-page" placeholder="vd: Fujiwa Speed" style="width:100%;margin-top:4px;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box">
        </label>
        <label style="font-size:12px;font-weight:700;color:#374151">Format
          <select id="cp-f-format" onchange="onCpFormatChange()" style="width:100%;margin-top:4px;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box">
            <option value="">— Chọn Format —</option>
          </select>
        </label>
        <label style="font-size:12px;font-weight:700;color:#374151">Pillar
          <select id="cp-f-pillar" style="width:100%;margin-top:4px;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box">
            <option value="">— Không chọn —</option>
          </select>
        </label>
        <label style="font-size:12px;font-weight:700;color:#374151">Mô tả
          <textarea id="cp-f-desc" rows="2" style="width:100%;margin-top:4px;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;resize:vertical"></textarea>
        </label>
        <label style="font-size:12px;font-weight:700;color:#374151">Người phụ trách chính
          <input type="text" id="cp-f-owner" style="width:100%;margin-top:4px;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box">
        </label>
        <div id="cp-f-stages"></div>
        <div id="cp-f-msg" style="font-size:12px;font-weight:600"></div>
        <button id="cp-f-submit" onclick="submitContentPlanForm()" style="padding:10px;background:#059669;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer">Lưu</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Add the JS logic**

Add right after `renderContentPlanList` from Task 5:

```javascript
function openContentPlanForm() {
  const fmtSel = document.getElementById('cp-f-format');
  const pillarSel = document.getElementById('cp-f-pillar');
  fmtSel.innerHTML = '<option value="">— Chọn Format —</option>' +
    Object.keys((G_CP_CONFIG && G_CP_CONFIG.templates) || {}).map(f => `<option value="${f}">${f}</option>`).join('');
  pillarSel.innerHTML = '<option value="">— Không chọn —</option>' +
    Object.keys(CP_PILLAR_COLORS).map(p => `<option value="${p}">${p}</option>`).join('');
  document.getElementById('cp-f-stages').innerHTML = '';
  document.getElementById('cp-f-msg').textContent = '';
  document.getElementById('cp-form-modal').style.display = 'flex';
}

function closeContentPlanForm() {
  document.getElementById('cp-form-modal').style.display = 'none';
}

// Khi chọn Format, hiện 1 dropdown chọn người cho mỗi giai đoạn trong template —
// tự chọn sẵn nếu chỉ có đúng 1 người khớp Role+Page, để trống nếu nhiều người khớp.
function onCpFormatChange() {
  const format = document.getElementById('cp-f-format').value;
  const page = document.getElementById('cp-f-page').value.trim();
  const container = document.getElementById('cp-f-stages');
  const template = (G_CP_CONFIG && G_CP_CONFIG.templates[format]) || [];
  const roster = (G_CP_CONFIG && G_CP_CONFIG.roster) || [];

  container.innerHTML = template.map(stage => {
    const matches = roster.filter(p => p.role === stage.role && (!page || p.pages.includes(page)));
    const preselect = matches.length === 1 ? matches[0].name : '';
    const options = ['<option value="">— Chưa gán —</option>']
      .concat(roster.filter(p => p.role === stage.role)
        .map(p => `<option value="${p.name}" ${p.name === preselect ? 'selected' : ''}>${p.name}</option>`));
    return `<label style="font-size:12px;font-weight:700;color:#374151">${stage.stage} (${stage.role})
      <select data-stage="${stage.stage}" class="cp-f-stage-assignee" style="width:100%;margin-top:4px;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box">
        ${options.join('')}
      </select>
    </label>`;
  }).join('');
}

function submitContentPlanForm() {
  const btn = document.getElementById('cp-f-submit');
  const msg = document.getElementById('cp-f-msg');
  const assignments = {};
  document.querySelectorAll('.cp-f-stage-assignee').forEach(sel => {
    if (sel.value) assignments[sel.dataset.stage] = sel.value;
  });
  const data = {
    pubDate: document.getElementById('cp-f-pubdate').value,
    page: document.getElementById('cp-f-page').value.trim(),
    format: document.getElementById('cp-f-format').value,
    pillar: document.getElementById('cp-f-pillar').value,
    desc: document.getElementById('cp-f-desc').value.trim(),
    ownerName: document.getElementById('cp-f-owner').value.trim(),
    assignments: assignments,
  };
  if (!data.pubDate || !data.page || !data.format) {
    msg.style.color = '#dc2626';
    msg.textContent = 'Thiếu Ngày đăng / Page / Format.';
    return;
  }
  btn.disabled = true;
  msg.style.color = '#374151';
  msg.textContent = 'Đang lưu...';
  google.script.run
    .withSuccessHandler(res => {
      btn.disabled = false;
      if (!res.ok) { msg.style.color = '#dc2626'; msg.textContent = res.message; return; }
      msg.style.color = '#059669';
      msg.textContent = `✅ Đã tạo ${res.postId} (${res.tasks.length} nhiệm vụ)`;
      G_CP_ROWS.push({
        postId: res.postId, pubDate: data.pubDate, page: data.page, format: data.format,
        pillar: data.pillar, desc: data.desc, owner: data.ownerName, status: 'Planned', link: '',
        progress: { done: 0, total: res.tasks.length },
      });
      renderContentPlanList(G_CP_ROWS);
      setTimeout(closeContentPlanForm, 1200);
    })
    .withFailureHandler(err => {
      btn.disabled = false;
      msg.style.color = '#dc2626';
      msg.textContent = 'Lỗi: ' + err.message;
    })
    .addContentPlanItem(data);
}
```

- [ ] **Step 3: Verify in the Browser pane**

Extend the mock runner from Task 5 with:

```javascript
r.getConfigND = () => setTimeout(() => r._s({
  roster: [{ name: 'Lan', role: 'Content', pages: ['Fujiwa Speed'], email: 'lan@fujiwavietnam.vn' }],
  templates: { Image: [
    { order: 1, stage: 'Brief', role: 'Content', offsetDays: -3 },
    { order: 2, stage: 'Design', role: 'Design Primary', offsetDays: -2 },
  ] },
}), 10);
r.addContentPlanItem = (data) => setTimeout(() => r._s({
  ok: true, postId: 'P002',
  tasks: [{ taskId: 'P002-1', postId: 'P002', order: 1, stage: 'Brief', assignee: 'Lan', email: 'lan@fujiwavietnam.vn', role: 'Content', deadline: '2026-07-07', status: 'To Do' }],
}), 10);
```

Reload, open the tab, click "+ Thêm bài mới", select Format `Image`, confirm the "Brief" stage dropdown auto-selects "Lan" (only match) and "Design" dropdown shows "— Chưa gán —" (no roster member has that role in the mock). Fill in Ngày đăng/Page, click Lưu, confirm the success message shows `P002` and the modal closes after ~1.2s, and the list table now includes the new row. `read_console_messages({onlyErrors:true})` — expect none.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add content plan creation form with per-stage assignee suggestions"
```

---

## Task 7: Frontend — local person-picker ("Tôi là")

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `G_CP_CONFIG.roster` (from Task 5).
- Produces: `CP_PERSON_KEY` (localStorage key constant), `getCpPerson()` → `string`, `setCpPerson(name)`, `showCpPersonPicker()`, `renderCpPersonBanner()`.

- [ ] **Step 1: Add the picker banner + modal HTML**

Add right after the "+ Thêm bài mới" filter bar (inside `tab-content-plan`, before the "📋 Danh sách bài" card):

```html
  <div id="cp-person-banner" style="display:none;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 16px;margin-bottom:14px;font-size:12px;color:#1e3a5f;display:flex;align-items:center;gap:8px">
    <span>👤 Đang xem với tư cách: <strong id="cp-person-name"></strong></span>
    <span onclick="showCpPersonPicker()" style="margin-left:auto;cursor:pointer;color:var(--primary);font-weight:700">Đổi người</span>
  </div>

  <div id="cp-person-modal" style="display:none;position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.5);align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:12px;padding:24px;width:340px;max-width:90vw">
      <div style="font-size:15px;font-weight:800;color:#0f172a;margin-bottom:12px">Bạn là ai?</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:12px">Dùng để lọc "Việc của tôi" — chỉ lưu trên trình duyệt này, không cần đăng nhập.</div>
      <select id="cp-person-select" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;margin-bottom:14px">
        <option value="">— Chọn tên —</option>
      </select>
      <button onclick="confirmCpPerson()" style="width:100%;padding:9px;background:var(--primary);color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer">Xác nhận</button>
    </div>
  </div>
```

- [ ] **Step 2: Add the JS logic**

Add right after `submitContentPlanForm` from Task 6:

```javascript
const CP_PERSON_KEY = 'fujiwa_cp_person';

function getCpPerson() {
  try { return localStorage.getItem(CP_PERSON_KEY) || ''; } catch (e) { return ''; }
}

function setCpPerson(name) {
  try { localStorage.setItem(CP_PERSON_KEY, name); } catch (e) {}
  renderCpPersonBanner();
}

function renderCpPersonBanner() {
  const name = getCpPerson();
  const banner = document.getElementById('cp-person-banner');
  if (!banner) return;
  if (name) {
    banner.style.display = 'flex';
    document.getElementById('cp-person-name').textContent = name;
  } else {
    banner.style.display = 'none';
  }
}

function showCpPersonPicker() {
  const sel = document.getElementById('cp-person-select');
  const roster = (G_CP_CONFIG && G_CP_CONFIG.roster) || [];
  sel.innerHTML = '<option value="">— Chọn tên —</option>' +
    roster.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  document.getElementById('cp-person-modal').style.display = 'flex';
}

function confirmCpPerson() {
  const name = document.getElementById('cp-person-select').value;
  if (!name) return;
  setCpPerson(name);
  document.getElementById('cp-person-modal').style.display = 'none';
  if (typeof renderWorkflowTasks === 'function') fetchWorkflowTasks();
}
```

- [ ] **Step 3: Wire the picker into `initContentPlan`**

Modify `initContentPlan` (from Task 5) to show the picker on first visit when no person is remembered yet. Find:

```javascript
  fetchContentPlan();
  google.script.run.withSuccessHandler(cfg => { G_CP_CONFIG = cfg; }).getConfigND();
```

Replace with:

```javascript
  fetchContentPlan();
  google.script.run.withSuccessHandler(cfg => {
    G_CP_CONFIG = cfg;
    renderCpPersonBanner();
    if (!getCpPerson()) showCpPersonPicker();
  }).getConfigND();
```

- [ ] **Step 4: Verify in the Browser pane**

Reuse the mock runner from Task 6. Before opening the tab, run `localStorage.removeItem('fujiwa_cp_person')` via `javascript_tool`. Click the tab, wait ~1s, confirm `#cp-person-modal` is visible with "Lan" as an option (from the mocked roster). Select it, click Xác nhận, confirm `#cp-person-banner` becomes visible showing "Lan" and the modal closes. Reload the page (re-navigate), re-mock, re-click the tab — confirm the picker does NOT reappear (banner shows immediately) since `localStorage` persisted. `read_console_messages({onlyErrors:true})` — expect none.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add local person-picker for Content Plan (localStorage, no login)"
```

---

## Task 8: Frontend — Workflow / "Việc của tôi" section

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `getWorkflowTasks(from, to)`, `markWorkflowTaskDone(taskId, note)`, `reopenWorkflowTask(taskId)` from Task 3; `getCpPerson()` from Task 7.
- Produces: `G_WF_ONLY_MINE` (boolean state), `fetchWorkflowTasks()`, `renderWorkflowTasks(tasks)`, `toggleWfOnlyMine()`, `markTaskDone(taskId, btnEl)`.

- [ ] **Step 1: Fill in the `cp-workflow-section` container**

Replace the placeholder `<div id="cp-workflow-section"></div>` (from Task 5 Step 1) with:

```html
  <div id="cp-workflow-section" class="card">
    <div class="card-title" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span>🔄 Việc của tôi</span>
      <span class="badge-pill" id="wf-count"></span>
      <button id="wf-toggle-btn" onclick="toggleWfOnlyMine()" style="margin-left:auto;padding:5px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">Xem tất cả</button>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th style="text-align:left">Bài</th><th>Giai đoạn</th><th>Deadline</th>
          <th>Người phụ trách</th><th>Status</th><th></th>
        </tr></thead>
        <tbody id="wf-body"></tbody>
      </table>
    </div>
  </div>
```

- [ ] **Step 2: Add the JS logic**

Add right after `confirmCpPerson` from Task 7:

```javascript
let G_WF_ONLY_MINE = true;
let G_WF_TASKS = [];

function toggleWfOnlyMine() {
  G_WF_ONLY_MINE = !G_WF_ONLY_MINE;
  document.getElementById('wf-toggle-btn').textContent = G_WF_ONLY_MINE ? 'Xem tất cả' : 'Chỉ của tôi';
  renderWorkflowTasks(G_WF_TASKS);
}

function fetchWorkflowTasks() {
  const body = document.getElementById('wf-body');
  if (body) body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">⏳ Đang tải...</td></tr>';
  google.script.run
    .withSuccessHandler(tasks => { G_WF_TASKS = tasks || []; renderWorkflowTasks(G_WF_TASKS); })
    .withFailureHandler(err => { if (body) body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#dc2626">Lỗi: ${err.message}</td></tr>`; })
    .getWorkflowTasks(G_CP_DATE.from, G_CP_DATE.to);
}

function renderWorkflowTasks(tasks) {
  const body = document.getElementById('wf-body');
  const count = document.getElementById('wf-count');
  const person = getCpPerson();
  const filtered = G_WF_ONLY_MINE && person ? tasks.filter(t => t.assignee === person) : tasks;
  if (count) count.textContent = filtered.length + ' việc';
  if (!body) return;
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">Không có việc nào</td></tr>';
    return;
  }
  const today = fmtD(new Date());
  body.innerHTML = filtered.map(t => {
    const overdue = t.status !== 'Done' && t.deadline && t.deadline < today;
    const rowStyle = overdue ? 'background:#fef2f2' : '';
    const assigneeCell = t.assignee || '<span style="color:#f59e0b">⚠️ Chưa gán</span>';
    const actionCell = t.status === 'Done'
      ? '<span style="color:#059669;font-weight:700">✓ Xong</span>'
      : `<button onclick="markTaskDone('${t.taskId}', this)" style="padding:4px 10px;background:#059669;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">✓ Done</button>`;
    return `<tr id="wf-row-${t.taskId}" style="${rowStyle}">
      <td>${t.desc || t.postId}</td>
      <td style="text-align:center">${t.stage}</td>
      <td style="text-align:center;${overdue ? 'color:#dc2626;font-weight:700' : ''}">${t.deadline}</td>
      <td style="text-align:center">${assigneeCell}</td>
      <td style="text-align:center">${t.status}</td>
      <td style="text-align:center">${actionCell}</td>
    </tr>`;
  }).join('');
}

function markTaskDone(taskId, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '...'; }
  google.script.run
    .withSuccessHandler(res => {
      if (!res.ok) { if (btnEl) { btnEl.disabled = false; btnEl.textContent = '✓ Done'; } alert(res.message); return; }
      const task = G_WF_TASKS.find(t => t.taskId === taskId);
      if (task) { task.status = 'Done'; task.doneDate = res.doneDate; }
      renderWorkflowTasks(G_WF_TASKS);
    })
    .withFailureHandler(err => {
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = '✓ Done'; }
      alert('Lỗi: ' + err.message);
    })
    .markWorkflowTaskDone(taskId);
}
```

- [ ] **Step 3: Call `fetchWorkflowTasks` alongside the content plan fetch**

Modify `initContentPlan` (from Task 5/7) — find:

```javascript
  fetchContentPlan();
  google.script.run.withSuccessHandler(cfg => {
    G_CP_CONFIG = cfg;
    renderCpPersonBanner();
    if (!getCpPerson()) showCpPersonPicker();
  }).getConfigND();
```

Replace with:

```javascript
  fetchContentPlan();
  fetchWorkflowTasks();
  google.script.run.withSuccessHandler(cfg => {
    G_CP_CONFIG = cfg;
    renderCpPersonBanner();
    if (!getCpPerson()) showCpPersonPicker();
  }).getConfigND();
```

- [ ] **Step 4: Verify in the Browser pane**

Extend the mock runner with:

```javascript
r.getWorkflowTasks = (from, to) => setTimeout(() => r._s([
  { taskId:'P001-1', postId:'P001', order:1, stage:'Brief', assignee:'Lan', email:'lan@fujiwavietnam.vn', role:'Content',
    deadline:'2026-06-01', status:'To Do', doneDate:'', note:'', page:'Fujiwa Speed', desc:'Test post' },
  { taskId:'P001-2', postId:'P001', order:2, stage:'Design', assignee:'', email:'', role:'Design Primary',
    deadline:'2026-07-20', status:'To Do', doneDate:'', note:'', page:'Fujiwa Speed', desc:'Test post' },
]), 10);
r.markWorkflowTaskDone = (taskId) => setTimeout(() => r._s({ ok: true, taskId: taskId, doneDate: '2026-07-31' }), 10);
```

Set `localStorage.setItem('fujiwa_cp_person','Lan')` first (so the person banner/filter has a value), reload, open the tab. Confirm: (a) with "Chỉ của tôi" active (default), only the `P001-1` row (assignee `Lan`) shows, and it's styled red/overdue since `2026-06-01 < today`; (b) the `P001-2` row shows "⚠️ Chưa gán" when "Xem tất cả" is clicked; (c) clicking "✓ Done" on the visible row replaces the button with "✓ Xong" without a full page reload (row's `status` cell also updates). `read_console_messages({onlyErrors:true})` — expect none.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add Workflow task list with 'chỉ của tôi' filter and Done button"
```

---

## Task 9: End-to-end verification + final commit

**Files:** none (verification only)

**Interfaces:** none — this task exercises Tasks 1–8 together.

- [ ] **Step 1: Combined browser walkthrough**

Navigate to `index.html`, hide `#app-loading`, install a single combined mock runner covering every function used across Tasks 5–8 (`getContentPlan`, `getConfigND`, `addContentPlanItem`, `getWorkflowTasks`, `markWorkflowTaskDone`) using the response shapes documented in each task above. Then, in order:

1. Click "📅 Kế hoạch ND" — confirm the person picker appears (fresh `localStorage`), pick a name.
2. Confirm both the Content Plan list and the Workflow list render with the mocked data.
3. Click "+ Thêm bài mới", fill the form, select a Format, confirm stage dropdowns appear, submit — confirm the new post appears in the list without a full reload.
4. In the Workflow section, toggle "Xem tất cả" / "Chỉ của tôi" — confirm the row set changes accordingly.
5. Click "✓ Done" on a task — confirm the row updates in place.
6. `read_console_messages({onlyErrors: true})` — expect zero entries across the whole walkthrough.

- [ ] **Step 2: Confirm `content-plan.gs` has no leftover smoke-test functions**

```bash
grep -n "_smokeTest" content-plan.gs
```

Expected: no output (all three smoke-test functions were deleted in Tasks 1–3).

- [ ] **Step 3: Final review commit (if anything was left uncommitted)**

```bash
git status --short
```

If `content-plan.gs` or `index.html` show as modified (e.g. from Step 2's cleanup), commit:

```bash
git add content-plan.gs index.html
git commit -m "chore: remove leftover smoke-test functions from content-plan.gs"
```

If `git status --short` shows nothing for these two files, no commit is needed here — Tasks 1–8 already committed everything.

---

## Self-Review Notes (already applied above)

- **Spec coverage:** Data model (3 sheets) → Task 1–3. Backend functions table → Tasks 1–3 (one row each). Frontend Section A → Tasks 4–6. Frontend Section B → Tasks 7–8. Error handling (`⚠️ Chưa gán người` badge, unknown-Task-ID message, no-edit-flow) → Tasks 6 (assignee handling) and 3/8 (unknown ID message). The `Session.getActiveUser()` correction from the spec's self-review is implemented as the Task 7 local person-picker, not server-side identity.
- **Type consistency:** `markWorkflowTaskDone(taskId, note)` takes 2 params everywhere it's defined (Task 3) and called (Task 8) — the stray `quality` param mentioned nowhere in the final Workflow header list was dropped consistently, not just in one place. `ContentPlan` row and `Workflow` task field names (`postId`, `pubDate`, `taskId`, `deadline`, `assignee`, etc.) are identical across every backend function and every frontend consumer.
- **No placeholders:** every step above has runnable code, not a description of code.
