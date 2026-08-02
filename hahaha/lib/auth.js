'use strict';
const crypto = require('crypto');
const { db, save } = require('./db');

const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 ngày

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, s, 32).toString('hex');
  return { salt: s, hash };
}

function verifyPassword(password, salt, hash) {
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(9).toString('hex');
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { userId, createdAt: Date.now() };
  save();
  return token;
}

function destroySession(token) {
  if (token && db.sessions[token]) {
    delete db.sessions[token];
    save();
  }
}

function userFromToken(token) {
  if (!token) return null;
  const sess = db.sessions[token];
  if (!sess) return null;
  if (Date.now() - sess.createdAt > SESSION_TTL) {
    delete db.sessions[token];
    save();
    return null;
  }
  return db.users.find((u) => u.id === sess.userId) || null;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, name: u.name, role: u.role, avatarColor: u.avatarColor };
}

module.exports = {
  hashPassword,
  verifyPassword,
  newId,
  createSession,
  destroySession,
  userFromToken,
  parseCookies,
  publicUser
};
