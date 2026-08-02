'use strict';
/**
 * Hahaha - máy chủ nhắn tin / gọi điện / chia sẻ tài liệu nội bộ (LAN).
 * Toàn bộ dữ liệu nằm trên máy chạy server này, không đi ra Internet.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');
const selfsigned = require('selfsigned');

const { db, save, saveNow, DATA_DIR, UPLOAD_DIR } = require('./lib/db');
const auth = require('./lib/auth');

const HTTPS_PORT = Number(process.env.HAHAHA_PORT || 8443);
const HTTP_PORT = Number(process.env.HAHAHA_HTTP_PORT || 8080);
const JOIN_CODE = process.env.HAHAHA_JOIN_CODE || 'hahaha';
const MAX_FILE_MB = Number(process.env.HAHAHA_MAX_FILE_MB || 200);
const AVATAR_COLORS = ['#e11d48', '#f43f5e', '#fb7185', '#ef4444', '#f97316', '#d946ef', '#8b5cf6', '#06b6d4'];

/* ------------------------------------------------------------------ */
/* Dữ liệu khởi tạo                                                    */
/* ------------------------------------------------------------------ */
function ensureGeneralChannel() {
  let general = db.conversations.find((c) => c.type === 'channel' && c.key === 'general');
  if (!general) {
    general = {
      id: auth.newId('conv'),
      type: 'channel',
      key: 'general',
      name: 'Toàn công ty',
      topic: 'Kênh chung cho tất cả nhân viên',
      createdBy: null,
      createdAt: Date.now()
    };
    db.conversations.push(general);
    save();
  }
  return general;
}
ensureGeneralChannel();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const findUser = (id) => db.users.find((u) => u.id === id) || null;
const findConv = (id) => db.conversations.find((c) => c.id === id) || null;

function canAccess(user, conv) {
  if (!user || !conv) return false;
  if (conv.type === 'channel') return true; // kênh mở cho toàn công ty
  return Array.isArray(conv.members) && conv.members.includes(user.id);
}

function convForUser(conv, user) {
  const out = {
    id: conv.id,
    type: conv.type,
    name: conv.name,
    topic: conv.topic || '',
    members: conv.members || null,
    createdAt: conv.createdAt
  };
  if (conv.type === 'dm') {
    const otherId = (conv.members || []).find((m) => m !== user.id) || user.id;
    const other = findUser(otherId);
    out.name = other ? other.name : 'Người dùng đã xoá';
    out.peerId = otherId;
    out.avatarColor = other ? other.avatarColor : '#e11d48';
  }
  const last = [...db.messages].reverse().find((m) => m.convId === conv.id);
  out.lastMessage = last ? { text: last.text, ts: last.ts, userId: last.userId } : null;
  out.lastTs = last ? last.ts : conv.createdAt;
  return out;
}

function listConvsFor(user) {
  return db.conversations
    .filter((c) => canAccess(user, c))
    .map((c) => convForUser(c, user))
    .sort((a, b) => (a.type === b.type ? b.lastTs - a.lastTs : a.type === 'channel' ? -1 : 1));
}

function decorateMessage(m) {
  const u = findUser(m.userId);
  const file = m.fileId ? db.files.find((f) => f.id === m.fileId) : null;
  return {
    id: m.id,
    convId: m.convId,
    userId: m.userId,
    userName: u ? u.name : 'Người dùng đã xoá',
    avatarColor: u ? u.avatarColor : '#64748b',
    text: m.text,
    ts: m.ts,
    system: !!m.system,
    file: file
      ? { id: file.id, name: file.name, mime: file.mime, size: file.size, kind: fileKind(file.mime, file.name) }
      : null
  };
}

