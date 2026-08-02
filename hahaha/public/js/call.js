/* Hahaha — lớp cuộc gọi WebRTC dạng lưới (mesh) chạy hoàn toàn trong LAN.
   Không dùng STUN/TURN ngoài Internet: các máy trong cùng mạng kết nối trực tiếp
   qua host candidate, nên không có gói dữ liệu nào ra ngoài công ty. */
(function (global) {
  'use strict';

  var RTC_CONFIG = { iceServers: [] };

  function CallManager() {
    this.socket = null;
    this.convId = null;
    this.localStream = null;
    this.screenStream = null;
    this.peers = new Map(); // socketId -> { pc, userId, name, avatarColor }
    this.micOn = true;
    this.camOn = false;
    this.startedAt = 0;
    this.ui = {};
  }

  CallManager.prototype.attach = function (socket, ui) {
    var self = this;
    this.socket = socket;
    this.ui = ui || {};

    socket.on('call:peer-joined', function (p) {
      if (!self.convId || p.convId !== self.convId) return;
      // Người mới sẽ chủ động gửi offer; bên này chỉ chuẩn bị chỗ hiển thị.
      self._ensurePeer(p.socketId, p, false);
    });

    socket.on('call:signal', function (msg) {
      self._onSignal(msg);
    });

    socket.on('call:peer-left', function (p) {
      if (!self.convId || p.convId !== self.convId) return;
      self._removePeer(p.socketId);
    });
  };

  CallManager.prototype.isActive = function () {
    return !!this.convId;
  };

  CallManager.prototype.join = function (convId, withVideo) {
    var self = this;
    if (this.convId) this.leave();
    return navigator.mediaDevices
      .getUserMedia({ audio: true, video: !!withVideo })
      .then(function (stream) {
        self.localStream = stream;
        self.micOn = true;
        self.camOn = !!withVideo;
        self.convId = convId;
        self.startedAt = Date.now();
        if (self.ui.onLocalStream) self.ui.onLocalStream(stream);

        return new Promise(function (resolve, reject) {
          self.socket.emit('call:join', { convId: convId, video: !!withVideo }, function (res) {
            if (!res || res.error) {
              self.leave();
              return reject(new Error((res && res.error) || 'Không tham gia được cuộc gọi'));
            }
            // Bên vào sau đóng vai người gửi offer tới từng người đang có mặt.
            res.peers.forEach(function (p) {
              self._ensurePeer(p.socketId, p, true);
            });
            resolve(res);
          });
        });
      })
      .catch(function (err) {
        self.convId = null;
        throw err;
      });
  };

  CallManager.prototype._ensurePeer = function (socketId, info, initiator) {
    var self = this;
    if (this.peers.has(socketId)) return this.peers.get(socketId);

    var pc = new RTCPeerConnection(RTC_CONFIG);
    var entry = { pc: pc, userId: info.userId, name: info.name, avatarColor: info.avatarColor, pending: [] };
    this.peers.set(socketId, entry);
    if (this.ui.onPeerAdd) this.ui.onPeerAdd(socketId, entry);

    if (this.localStream) {
      this.localStream.getTracks().forEach(function (t) {
        pc.addTrack(t, self.localStream);
      });
    }

    pc.onicecandidate = function (e) {
      if (e.candidate) self.socket.emit('call:signal', { to: socketId, data: { candidate: e.candidate } });
    };
    pc.ontrack = function (e) {
      if (self.ui.onPeerStream) self.ui.onPeerStream(socketId, e.streams[0]);
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') self._removePeer(socketId);
    };

    if (initiator) {
      pc.createOffer()
        .then(function (offer) {
          return pc.setLocalDescription(offer);
        })
        .then(function () {
          self.socket.emit('call:signal', { to: socketId, data: { sdp: pc.localDescription } });
        })
        .catch(function () {});
    }
    return entry;
  };

  CallManager.prototype._onSignal = function (msg) {
    var self = this;
    if (!this.convId) return;
    var entry = this.peers.get(msg.from);
    if (!entry) {
      entry = this._ensurePeer(msg.from, { userId: msg.fromUserId, name: 'Đồng nghiệp' }, false);
    }
    var pc = entry.pc;
    var data = msg.data || {};

    if (data.sdp) {
      pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .then(function () {
          entry.pending.splice(0).forEach(function (c) {
            pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {});
          });
          if (data.sdp.type === 'offer') {
            return pc
              .createAnswer()
              .then(function (answer) {
                return pc.setLocalDescription(answer);
              })
              .then(function () {
                self.socket.emit('call:signal', { to: msg.from, data: { sdp: pc.localDescription } });
              });
          }
        })
        .catch(function () {});
    } else if (data.candidate) {
      if (pc.remoteDescription && pc.remoteDescription.type) {
        pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function () {});
      } else {
        entry.pending.push(data.candidate);
      }
    }
  };

  CallManager.prototype._removePeer = function (socketId) {
    var entry = this.peers.get(socketId);
    if (!entry) return;
    try {
      entry.pc.close();
    } catch (e) {}
    this.peers.delete(socketId);
    if (this.ui.onPeerRemove) this.ui.onPeerRemove(socketId);
  };

  CallManager.prototype.toggleMic = function () {
    if (!this.localStream) return this.micOn;
    this.micOn = !this.micOn;
    this.localStream.getAudioTracks().forEach(function (t) {
      t.enabled = this.micOn;
    }, this);
    this._reportMedia();
    return this.micOn;
  };

  CallManager.prototype.toggleCam = function () {
    var self = this;
    if (!this.localStream) return Promise.resolve(false);
    var track = this.localStream.getVideoTracks()[0];
    if (track) {
      this.camOn = !this.camOn;
      track.enabled = this.camOn;
      this._reportMedia();
      return Promise.resolve(this.camOn);
    }
    // Chưa có camera trong luồng (bắt đầu bằng cuộc gọi thoại) -> bật thêm.
    return navigator.mediaDevices.getUserMedia({ video: true }).then(function (stream) {
      var vt = stream.getVideoTracks()[0];
      self.localStream.addTrack(vt);
      self.peers.forEach(function (entry) {
        entry.pc.addTrack(vt, self.localStream);
        self._renegotiate(entry);
      });
      self.camOn = true;
      if (self.ui.onLocalStream) self.ui.onLocalStream(self.localStream);
      self._reportMedia();
      return true;
    });
  };

  CallManager.prototype.shareScreen = function () {
    var self = this;
    if (this.screenStream) {
      this._stopScreen();
      return Promise.resolve(false);
    }
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
      self.screenStream = stream;
      var track = stream.getVideoTracks()[0];
      self._replaceVideoTrack(track);
      track.onended = function () {
        self._stopScreen();
      };
      if (self.ui.onLocalStream) self.ui.onLocalStream(new MediaStream([track]));
      return true;
    });
  };

  CallManager.prototype._stopScreen = function () {
    var self = this;
    if (!this.screenStream) return;
    this.screenStream.getTracks().forEach(function (t) {
      t.stop();
    });
    this.screenStream = null;
    var camTrack = this.localStream ? this.localStream.getVideoTracks()[0] : null;
    this._replaceVideoTrack(camTrack || null);
    if (this.ui.onLocalStream && this.localStream) this.ui.onLocalStream(this.localStream);
    if (this.ui.onScreenEnded) this.ui.onScreenEnded();
  };

  CallManager.prototype._replaceVideoTrack = function (track) {
    this.peers.forEach(function (entry) {
      entry.pc.getSenders().forEach(function (sender) {
        if (sender.track && sender.track.kind === 'video') sender.replaceTrack(track);
      });
    });
  };

  CallManager.prototype._renegotiate = function (entry) {
    var self = this;
    entry.pc
      .createOffer()
      .then(function (offer) {
        return entry.pc.setLocalDescription(offer);
      })
      .then(function () {
        var socketId = null;
        self.peers.forEach(function (v, k) {
          if (v === entry) socketId = k;
        });
        if (socketId) self.socket.emit('call:signal', { to: socketId, data: { sdp: entry.pc.localDescription } });
      })
      .catch(function () {});
  };

  CallManager.prototype._reportMedia = function () {
    if (this.convId) this.socket.emit('call:media', { convId: this.convId, video: this.camOn, muted: !this.micOn });
  };

  CallManager.prototype.leave = function () {
    var convId = this.convId;
    this.peers.forEach(function (entry) {
      try {
        entry.pc.close();
      } catch (e) {}
    });
    this.peers.clear();
    if (this.localStream) {
      this.localStream.getTracks().forEach(function (t) {
        t.stop();
      });
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(function (t) {
        t.stop();
      });
    }
    this.localStream = null;
    this.screenStream = null;
    this.convId = null;
    if (convId && this.socket) this.socket.emit('call:leave', { convId: convId });
    if (this.ui.onEnded) this.ui.onEnded(convId);
  };

  global.HahahaCall = new CallManager();
})(window);
