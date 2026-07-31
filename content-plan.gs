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

// Thêm 1 bài vào Kế hoạch nội dung + tự sinh các dòng Workflow theo template Format đã chọn
function addContentPlanItem(data) {
  _ensureContentPlanSheets();
  const pubDate = String((data && data.pubDate) || '').trim();
  const page = String((data && data.page) || '').trim();
  const format = String((data && data.format) || '').trim();
  if (!pubDate || !page || !format) {
    return { ok: false, message: 'Thiếu Ngày đăng / Page / Format.' };
  }

  const pillar = String((data && data.pillar) || '').trim();
  const desc = String((data && data.desc) || '').trim();
  const owner = String((data && data.ownerName) || '').trim();
  const assignments = (data && data.assignments) || {};

  const lock = LockService.getScriptLock();
  let postId, generatedTasks;
  try {
    lock.waitLock(10000);

    postId = _nextContentPlanPostId();

    SS.getSheetByName('Kế hoạch nội dung')
      .appendRow([postId, pubDate, page, format, pillar, desc, owner, 'Planned', '']);

    const cfg = getConfigND();
    const template = cfg.templates[format] || [];
    const rosterByName = {};
    cfg.roster.forEach(p => { rosterByName[p.name] = p; });

    const wfSh = SS.getSheetByName('Workflow');
    generatedTasks = [];
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
  } finally {
    lock.releaseLock();
  }

  return { ok: true, postId: postId, tasks: generatedTasks };
}

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