function fileKind(mime, name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if ((mime || '').startsWith('image/')) return 'image';
  if ((mime || '').startsWith('video/')) return 'video';
  if ((mime || '').startsWith('audio/')) return 'audio';
  if ((mime || '').startsWith('text/') || ['txt', 'md', 'csv', 'log', 'json'].includes(ext)) return 'text';
  return 'other';
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach((name) => {
    (ifaces[name] || []).forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Express                                                             */
/* ------------------------------------------------------------------ */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  req.cookies = auth.parseCookies(req.headers.cookie);
  req.user = auth.userFromToken(req.cookies.hahaha_token);
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Chưa đăng nhập' });
  next();
}

app.get('/api/config', (req, res) => {
  res.json({ appName: 'Hahaha', hasUsers: db.users.length > 0, me: auth.publicUser(req.user) });
});

app.post('/api/register', (req, res) => {
  const { username, name, password, joinCode } = req.body || {};
  if (!username || !name || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
  const uname = String(username).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,24}$/.test(uname)) {
    return res.status(400).json({ error: 'Tên đăng nhập 3-24 ký tự, chỉ gồm chữ thường, số, dấu . _ -' });
  }
  if (String(password).length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
  if (String(joinCode || '') !== JOIN_CODE) return res.status(403).json({ error: 'Mã công ty không đúng' });
  if (db.users.some((u) => u.username === uname)) return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });

  const { salt, hash } = auth.hashPassword(String(password));
  const user = {
    id: auth.newId('usr'),
    username: uname,
    name: String(name).trim().slice(0, 60),
    salt,
    hash,
    role: db.users.length === 0 ? 'admin' : 'member',
    avatarColor: AVATAR_COLORS[db.users.length % AVATAR_COLORS.length],
    createdAt: Date.now()
  };
  db.users.push(user);
  save();
  const token = auth.createSession(user.id);
  res.setHeader('Set-Cookie', sessionCookie(token, req));
  broadcastDirectory();
  res.json({ me: auth.publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const uname = String(username || '').trim().toLowerCase();
  const user = db.users.find((u) => u.username === uname);
  if (!user || !auth.verifyPassword(String(password || ''), user.salt, user.hash)) {
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  }
  const token = auth.createSession(user.id);
  res.setHeader('Set-Cookie', sessionCookie(token, req));
  res.json({ me: auth.publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  auth.destroySession(req.cookies.hahaha_token);
  res.setHeader('Set-Cookie', 'hahaha_token=; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

function sessionCookie(token, req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return (
    'hahaha_token=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + 60 * 60 * 24 * 30 + (secure ? '; Secure' : '')
  );
}

/* ---------------------------- Tải tệp lên -------------------------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex'))
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_MB * 1024 * 1024 } });

app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  const conv = findConv(req.body.convId);
  if (!conv || !canAccess(req.user, conv)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: 'Không có quyền gửi vào cuộc trò chuyện này' });
  }
  if (!req.file) return res.status(400).json({ error: 'Không có tệp' });

  const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const file = {
    id: auth.newId('file'),
    storedName: req.file.filename,
    name: original,
    mime: req.file.mimetype,
    size: req.file.size,
    ownerId: req.user.id,
    convId: conv.id,
    ts: Date.now()
  };
  db.files.push(file);

  const message = {
    id: auth.newId('msg'),
    convId: conv.id,
    userId: req.user.id,
    text: String(req.body.text || '').slice(0, 4000),
    fileId: file.id,
    ts: Date.now()
  };
  db.messages.push(message);
  save();

  emitToConv(conv, 'msg:new', decorateMessage(message));
  emitToConv(conv, 'files:changed', {});
  res.json({ ok: true, file: { id: file.id, name: file.name } });
});

/* --------------------- Xem tài liệu (chỉ xem) ---------------------- */
function fileGuard(req, res, next) {
  if (!req.user) return res.status(401).send('Chưa đăng nhập');
  const file = db.files.find((f) => f.id === req.params.id);
  if (!file) return res.status(404).send('Không tìm thấy tài liệu');
  const conv = findConv(file.convId);
  if (!canAccess(req.user, conv)) return res.status(403).send('Không có quyền xem tài liệu này');
  req.file_ = file;
  next();
}

app.get('/api/file/:id/meta', fileGuard, (req, res) => {
  const f = req.file_;
  const owner = findUser(f.ownerId);
  res.json({
    id: f.id,
    name: f.name,
    mime: f.mime,
    size: f.size,
    kind: fileKind(f.mime, f.name),
    ts: f.ts,
    ownerName: owner ? owner.name : '—',
    viewerName: req.user.name
  });
});

// Luồng dữ liệu thô: luôn trả về inline, không bao giờ kèm Content-Disposition
// attachment, và chặn cache phía trình duyệt để hạn chế lưu lại bản sao.
app.get('/api/file/:id/raw', fileGuard, (req, res) => {
  const f = req.file_;
  const full = path.join(UPLOAD_DIR, f.storedName);
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(full, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

app.get('/api/files', requireAuth, (req, res) => {
  const items = db.files
    .filter((f) => canAccess(req.user, findConv(f.convId)))
    .map((f) => {
      const owner = findUser(f.ownerId);
      const conv = findConv(f.convId);
      return {
        id: f.id,
        name: f.name,
        mime: f.mime,
        size: f.size,
        kind: fileKind(f.mime, f.name),
        ts: f.ts,
        ownerName: owner ? owner.name : '—',
        convName: conv ? (conv.type === 'dm' ? 'Tin nhắn riêng' : conv.name) : '—'
      };
    })
    .sort((a, b) => b.ts - a.ts);
  res.json({ files: items });
});

app.delete('/api/file/:id', fileGuard, (req, res) => {
  const f = req.file_;
  if (f.ownerId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ người tải lên hoặc quản trị viên mới xoá được' });
  }
  db.files = db.files.filter((x) => x.id !== f.id);
  db.messages.forEach((m) => {
    if (m.fileId === f.id) {
      m.fileId = null;
      m.text = m.text || '(tài liệu đã bị thu hồi)';
    }
  });
  fs.unlink(path.join(UPLOAD_DIR, f.storedName), () => {});
  save();
  const conv = findConv(f.convId);
  if (conv) {
    emitToConv(conv, 'files:changed', {});
    emitToConv(conv, 'conv:reload', { convId: conv.id });
  }
  res.json({ ok: true });
});

/* ------------------------------ Tĩnh -------------------------------- */
// pdf.js được phục vụ ngay từ máy chủ nội bộ (bản legacy để chạy được cả trên
// trình duyệt đời cũ). Kèm cmaps / font chuẩn / wasm để hiển thị đúng tiếng Việt.
const PDFJS_DIR = path.join(__dirname, 'node_modules', 'pdfjs-dist');
app.use('/vendor/pdfjs/cmaps', express.static(path.join(PDFJS_DIR, 'cmaps')));
app.use('/vendor/pdfjs/standard_fonts', express.static(path.join(PDFJS_DIR, 'standard_fonts')));
app.use('/vendor/pdfjs/wasm', express.static(path.join(PDFJS_DIR, 'wasm')));
app.use('/vendor/pdfjs', express.static(path.join(PDFJS_DIR, 'legacy', 'build')));
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
  })
);

/* ------------------------------------------------------------------ */
/* HTTPS (bắt buộc để trình duyệt cho phép dùng micro / camera)        */
/* ------------------------------------------------------------------ */
async function loadOrCreateCert() {
  const keyFile = path.join(DATA_DIR, 'server.key');
  const certFile = path.join(DATA_DIR, 'server.crt');
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  }
  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }];
  lanAddresses().forEach((ip) => altNames.push({ type: 7, ip }));
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 10);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Hahaha LAN' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: notAfter,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'subjectAltName', altNames }
    ]
  });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

const server = https.createServer({}, app);

// Cổng HTTP chỉ để chuyển hướng sang HTTPS cho người gõ nhầm địa chỉ.
const redirectServer = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  res.writeHead(301, { Location: 'https://' + host + ':' + HTTPS_PORT + req.url });
  res.end();
});
redirectServer.on('error', (err) => {
  console.warn('  (bỏ qua) Không mở được cổng chuyển hướng HTTP ' + HTTP_PORT + ': ' + err.code);
});
redirectServer.listen(HTTP_PORT, '0.0.0.0');

