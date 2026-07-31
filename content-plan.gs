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
