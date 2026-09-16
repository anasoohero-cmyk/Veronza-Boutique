// Minimal in-page audio calling over WebRTC, signaled through a Supabase Realtime
// broadcast channel keyed by conversation id. Only works while both sides have the
// chat open at the same time — there is no push-triggered ringing when the site/app
// is closed (that needs a native app + a paid telephony service).
(() => {
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
  const CALL_TIMEOUT_MS = 30000;

  class VeronzaCall {
    constructor(supabaseClient, conversationId) {
      this.sb = supabaseClient;
      this.conversationId = conversationId;
      this.pc = null;
      this.localStream = null;
      this.state = 'idle'; // idle | calling | ringing | connected | ended
      this._pendingOfferSdp = null;
      this._pendingIceCandidates = [];
      this._callTimeout = null;
      this._offerInterval = null;
      this._ringTimeout = null;
      this.onStateChange = null;
      this.onIncomingCall = null;
      this.onRemoteStream = null;
      this.onNoAnswer = null;
      this.onBusy = null;
      this.onRemoteEnd = null;
      this.onError = null;

      this.channel = this.sb.channel(`vz-call-${conversationId}`, {
        config: { broadcast: { self: false } },
      });
      this.channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
        if (!payload || !payload.type) return;
        if (payload.type === 'offer') this._handleOffer(payload);
        else if (payload.type === 'answer') this._handleAnswer(payload);
        else if (payload.type === 'ice') this._handleIce(payload);
        else if (payload.type === 'end') this._handleRemoteEnd();
        else if (payload.type === 'busy') this.onBusy?.();
      });
      this.channel.subscribe();
    }

    _send(payload) {
      this.channel.send({ type: 'broadcast', event: 'signal', payload });
    }
    _setState(s) {
      this.state = s;
      this.onStateChange?.(s);
    }
    _ensurePc() {
      if (this.pc) return this.pc;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pc.onicecandidate = (e) => {
        if (e.candidate) this._send({ type: 'ice', candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => this.onRemoteStream?.(e.streams[0]);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          clearTimeout(this._callTimeout);
          clearInterval(this._offerInterval);
          this._setState('connected');
        } else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          if (this.state !== 'idle' && this.state !== 'ended') this._handleRemoteEnd();
        }
      };
      this.pc = pc;
      return pc;
    }

    async startCall() {
      if (this.state !== 'idle') return;
      try {
        this._setState('calling');
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const pc = this._ensurePc();
        this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this._send({ type: 'offer', sdp: offer });
        // Re-send the same offer every few seconds while ringing — the other
        // side may open/focus the app a little after the first broadcast (e.g.
        // tapping a push notification), and broadcast messages aren't queued
        // for a client that wasn't yet subscribed when the first one went out.
        this._offerInterval = setInterval(() => {
          if (this.state === 'calling') this._send({ type: 'offer', sdp: offer });
        }, 3000);
        this._callTimeout = setTimeout(() => {
          if (this.state === 'calling') {
            this.endCall();
            this.onNoAnswer?.();
          }
        }, CALL_TIMEOUT_MS);
      } catch (e) {
        this._teardown();
        this._setState('idle');
        this.onError?.(e);
      }
    }

    _handleOffer(payload) {
      if (this.state === 'ringing') {
        // The caller re-announcing the same call while we're still deciding —
        // not a second, different call, so just refresh the pending offer.
        this._pendingOfferSdp = payload.sdp;
        return;
      }
      if (this.state !== 'idle') {
        this._send({ type: 'busy' });
        return;
      }
      this._pendingOfferSdp = payload.sdp;
      this._setState('ringing');
      // Guards against a stuck "ringing" UI if this side never acts on it
      // (e.g. the same admin has a second tab open and answers there instead).
      clearTimeout(this._ringTimeout);
      this._ringTimeout = setTimeout(() => {
        if (this.state === 'ringing') this.rejectCall();
      }, CALL_TIMEOUT_MS + 5000);
      this.onIncomingCall?.();
    }

    async acceptCall() {
      if (this.state !== 'ringing' || !this._pendingOfferSdp) return;
      clearTimeout(this._ringTimeout);
      try {
        this._setState('calling');
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const pc = this._ensurePc();
        this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream));
        await pc.setRemoteDescription(this._pendingOfferSdp);
        await this._flushPendingIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this._send({ type: 'answer', sdp: answer });
      } catch (e) {
        this.rejectCall();
        this.onError?.(e);
      }
    }

    rejectCall() {
      this._send({ type: 'end' });
      this._teardown();
      this._setState('idle');
    }

    async _handleAnswer(payload) {
      clearTimeout(this._callTimeout);
      clearInterval(this._offerInterval);
      if (!this.pc) return;
      try {
        await this.pc.setRemoteDescription(payload.sdp);
        await this._flushPendingIce();
      } catch (e) {
        this.onError?.(e);
      }
    }

    async _handleIce(payload) {
      // A candidate can arrive before we even have a pc (still ringing) or
      // before its remote description is set — queue it instead of dropping
      // it, since the caller only sends each candidate once.
      if (!this.pc || !this.pc.remoteDescription || !this.pc.remoteDescription.type) {
        this._pendingIceCandidates.push(payload.candidate);
        return;
      }
      try {
        await this.pc.addIceCandidate(payload.candidate);
      } catch (_) {
        // benign — a late-arriving candidate for a connection already torn down
      }
    }

    async _flushPendingIce() {
      const queued = this._pendingIceCandidates;
      this._pendingIceCandidates = [];
      for (const candidate of queued) {
        try {
          await this.pc.addIceCandidate(candidate);
        } catch (_) {}
      }
    }

    _handleRemoteEnd() {
      this._teardown();
      this._setState('ended');
      this.onRemoteEnd?.();
      setTimeout(() => this._setState('idle'), 0);
    }

    endCall() {
      if (this.state === 'idle') return;
      this._send({ type: 'end' });
      this._teardown();
      this._setState('idle');
    }

    setMuted(muted) {
      this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    }

    _teardown() {
      clearTimeout(this._callTimeout);
      clearInterval(this._offerInterval);
      clearTimeout(this._ringTimeout);
      this._pendingOfferSdp = null;
      this._pendingIceCandidates = [];
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      if (this.pc) {
        // Detach handlers before closing — otherwise a delayed
        // connectionstatechange from this now-closed connection could fire
        // after a new call has already started and wrongly tear it down.
        this.pc.onconnectionstatechange = null;
        this.pc.onicecandidate = null;
        this.pc.ontrack = null;
        this.pc.close();
      }
      this.pc = null;
    }

    destroy() {
      this._teardown();
      this.sb.removeChannel(this.channel);
    }
  }

  const esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
    );

  function mountCallUI(call, { calleeLabel = 'الطرف الآخر' } = {}) {
    if (!document.getElementById('vz-call-style')) {
      const style = document.createElement('style');
      style.id = 'vz-call-style';
      style.textContent = `
        .vz-call-bar{position:fixed;bottom:16px;left:50%;transform:translateX(-50%) translateY(120%);display:flex;align-items:center;gap:14px;background:#111;color:#fff;padding:10px 16px;border-radius:99px;box-shadow:0 8px 24px #0004;z-index:400;font:600 13px/1 Cairo,sans-serif;transition:transform .25s;opacity:0}
        .vz-call-bar.show{transform:translateX(-50%) translateY(0);opacity:1}
        .vz-call-info{display:flex;align-items:center;gap:8px}
        .vz-call-dot{width:8px;height:8px;border-radius:50%;background:#3ecf6e;animation:vzCallPulse 1.2s infinite}
        @keyframes vzCallPulse{0%,100%{opacity:1}50%{opacity:.3}}
        .vz-call-actions{display:flex;gap:8px}
        .vz-call-actions button{border:0;border-radius:99px;padding:7px 13px;font:inherit;font-weight:700;cursor:pointer}
        .vz-call-actions [data-call-mute]{background:#333;color:#fff}
        .vz-call-actions [data-call-end]{background:#c0392b;color:#fff}
        .vz-call-incoming{position:fixed;inset:0;background:#0007;display:none;align-items:center;justify-content:center;z-index:410;padding:16px}
        .vz-call-incoming.show{display:flex}
        .vz-call-incoming-card{background:#fff;border-radius:18px;padding:24px 20px;max-width:320px;width:100%;text-align:center;box-shadow:0 12px 40px #0003}
        .vz-call-incoming-title{font:700 16px/1.5 Cairo,sans-serif;margin-bottom:18px}
        .vz-call-incoming-actions{display:flex;gap:12px;justify-content:center}
        .vz-call-incoming-actions button{flex:1;border:0;border-radius:12px;padding:12px;font:700 14px Cairo,sans-serif;cursor:pointer}
        .vz-call-incoming-actions [data-call-accept]{background:#111;color:#fff}
        .vz-call-incoming-actions [data-call-reject]{background:#f4f1ec;color:#111}
        .vz-call-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 18px;border-radius:10px;font:600 13px Cairo,sans-serif;z-index:420;box-shadow:0 6px 20px #0003}
      `;
      document.head.appendChild(style);
    }
    const bar = document.createElement('div');
    bar.className = 'vz-call-bar';
    bar.innerHTML =
      '<div class="vz-call-info"><span class="vz-call-dot"></span><span data-call-status></span></div><div class="vz-call-actions"><button type="button" data-call-mute>🔇</button><button type="button" data-call-end>إنهاء</button></div>';
    const incoming = document.createElement('div');
    incoming.className = 'vz-call-incoming';
    incoming.innerHTML = `<div class="vz-call-incoming-card"><div class="vz-call-incoming-title">مكالمة واردة من ${esc(calleeLabel)}</div><div class="vz-call-incoming-actions"><button type="button" data-call-accept>قبول</button><button type="button" data-call-reject>رفض</button></div></div>`;
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.setAttribute('playsinline', '');
    document.body.append(bar, incoming, audioEl);

    function showToast(msg) {
      const t = document.createElement('div');
      t.className = 'vz-call-toast';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3000);
    }

    let muted = false;
    const muteBtn = bar.querySelector('[data-call-mute]');
    muteBtn.onclick = () => {
      muted = !muted;
      call.setMuted(muted);
      muteBtn.textContent = muted ? '🔈' : '🔇';
    };
    bar.querySelector('[data-call-end]').onclick = () => call.endCall();
    incoming.querySelector('[data-call-accept]').onclick = () => call.acceptCall();
    incoming.querySelector('[data-call-reject]').onclick = () => call.rejectCall();

    call.onRemoteStream = (stream) => {
      audioEl.srcObject = stream;
    };
    call.onIncomingCall = () => incoming.classList.add('show');
    call.onStateChange = (state) => {
      incoming.classList.toggle('show', state === 'ringing');
      bar.classList.toggle('show', state === 'calling' || state === 'connected');
      bar.querySelector('[data-call-status]').textContent =
        state === 'calling' ? 'جاري الاتصال...' : state === 'connected' ? 'مكالمة جارية' : '';
      if (state === 'idle') {
        muted = false;
        muteBtn.textContent = '🔇';
      }
    };
    call.onNoAnswer = () => showToast('لا يوجد رد — الطرف الآخر غير متصل بالشات حالياً.');
    call.onBusy = () => showToast('الطرف الآخر مشغول بمكالمة أخرى.');
    call.onError = (e) => showToast('تعذر الوصول للمايكروفون: ' + (e?.message || ''));

    return {
      destroy() {
        bar.remove();
        incoming.remove();
        audioEl.remove();
      },
    };
  }

  function showCallChoice({ phone, onInSite }) {
    if (!document.getElementById('vz-callchoice-style')) {
      const style = document.createElement('style');
      style.id = 'vz-callchoice-style';
      style.textContent = `
        .vz-callchoice-overlay{position:fixed;inset:0;background:#0007;display:flex;align-items:center;justify-content:center;z-index:430;padding:16px}
        .vz-callchoice-card{background:#fff;border-radius:18px;padding:20px;max-width:320px;width:100%;text-align:center;box-shadow:0 12px 40px #0003}
        .vz-callchoice-title{font:700 16px/1.5 Cairo,sans-serif;margin-bottom:16px}
        .vz-callchoice-card button{display:block;width:100%;border:0;border-radius:12px;padding:13px;font:700 14px Cairo,sans-serif;cursor:pointer;margin-bottom:10px}
        .vz-callchoice-card [data-choice-insite]{background:#111;color:#fff}
        .vz-callchoice-card [data-choice-phone]{background:#f4f1ec;color:#111}
        .vz-callchoice-card [data-choice-cancel]{background:none;color:#888;margin-bottom:0;padding:6px}
      `;
      document.head.appendChild(style);
    }
    const overlay = document.createElement('div');
    overlay.className = 'vz-callchoice-overlay';
    overlay.innerHTML = `<div class="vz-callchoice-card"><div class="vz-callchoice-title">كيف تحب تتواصل معنا؟</div><button type="button" data-choice-insite>📞 مكالمة داخل الموقع</button><button type="button" data-choice-phone>☎️ اتصال بالرقم ${esc(phone)}</button><button type="button" data-choice-cancel>إلغاء</button></div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('[data-choice-insite]').onclick = () => {
      close();
      onInSite?.();
    };
    overlay.querySelector('[data-choice-phone]').onclick = () => {
      close();
      window.location.href = 'tel:' + phone;
    };
    overlay.querySelector('[data-choice-cancel]').onclick = close;
  }

  window.VeronzaCall = VeronzaCall;
  window.VeronzaCall.mountUI = mountCallUI;
  window.VeronzaCall.showChoice = showCallChoice;
})();