/* ------------------------------------------------------------------ */
/* Socket.IO: chat, hiện diện, báo hiệu cuộc gọi                        */
/* ------------------------------------------------------------------ */
const io = new Server(server, { maxHttpBufferSize: 1e6 });

const online = new Map(); // userId -> Set<socketId>
const calls = new Map(); // convId -> Map<userId, {socketId, name, avatarColor, video}>

io.use((socket, next) => {
  const cookies = auth.parseCookies(socket.handshake.headers.cookie);
  const user = auth.userFromToken(cookies.hahaha_token || socket.handshake.auth?.token);
  if (!user) return next(new Error('unauthorized'));
  socket.user = user;
  next();
});

function emitToConv(conv, event, payload) {
  if (!conv) return;
  if (conv.type === 'channel') return io.emit(event, payload);
  (conv.members || []).forEach((uid) => {
    (online.get(uid) || new Set()).forEach((sid) => io.to(sid).emit(event, payload));
  });
}

function emitToUser(userId, event, payload) {
  (online.get(userId) || new Set()).forEach((sid) => io.to(sid).emit(event, payload));
}

function directory() {
  return db.users.map((u) => ({
    ...auth.publicUser(u),
    online: (online.get(u.id) || new Set()).size > 0
  }));
}

function broadcastDirectory() {
  io.emit('directory', directory());
}

