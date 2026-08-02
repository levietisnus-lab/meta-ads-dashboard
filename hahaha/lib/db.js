'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.HAHAHA_DATA_DIR
  ? path.resolve(process.env.HAHAHA_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EMPTY = {
  users: [],
  conversations: [],
  messages: [],
  files: [],
  sessions: {}
};

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return Object.assign({}, EMPTY, raw);
  } catch (err) {
    return JSON.parse(JSON.stringify(EMPTY));
  }
}

const db = load();

// Ghi xuống đĩa theo kiểu debounce để không chặn luồng chat.
let writeTimer = null;
let writing = false;
function save() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (writing) return save();
    writing = true;
    const tmp = DB_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), (err) => {
      if (!err) {
        try {
          fs.renameSync(tmp, DB_FILE);
        } catch (e) {
          /* bỏ qua, lần ghi sau sẽ vá lại */
        }
      }
      writing = false;
    });
  }, 250);
}

function saveNow() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
  } catch (e) {
    /* ignore */
  }
}

module.exports = { db, save, saveNow, DATA_DIR, UPLOAD_DIR, DB_FILE };
