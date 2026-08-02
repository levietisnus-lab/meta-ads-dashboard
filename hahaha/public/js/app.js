/* Hahaha — logic giao diện chính */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var state = {
    me: null,
    socket: null,
    conversations: [],
    directory: [],
    activeConv: null,
    messages: [],
    typingUsers: {},
    activeCalls: {},
    incoming: null,
    filter: ''
  };

  /* ----------------------------- Tiện ích ----------------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDay(ts) {
    var d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Hôm nay';
    return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
  function kindIcon(kind) {
    return { pdf: '📕', image: '🖼️', video: '🎬', audio: '🎵', text: '📄' }[kind] || '📦';
  }
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 3200);
  }
  function api(url, opts) {
    return fetch(url, Object.assign({ credentials: 'same-origin' }, opts)).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Lỗi máy chủ');
        return data;
      });
    });
  }

  /* ---------------------------- Đăng nhập ---------------------------- */
  document.querySelectorAll('[data-auth-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-auth-tab]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var login = btn.dataset.authTab === 'login';
      $('#loginForm').classList.toggle('hidden', !login);
      $('#registerForm').classList.toggle('hidden', login);
      $('#authError').textContent = '';
    });
  });

  function submitAuth(form, url) {
    var body = {};
    new FormData(form).forEach(function (v, k) { body[k] = v; });
    api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (data) { start(data.me); })
      .catch(function (err) { $('#authError').textContent = err.message; });
  }
  $('#loginForm').addEventListener('submit', function (e) { e.preventDefault(); submitAuth(e.target, '/api/login'); });
  $('#registerForm').addEventListener('submit', function (e) { e.preventDefault(); submitAuth(e.target, '/api/register'); });

  $('#btnLogout').addEventListener('click', function () {
    api('/api/logout', { method: 'POST' }).then(function () { location.reload(); });
  });

  /* ------------------------------ Khởi động ------------------------------ */
  api('/api/config')
    .then(function (cfg) {
      if (cfg.me) return start(cfg.me);
      $('#auth').classList.remove('hidden');
      if (!cfg.hasUsers) {
        document.querySelector('[data-auth-tab="register"]').click();
        $('#authError').textContent = 'Chưa có tài khoản nào — người đăng ký đầu tiên sẽ là quản trị viên.';
      }
    })
    .catch(function () { $('#auth').classList.remove('hidden'); });

  function start(me) {
    state.me = me;
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#meName').textContent = me.name;
    $('#meRole').textContent = me.role === 'admin' ? 'Quản trị viên' : '@' + me.username;
    $('#meAvatar').textContent = initials(me.name);
    $('#meAvatar').style.background = me.avatarColor;
    connectSocket();
  }

  /* ------------------------------ Socket ------------------------------ */
  function connectSocket() {
    var socket = io({ withCredentials: true });
    state.socket = socket;
    HahahaCall.attach(socket, callUI);

    socket.on('bootstrap', function (data) {
      state.me = data.me;
      state.conversations = data.conversations;
      state.directory = data.directory;
      state.activeCalls = {};
      (data.activeCalls || []).forEach(function (c) { state.activeCalls[c.convId] = c; });
      renderSidebar();
      if (!state.activeConv && state.conversations.length) openConv(state.conversations[0].id);
      else if (state.activeConv) renderCallBanner();
    });

    socket.on('directory', function (dir) { state.directory = dir; renderSidebar(); });

    socket.on('conv:new', function () {
      socket.emit('conv:list', function (list) { state.conversations = list; renderSidebar(); });
    });

    socket.on('msg:new', function (msg) {
      var conv = state.conversations.find(function (c) { return c.id === msg.convId; });
      if (conv) { conv.lastMessage = { text: msg.text, ts: msg.ts, userId: msg.userId }; conv.lastTs = msg.ts; }
      if (state.activeConv && msg.convId === state.activeConv.id) {
        state.messages.push(msg);
        renderMessages(true);
      } else if (msg.userId !== state.me.id) {
        toast((conv ? conv.name : 'Tin nhắn mới') + ': ' + (msg.text || 'đã gửi tài liệu'));
      }
      renderSidebar();
    });

    socket.on('msg:update', function (msg) {
      var idx = state.messages.findIndex(function (m) { return m.id === msg.id; });
      if (idx >= 0) { state.messages[idx] = msg; renderMessages(false); }
    });

    socket.on('conv:reload', function (p) {
      if (state.activeConv && state.activeConv.id === p.convId) loadHistory(p.convId);
    });

    socket.on('typing', function (p) {
      if (!state.activeConv || p.convId !== state.activeConv.id) return;
      if (p.on) state.typingUsers[p.userId] = p.name;
      else delete state.typingUsers[p.userId];
      var names = Object.values(state.typingUsers);
      $('#typing').textContent = names.length ? names.join(', ') + ' đang nhập…' : '';
    });

    socket.on('call:state', function (s) {
      if (s.active) state.activeCalls[s.convId] = s;
      else delete state.activeCalls[s.convId];
      renderCallBanner();
      renderSidebar();
      if (HahahaCall.isActive() && HahahaCall.convId === s.convId) updateCallTitle();
      if (state.incoming && state.incoming.convId === s.convId && !s.active) closeRing();
    });

    socket.on('call:ring', function (p) {
      if (HahahaCall.isActive()) return;
      showRing(p);
    });

    socket.on('call:declined', function (p) { toast(p.name + ' đã từ chối cuộc gọi'); });

    socket.on('connect_error', function () { toast('Mất kết nối tới máy chủ Hahaha'); });
  }

  /* ------------------------------ Sidebar ------------------------------ */
  function matchFilter(text) {
    return !state.filter || String(text || '').toLowerCase().indexOf(state.filter) >= 0;
  }

  function renderSidebar() {
    var channels = state.conversations.filter(function (c) { return c.type === 'channel' && matchFilter(c.name); });
    var dms = state.conversations.filter(function (c) { return c.type === 'dm' && matchFilter(c.name); });

    $('#channelList').innerHTML = channels.map(function (c) {
      var live = state.activeCalls[c.id] ? '<span class="badge-live">LIVE</span>' : '';
      return '<li class="nav-item' + (state.activeConv && state.activeConv.id === c.id ? ' active' : '') +
        '" data-conv="' + c.id + '"><span>#</span><span class="label">' + esc(c.name) + '</span>' + live + '</li>';
    }).join('');

    $('#dmList').innerHTML = dms.length ? dms.map(function (c) {
      var person = state.directory.find(function (u) { return u.id === c.peerId; });
      var live = state.activeCalls[c.id] ? '<span class="badge-live">LIVE</span>' : '';
      return '<li class="nav-item' + (state.activeConv && state.activeConv.id === c.id ? ' active' : '') +
        '" data-conv="' + c.id + '"><span class="badge-dot' + (person && person.online ? ' on' : '') + '"></span>' +
        '<span class="label">' + esc(c.name) + '</span>' + live + '</li>';
    }).join('') : '<li class="nav-item" style="cursor:default;color:var(--dim);font-size:12.5px">Chọn đồng nghiệp bên dưới để nhắn riêng</li>';

    $('#peopleList').innerHTML = state.directory
      .filter(function (u) { return u.id !== state.me.id && matchFilter(u.name + ' ' + u.username); })
      .sort(function (a, b) { return (b.online ? 1 : 0) - (a.online ? 1 : 0) || a.name.localeCompare(b.name); })
      .map(function (u) {
        return '<li class="nav-item" data-user="' + u.id + '">' +
          '<span class="avatar sm" style="background:' + esc(u.avatarColor) + '">' + esc(initials(u.name)) + '</span>' +
          '<span class="label">' + esc(u.name) + '<span class="sub">' + (u.online ? 'Đang trực tuyến' : 'Ngoại tuyến') + '</span></span>' +
          '<span class="badge-dot' + (u.online ? ' on' : '') + '"></span></li>';
      }).join('');
  }

  document.addEventListener('click', function (e) {
    var convItem = e.target.closest('[data-conv]');
    if (convItem) { openConv(convItem.dataset.conv); closeSidebarMobile(); return; }
    var userItem = e.target.closest('[data-user]');
    if (userItem) {
      state.socket.emit('dm:open', { userId: userItem.dataset.user }, function (res) {
        if (res.error) return toast(res.error);
        state.socket.emit('conv:list', function (list) {
          state.conversations = list;
          openConv(res.conv.id);
          closeSidebarMobile();
        });
      });
      return;
    }
    if (e.target.closest('[data-close-modal]')) {
      var modal = e.target.closest('.modal');
      if (modal) {
        modal.classList.add('hidden');
        if (modal.id === 'viewerModal') $('#viewerFrame').src = 'about:blank';
      }
    }
  });

  $('#searchBox').addEventListener('input', function (e) {
    state.filter = e.target.value.trim().toLowerCase();
    renderSidebar();
  });
  $('#btnOpenSidebar').addEventListener('click', function () { $('#sidebar').classList.add('open'); });
  $('#btnCloseSidebar').addEventListener('click', closeSidebarMobile);
  function closeSidebarMobile() { $('#sidebar').classList.remove('open'); }

  /* ---------------------------- Trò chuyện ---------------------------- */
  function openConv(convId) {
    var conv = state.conversations.find(function (c) { return c.id === convId; });
    if (!conv) return;
    state.activeConv = conv;
    state.typingUsers = {};
    $('#typing').textContent = '';
    $('#convName').textContent = (conv.type === 'channel' ? '# ' : '') + conv.name;
    $('#convTopic').textContent = conv.type === 'channel' ? conv.topic || 'Kênh chung của công ty' : 'Tin nhắn riêng — chỉ hai người nhìn thấy';
    $('#msgInput').disabled = false;
    $('#composer button[type=submit]').disabled = false;
    $('#btnAudioCall').disabled = false;
    $('#btnVideoCall').disabled = false;
    renderSidebar();
    renderCallBanner();
    loadHistory(convId);
  }

  function loadHistory(convId) {
    state.socket.emit('conv:history', { convId: convId }, function (res) {
      if (res.error) return toast(res.error);
      state.messages = res.messages;
      renderMessages(true);
    });
  }

  function renderMessages(scroll) {
    var box = $('#messages');
    if (!state.messages.length) {
      box.innerHTML = '<div class="empty-state"><div class="empty-mark">H</div><h3>Chưa có tin nhắn</h3>' +
        '<p>Hãy gửi lời chào đầu tiên, hoặc bấm 📎 để chia sẻ tài liệu ở chế độ chỉ xem.</p></div>';
      return;
    }
    var html = '';
    var lastDay = '', lastUser = '', lastTs = 0;
    state.messages.forEach(function (m) {
      var day = fmtDay(m.ts);
      if (day !== lastDay) { html += '<div class="day-sep">— ' + esc(day) + ' —</div>'; lastDay = day; lastUser = ''; }
      var grouped = m.userId === lastUser && m.ts - lastTs < 5 * 60 * 1000 && !m.system;
      lastUser = m.userId; lastTs = m.ts;

      html += '<div class="msg' + (grouped ? ' grouped' : '') + (m.system ? ' system' : '') + '">' +
        '<div class="avatar" style="background:' + esc(m.avatarColor) + '">' + esc(initials(m.userName)) + '</div>' +
        '<div class="msg-body">' +
        (grouped ? '' : '<div class="msg-meta"><strong>' + esc(m.userName) + '</strong><time>' + fmtTime(m.ts) + '</time>' +
          ((m.userId === state.me.id || state.me.role === 'admin') && !m.system
            ? '<button class="msg-actions" data-del="' + m.id + '">thu hồi</button>' : '') + '</div>') +
        (m.text ? '<p class="msg-text">' + esc(m.text) + '</p>' : '') +
        (m.file ? fileCard(m.file) : '') +
        '</div></div>';
    });
    box.innerHTML = html;
    if (scroll) box.scrollTop = box.scrollHeight;
  }

  function fileCard(f) {
    return '<div class="file-card" data-file="' + f.id + '">' +
      '<div class="file-ico">' + kindIcon(f.kind) + '</div>' +
      '<div class="file-info"><strong>' + esc(f.name) + '</strong><span>' + fmtSize(f.size) + ' • chỉ xem</span></div>' +
      '<span class="file-open">Mở ▸</span></div>';
  }

  $('#messages').addEventListener('click', function (e) {
    var del = e.target.closest('[data-del]');
    if (del) { state.socket.emit('msg:delete', { id: del.dataset.del }); return; }
    var card = e.target.closest('[data-file]');
    if (card) openViewer(card.dataset.file, card.querySelector('strong').textContent);
  });

  /* ------------------------------ Soạn tin ------------------------------ */
  var input = $('#msgInput');
  var typingTimer = null;
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    if (!state.activeConv) return;
    state.socket.emit('typing', { convId: state.activeConv.id, on: true });
    clearTimeout(typingTimer);
    typingTimer = setTimeout(function () {
      state.socket.emit('typing', { convId: state.activeConv.id, on: false });
    }, 1600);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); }
  });

  $('#composer').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || !state.activeConv) return;
    state.socket.emit('msg:send', { convId: state.activeConv.id, text: text }, function (res) {
      if (res && res.error) toast(res.error);
    });
    input.value = '';
    input.style.height = 'auto';
    state.socket.emit('typing', { convId: state.activeConv.id, on: false });
  });

  /* ---------------------------- Tải tài liệu ---------------------------- */
  $('#btnAttach').addEventListener('click', function () { $('#fileInput').click(); });
  $('#fileInput').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file || !state.activeConv) return;
    uploadFile(file, state.activeConv.id);
    e.target.value = '';
  });

  function uploadFile(file, convId) {
    var bar = $('#uploadBar');
    var fill = bar.querySelector('.upload-fill');
    var label = bar.querySelector('span');
    bar.classList.remove('hidden');
    label.textContent = 'Đang tải lên ' + file.name + '…';

    var form = new FormData();
    form.append('convId', convId);
    form.append('file', file);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.withCredentials = true;
    xhr.upload.onprogress = function (ev) {
      if (ev.lengthComputable) fill.style.width = (ev.loaded / ev.total) * 60 + '%';
    };
    xhr.onload = function () {
      bar.classList.add('hidden');
      fill.style.width = '0';
      if (xhr.status >= 400) {
        try { toast(JSON.parse(xhr.responseText).error); } catch (e) { toast('Tải tệp thất bại'); }
      } else toast('Đã chia sẻ tài liệu (chế độ chỉ xem)');
    };
    xhr.onerror = function () { bar.classList.add('hidden'); toast('Tải tệp thất bại'); };
    xhr.send(form);
  }

  /* --------------------------- Kho tài liệu --------------------------- */
  $('#btnDocs').addEventListener('click', function () {
    $('#docsModal').classList.remove('hidden');
    loadDocs();
  });
  $('#docsSearch').addEventListener('input', loadDocs);

  function loadDocs() {
    var q = $('#docsSearch').value.trim().toLowerCase();
    api('/api/files').then(function (data) {
      var items = data.files.filter(function (f) { return !q || f.name.toLowerCase().indexOf(q) >= 0; });
      $('#docsList').innerHTML = items.length ? items.map(function (f) {
        return '<div class="doc-row" data-file="' + f.id + '" data-name="' + esc(f.name) + '">' +
          '<div class="file-ico">' + kindIcon(f.kind) + '</div>' +
          '<div class="file-info"><strong>' + esc(f.name) + '</strong><span>' + esc(f.ownerName) + ' • ' +
          esc(f.convName) + ' • ' + fmtSize(f.size) + ' • ' + new Date(f.ts).toLocaleDateString('vi-VN') + '</span></div>' +
          '<span class="file-open">Xem ▸</span></div>';
      }).join('') : '<p style="color:var(--dim);font-size:13px">Chưa có tài liệu nào được chia sẻ.</p>';
    });
  }

  $('#docsList').addEventListener('click', function (e) {
    var row = e.target.closest('[data-file]');
    if (row) openViewer(row.dataset.file, row.dataset.name);
  });

  function openViewer(fileId, name) {
    $('#viewerTitle').textContent = name || 'Tài liệu';
    $('#viewerFrame').src = '/viewer.html?id=' + encodeURIComponent(fileId);
    $('#viewerModal').classList.remove('hidden');
  }

  /* ------------------------------ Tạo kênh ------------------------------ */
  $('#btnNewChannel').addEventListener('click', function () { $('#channelModal').classList.remove('hidden'); });
  $('#channelForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = {};
    new FormData(e.target).forEach(function (v, k) { body[k] = v; });
    state.socket.emit('channel:create', body, function (res) {
      if (res.error) return toast(res.error);
      e.target.reset();
      $('#channelModal').classList.add('hidden');
      state.socket.emit('conv:list', function (list) { state.conversations = list; openConv(res.conv.id); });
    });
  });

  /* ------------------------------ Cuộc gọi ------------------------------ */
  var timerHandle = null;

  function renderCallBanner() {
    var conv = state.activeConv;
    var call = conv ? state.activeCalls[conv.id] : null;
    var show = !!call && !(HahahaCall.isActive() && HahahaCall.convId === conv.id);
    $('#callBanner').classList.toggle('hidden', !show);
    if (show) {
      $('#callBannerText').textContent = '📞 Đang có cuộc gọi với ' +
        call.participants.map(function (p) { return p.name; }).join(', ');
    }
  }

  $('#btnJoinCall').addEventListener('click', function () {
    if (state.activeConv) startCall(state.activeConv.id, false);
  });
  $('#btnAudioCall').addEventListener('click', function () {
    if (state.activeConv) startCall(state.activeConv.id, false);
  });
  $('#btnVideoCall').addEventListener('click', function () {
    if (state.activeConv) startCall(state.activeConv.id, true);
  });

  function startCall(convId, video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return toast('Trình duyệt chặn micro/camera. Hãy mở app bằng địa chỉ https://…');
    }
    $('#videoGrid').innerHTML = '';
    HahahaCall.join(convId, video)
      .then(function () {
        $('#callOverlay').classList.remove('hidden');
        $('#callOverlay').classList.remove('mini');
        $('#btnCam').classList.toggle('off', !video);
        updateCallTitle();
        startTimer();
        renderCallBanner();
      })
      .catch(function (err) {
        toast('Không mở được micro/camera: ' + err.message);
      });
  }

  function updateCallTitle() {
    var conv = state.conversations.find(function (c) { return c.id === HahahaCall.convId; });
    var call = state.activeCalls[HahahaCall.convId];
    var n = call ? call.participants.length : 1;
    $('#callTitle').textContent = (conv ? (conv.type === 'channel' ? '# ' + conv.name : conv.name) : 'Cuộc gọi') + ' • ' + n + ' người';
  }

  function startTimer() {
    clearInterval(timerHandle);
    var t0 = Date.now();
    timerHandle = setInterval(function () {
      var s = Math.floor((Date.now() - t0) / 1000);
      $('#callTimer').textContent =
        String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 1000);
  }

  function tileFor(id, info, muted) {
    var el = document.getElementById('tile-' + id);
    if (el) return el;
    el = document.createElement('div');
    el.className = 'tile';
    el.id = 'tile-' + id;
    el.innerHTML =
      '<div class="tile-avatar"><div class="avatar big" style="background:' + esc(info.avatarColor || '#e11d3c') + '">' +
      esc(initials(info.name)) + '</div></div>' +
      '<video autoplay playsinline' + (muted ? ' muted' : '') + '></video>' +
      '<div class="tile-name">' + esc(info.name) + '</div>';
    el.querySelector('video').style.display = 'none';
    $('#videoGrid').appendChild(el);
    return el;
  }

  // Khi có hình thì ẩn avatar chữ cái, khi tắt camera thì hiện lại.
  function showTileVideo(el, show) {
    el.querySelector('video').style.display = show ? 'block' : 'none';
    el.querySelector('.tile-avatar').style.display = show ? 'none' : 'grid';
  }

  var callUI = {
    onLocalStream: function (stream) {
      var el = tileFor('self', { name: state.me.name + ' (bạn)', avatarColor: state.me.avatarColor }, true);
      el.querySelector('video').srcObject = stream;
      var tracks = stream.getVideoTracks();
      showTileVideo(el, tracks.length > 0 && tracks[0].enabled);
    },
    onPeerAdd: function (socketId, entry) {
      tileFor(socketId, { name: entry.name || 'Đồng nghiệp', avatarColor: entry.avatarColor }, false);
    },
    onPeerStream: function (socketId, stream) {
      var entry = HahahaCall.peers.get(socketId) || {};
      var el = tileFor(socketId, { name: entry.name || 'Đồng nghiệp', avatarColor: entry.avatarColor }, false);
      el.querySelector('video').srcObject = stream;
      var sync = function () { showTileVideo(el, stream.getVideoTracks().length > 0); };
      sync();
      stream.onaddtrack = sync;
      stream.onremovetrack = sync;
    },
    onPeerRemove: function (socketId) {
      var el = document.getElementById('tile-' + socketId);
      if (el) el.remove();
    },
    onScreenEnded: function () { $('#btnShare').classList.remove('off'); },
    onEnded: function () {
      clearInterval(timerHandle);
      $('#callOverlay').classList.add('hidden');
      $('#videoGrid').innerHTML = '';
      renderCallBanner();
    }
  };

  $('#btnMic').addEventListener('click', function () {
    var on = HahahaCall.toggleMic();
    $('#btnMic').classList.toggle('off', !on);
  });
  $('#btnCam').addEventListener('click', function () {
    Promise.resolve(HahahaCall.toggleCam())
      .then(function (on) {
        $('#btnCam').classList.toggle('off', !on);
        if (HahahaCall.localStream) callUI.onLocalStream(HahahaCall.localStream);
      })
      .catch(function () { toast('Không bật được camera'); });
  });
  $('#btnShare').addEventListener('click', function () {
    HahahaCall.shareScreen()
      .then(function (on) { $('#btnShare').classList.toggle('off', !on); })
      .catch(function () { toast('Không chia sẻ được màn hình'); });
  });
  $('#btnHangup').addEventListener('click', function () { HahahaCall.leave(); });
  $('#btnMinimizeCall').addEventListener('click', function () { $('#callOverlay').classList.toggle('mini'); });

  /* --------------------------- Chuông gọi đến --------------------------- */
  var ringAudio = null;
  function playRing() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var gain = ctx.createGain();
      gain.gain.value = 0.08;
      gain.connect(ctx.destination);
      var beep = function () {
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 620;
        osc.connect(gain);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      };
      beep();
      var iv = setInterval(beep, 1400);
      ringAudio = { stop: function () { clearInterval(iv); ctx.close(); } };
    } catch (e) { ringAudio = null; }
  }
  function stopRing() {
    if (ringAudio) { try { ringAudio.stop(); } catch (e) {} ringAudio = null; }
  }

  function showRing(p) {
    state.incoming = p;
    $('#ringAvatar').textContent = initials(p.from.name);
    $('#ringAvatar').style.background = p.from.avatarColor || '#e11d3c';
    $('#ringTitle').textContent = p.from.name + ' đang gọi';
    $('#ringSub').textContent = (p.video ? 'Cuộc gọi video' : 'Cuộc gọi thoại') +
      (p.type === 'channel' ? ' trong kênh # ' + p.convName : '');
    $('#ringModal').classList.remove('hidden');
    playRing();
  }
  function closeRing() {
    state.incoming = null;
    $('#ringModal').classList.add('hidden');
    stopRing();
  }
  $('#btnAccept').addEventListener('click', function () {
    var p = state.incoming;
    closeRing();
    if (p) { openConv(p.convId); startCall(p.convId, !!p.video); }
  });
  $('#btnDecline').addEventListener('click', function () {
    if (state.incoming) state.socket.emit('call:decline', { convId: state.incoming.convId });
    closeRing();
  });

  window.addEventListener('beforeunload', function () {
    if (HahahaCall.isActive()) HahahaCall.leave();
  });
})();