function callSummary(convId) {
  const room = calls.get(convId);
  if (!room || room.size === 0) return { convId, active: false, participants: [] };
  return {
    convId,
    active: true,
    participants: [...room.entries()].map(([userId, p]) => ({
      userId,
      name: p.name,
      avatarColor: p.avatarColor,
      video: p.video
    }))
  };
}

function broadcastCallState(convId) {
  const conv = findConv(convId);
  emitToConv(conv, 'call:state', callSummary(convId));
}

io.on('connection', (socket) => {
  const user = socket.user;
  if (!online.has(user.id)) online.set(user.id, new Set());
  online.get(user.id).add(socket.id);
  broadcastDirectory();

  socket.emit('bootstrap', {
    me: auth.publicUser(user),
    conversations: listConvsFor(user),
    directory: directory(),
    activeCalls: [...calls.keys()].map(callSummary).filter((c) => c.active)
  });

  socket.on('conv:list', (cb) => typeof cb === 'function' && cb(listConvsFor(user)));

  socket.on('conv:history', ({ convId, before } = {}, cb) => {
    const conv = findConv(convId);
    if (!canAccess(user, conv)) return typeof cb === 'function' && cb({ error: 'Không có quyền' });
    let items = db.messages.filter((m) => m.convId === convId);
    if (before) items = items.filter((m) => m.ts < before);
    const page = items.slice(-60).map(decorateMessage);
    if (typeof cb === 'function') cb({ messages: page, hasMore: items.length > page.length });
  });

  socket.on('msg:send', ({ convId, text } = {}, cb) => {
    const conv = findConv(convId);
    if (!canAccess(user, conv)) return typeof cb === 'function' && cb({ error: 'Không có quyền' });
    const clean = String(text || '').trim().slice(0, 4000);
    if (!clean) return typeof cb === 'function' && cb({ error: 'Tin nhắn trống' });
    const message = { id: auth.newId('msg'), convId, userId: user.id, text: clean, fileId: null, ts: Date.now() };
    db.messages.push(message);
    save();
    emitToConv(conv, 'msg:new', decorateMessage(message));
    if (typeof cb === 'function') cb({ ok: true, id: message.id });
  });

  socket.on('msg:delete', ({ id } = {}) => {
    const m = db.messages.find((x) => x.id === id);
    if (!m) return;
    if (m.userId !== user.id && user.role !== 'admin') return;
    m.text = 'Tin nhắn đã được thu hồi';
    m.system = true;
    m.fileId = null;
    save();
    emitToConv(findConv(m.convId), 'msg:update', decorateMessage(m));
  });

  socket.on('typing', ({ convId, on } = {}) => {
    const conv = findConv(convId);
    if (!canAccess(user, conv)) return;
    (conv.type === 'channel' ? db.users.map((u) => u.id) : conv.members || []).forEach((uid) => {
      if (uid !== user.id) emitToUser(uid, 'typing', { convId, userId: user.id, name: user.name, on: !!on });
    });
  });

  socket.on('channel:create', ({ name, topic } = {}, cb) => {
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) return typeof cb === 'function' && cb({ error: 'Tên kênh không hợp lệ' });
    const conv = {
      id: auth.newId('conv'),
      type: 'channel',
      key: null,
      name: clean,
      topic: String(topic || '').slice(0, 140),
      createdBy: user.id,
      createdAt: Date.now()
    };
    db.conversations.push(conv);
    save();
    io.emit('conv:new', { convId: conv.id });
    if (typeof cb === 'function') cb({ ok: true, conv: convForUser(conv, user) });
  });

  socket.on('dm:open', ({ userId } = {}, cb) => {
    const other = findUser(userId);
    if (!other) return typeof cb === 'function' && cb({ error: 'Không tìm thấy người dùng' });
    const members = [user.id, other.id].sort();
    let conv = db.conversations.find(
      (c) => c.type === 'dm' && Array.isArray(c.members) && c.members.slice().sort().join('|') === members.join('|')
    );
    if (!conv) {
      conv = {
        id: auth.newId('conv'),
        type: 'dm',
        name: null,
        members,
        createdBy: user.id,
        createdAt: Date.now()
      };
      db.conversations.push(conv);
      save();
      members.forEach((uid) => emitToUser(uid, 'conv:new', { convId: conv.id }));
    }
    if (typeof cb === 'function') cb({ ok: true, conv: convForUser(conv, user) });
  });

  /* ------------------------- Cuộc gọi (WebRTC) ---------------------- */
  socket.on('call:join', ({ convId, video } = {}, cb) => {
    const conv = findConv(convId);
    if (!canAccess(user, conv)) return typeof cb === 'function' && cb({ error: 'Không có quyền' });
    if (!calls.has(convId)) calls.set(convId, new Map());
    const room = calls.get(convId);
    const isFirst = room.size === 0;
    const peers = [...room.entries()]
      .filter(([uid]) => uid !== user.id)
      .map(([uid, p]) => ({ userId: uid, socketId: p.socketId, name: p.name, avatarColor: p.avatarColor }));

    room.set(user.id, { socketId: socket.id, name: user.name, avatarColor: user.avatarColor, video: !!video });
    socket.join('call:' + convId);
    socket.data.callConv = convId;

    // Người mới vào sẽ là bên gửi offer tới từng người đang có mặt.
    if (typeof cb === 'function') cb({ ok: true, peers, self: { userId: user.id, socketId: socket.id } });
    peers.forEach((p) =>
      io.to(p.socketId).emit('call:peer-joined', {
        convId,
        userId: user.id,
        socketId: socket.id,
        name: user.name,
        avatarColor: user.avatarColor
      })
    );

    if (isFirst) {
      const targets = conv.type === 'channel' ? db.users.map((u) => u.id) : conv.members || [];
      targets
        .filter((uid) => uid !== user.id)
        .forEach((uid) =>
          emitToUser(uid, 'call:ring', {
            convId,
            convName: conv.type === 'dm' ? user.name : conv.name,
            type: conv.type,
            from: { userId: user.id, name: user.name, avatarColor: user.avatarColor },
            video: !!video
          })
        );
    }
    broadcastCallState(convId);
  });

  socket.on('call:signal', ({ to, data } = {}) => {
    if (!to || !data) return;
    io.to(to).emit('call:signal', { from: socket.id, fromUserId: user.id, data });
  });

  socket.on('call:media', ({ convId, video, muted } = {}) => {
    const room = calls.get(convId);
    if (!room || !room.has(user.id)) return;
    const p = room.get(user.id);
    p.video = !!video;
    p.muted = !!muted;
    broadcastCallState(convId);
  });

  socket.on('call:decline', ({ convId } = {}) => {
    const room = calls.get(convId);
    if (!room) return;
    room.forEach((p) => io.to(p.socketId).emit('call:declined', { convId, userId: user.id, name: user.name }));
  });

  function leaveCall(convId) {
    if (!convId) return;
    const room = calls.get(convId);
    if (!room) return;
    const entry = room.get(user.id);
    if (!entry || entry.socketId !== socket.id) return;
    room.delete(user.id);
    socket.leave('call:' + convId);
    io.to('call:' + convId).emit('call:peer-left', { convId, userId: user.id, socketId: socket.id });
    if (room.size === 0) calls.delete(convId);
    broadcastCallState(convId);
  }

  socket.on('call:leave', ({ convId } = {}) => leaveCall(convId || socket.data.callConv));

  socket.on('disconnect', () => {
    leaveCall(socket.data.callConv);
    const set = online.get(user.id);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) online.delete(user.id);
    }
    broadcastDirectory();
  });
});

/* ------------------------------------------------------------------ */
loadOrCreateCert()
  .then(({ key, cert }) => {
    server.setSecureContext({ key, cert });
    server.listen(HTTPS_PORT, '0.0.0.0', () => {
      const urls = ['https://localhost:' + HTTPS_PORT, ...lanAddresses().map((ip) => 'https://' + ip + ':' + HTTPS_PORT)];
      console.log('');
      console.log('  ██  Hahaha - máy chủ nội bộ đã sẵn sàng');
      console.log('  ─────────────────────────────────────────');
      urls.forEach((u) => console.log('   ' + u));
      console.log('   Mã tham gia công ty: ' + JOIN_CODE);
      console.log('   Dữ liệu lưu tại: ' + DATA_DIR);
      console.log('');
      console.log('  Lần đầu mở, trình duyệt sẽ cảnh báo chứng chỉ tự ký -> chọn "Nâng cao / Advanced" rồi "Tiếp tục".');
      console.log('');
    });
  })
  .catch((err) => {
    console.error('Không tạo được chứng chỉ HTTPS:', err);
    process.exit(1);
  });

process.on('SIGINT', () => {
  saveNow();
  process.exit(0);
});
process.on('SIGTERM', () => {
  saveNow();
  process.exit(0);
});
