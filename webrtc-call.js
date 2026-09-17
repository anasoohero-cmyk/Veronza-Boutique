// Minimal in-page audio calling over WebRTC, signaled through a Supabase Realtime
// broadcast channel keyed by conversation id. Only works while both sides have the
// chat open at the same time — there is no push-triggered ringing when the site/app
// is closed (that needs a native app + a paid telephony service).
(() => {
  const STUN_ONLY = [{ urls: 'stun:stun.l.google.com:19302' }];
  const CALL_TIMEOUT_MS = 30000;
  const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  // A TURN relay is what actually makes calls work reliably between two
  // mobile-network connections (STUN alone frequently can't punch through
  // carrier-grade NAT on both ends). Fetched once per page load and cached;
  // a fetch failure or missing server-side config just falls back to
  // STUN-only rather than breaking calling entirely.
  let iceServersPromise = null;
  function getIceServers() {
    if (!iceServersPromise) {
      iceServersPromise = fetch('/api/turn-credentials')
        .then((r) => r.json())
        .then((data) => STUN_ONLY.concat(Array.isArray(data?.iceServers) ? data.iceServers : []))
        .catch(() => STUN_ONLY);
    }
    return iceServersPromise;
  }

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
      this._connectTimeout = null;
      this._answered = false;
      this._connectedAt = null;
      this.onStateChange = null;
      this.onIncomingCall = null;
      this.onRemoteStream = null;
      this.onNoAnswer = null;
      this.onBusy = null;
      this.onRemoteEnd = null;
      this.onError = null;
      this.onConnectFailed = null;
      this.onCallEnded = null;

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
    async _ensurePc() {
      if (this.pc) return this.pc;
      const iceServers = await getIceServers();
      const pc = new RTCPeerConnection({ iceServers });
      pc.onicecandidate = (e) => {
        if (e.candidate) this._send({ type: 'ice', candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => this.onRemoteStream?.(e.streams[0]);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          clearTimeout(this._callTimeout);
          clearTimeout(this._connectTimeout);
          clearInterval(this._offerInterval);
          this._connectedAt = Date.now();
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
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
        const pc = await this._ensurePc();
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
        // Covers both "never answered" and "answered but the connection
        // itself never actually established" (e.g. both sides behind a
        // restrictive mobile-network NAT with no TURN relay to fall back
        // on) - _answered tells the UI which message applies.
        this._callTimeout = setTimeout(() => {
          if (this.state === 'calling') {
            this.endCall();
            if (this._answered) this.onConnectFailed?.();
            else this.onNoAnswer?.();
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
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
        const pc = await this._ensurePc();
        this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream));
        await pc.setRemoteDescription(this._pendingOfferSdp);
        await this._flushPendingIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this._send({ type: 'answer', sdp: answer });
        // The caller has its own no-answer timeout, but nothing protects
        // this side if signaling succeeds and the connection itself never
        // establishes - without this, the call bar would stay stuck on
        // "جاري الاتصال..." forever with no way out but manually hanging up.
        this._connectTimeout = setTimeout(() => {
          if (this.state === 'calling') {
            this.endCall();
            this.onConnectFailed?.();
          }
        }, CALL_TIMEOUT_MS);
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
      this._answered = true;
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

    _reportCallEnded() {
      if (this._connectedAt) {
        const durationSec = Math.round((Date.now() - this._connectedAt) / 1000);
        this.onCallEnded?.(durationSec);
      }
    }

    _handleRemoteEnd() {
      this._reportCallEnded();
      this._teardown();
      this._setState('ended');
      this.onRemoteEnd?.();
      setTimeout(() => this._setState('idle'), 0);
    }

    endCall() {
      if (this.state === 'idle') return;
      this._reportCallEnded();
      this._send({ type: 'end' });
      this._teardown();
      this._setState('idle');
    }

    setMuted(muted) {
      this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    }

    _teardown() {
      clearTimeout(this._callTimeout);
      clearTimeout(this._connectTimeout);
      clearInterval(this._offerInterval);
      clearTimeout(this._ringTimeout);
      this._pendingOfferSdp = null;
      this._pendingIceCandidates = [];
      this._answered = false;
      this._connectedAt = null;
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

  // Small dependency-free tone generator (Web Audio) so the call has audible
  // ringing/connection feedback without shipping an audio asset file.
  let audioCtx = null;
  function ensureAudioCtx() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return audioCtx;
    } catch (_) {
      return null;
    }
  }
  function beep(freq = 440, durationMs = 200, volume = 0.12, delayMs = 0) {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    setTimeout(() => {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value = volume;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + durationMs / 1000);
      } catch (_) {}
    }, delayMs);
  }
  function makeRinger() {
    let timer = null;
    const ringOnce = () => {
      beep(480, 350, 0.14, 0);
      beep(520, 350, 0.14, 420);
    };
    return {
      start() {
        if (timer) return;
        ringOnce();
        timer = setInterval(ringOnce, 2600);
      },
      stop() {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      },
    };
  }

  function mountCallUI(call, { calleeLabel = 'الطرف الآخر' } = {}) {
    if (!document.getElementById('vz-call-style')) {
      const style = document.createElement('style');
      style.id = 'vz-call-style';
      style.textContent = `
        .vz-call-bar{position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 92px);left:50%;transform:translateX(-50%) translateY(120%);display:flex;align-items:center;gap:14px;background:#111;color:#fff;padding:9px 10px 9px 18px;border-radius:99px;box-shadow:0 8px 24px #0004;z-index:400;font:600 13px/1 Cairo,sans-serif;transition:transform .25s;opacity:0}
        .vz-call-bar.show{transform:translateX(-50%) translateY(0);opacity:1}
        .vz-call-info{display:flex;align-items:center;gap:8px}
        .vz-call-lock{display:flex;color:#3ecf6e;flex-shrink:0}
        .vz-call-dot{width:8px;height:8px;border-radius:50%;background:#3ecf6e;flex-shrink:0;animation:vzCallPulse 1.2s infinite}
        @keyframes vzCallPulse{0%,100%{opacity:1}50%{opacity:.3}}
        .vz-call-status{white-space:nowrap;font-variant-numeric:tabular-nums}
        .vz-call-actions{display:flex;align-items:center;gap:8px}
        .vz-call-mute-btn{border:0;border-radius:50%;width:40px;height:40px;display:grid;place-items:center;background:#333;color:#fff;cursor:pointer;flex-shrink:0;transition:background .15s}
        .vz-call-mute-btn.muted{background:#c0392b}
        [data-call-end]{border:0;border-radius:99px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer;background:#c0392b;color:#fff;flex-shrink:0}
        .vz-call-incoming{position:fixed;inset:0;background:#0007;display:none;align-items:center;justify-content:center;z-index:410;padding:16px}
        .vz-call-incoming.show{display:flex}
        .vz-call-incoming-card{background:#fff;border-radius:18px;padding:24px 20px;max-width:320px;width:100%;text-align:center;box-shadow:0 12px 40px #0003}
        .vz-call-incoming-title{font:700 16px/1.5 Cairo,sans-serif;margin-bottom:18px}
        .vz-call-incoming-actions{display:flex;gap:12px;justify-content:center}
        .vz-call-incoming-actions button{flex:1;border:0;border-radius:12px;padding:12px;font:700 14px Cairo,sans-serif;cursor:pointer}
        .vz-call-incoming-actions [data-call-accept]{background:#111;color:#fff}
        .vz-call-incoming-actions [data-call-reject]{background:#f4f1ec;color:#111}
        .vz-call-toast{position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 150px);left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 18px;border-radius:10px;font:600 13px Cairo,sans-serif;z-index:420;box-shadow:0 6px 20px #0003;max-width:88vw;text-align:center}
      `;
      document.head.appendChild(style);
    }
    const bar = document.createElement('div');
    bar.className = 'vz-call-bar';
    bar.innerHTML =
      '<div class="vz-call-info">' +
      '<span class="vz-call-lock" title="مكالمة مشفرة"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>' +
      '<span class="vz-call-dot"></span>' +
      '<span class="vz-call-status" data-call-status></span>' +
      '</div>' +
      '<div class="vz-call-actions">' +
      '<button type="button" class="vz-call-mute-btn" data-call-mute aria-label="كتم الصوت">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/>' +
      '<path d="M19 11a7 7 0 0 1-14 0"/>' +
      '<line x1="12" y1="18" x2="12" y2="22"/>' +
      '<line data-mute-slash x1="4" y1="4" x2="20" y2="20" style="opacity:0;transition:opacity .12s"/>' +
      '</svg>' +
      '</button>' +
      '<button type="button" data-call-end>إنهاء</button>' +
      '</div>';
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
      setTimeout(() => t.remove(), 3500);
    }

    const ringer = makeRinger();
    let durationTimer = null;
    const statusEl = bar.querySelector('[data-call-status]');
    const fmtDuration = (secs) => {
      const mm = String(Math.floor(secs / 60)).padStart(2, '0');
      const ss = String(secs % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    };
    function startDurationDisplay() {
      stopDurationDisplay();
      const startedAt = Date.now();
      const tick = () => {
        statusEl.textContent = `مكالمة جارية · ${fmtDuration(Math.floor((Date.now() - startedAt) / 1000))}`;
      };
      tick();
      durationTimer = setInterval(tick, 1000);
    }
    function stopDurationDisplay() {
      if (durationTimer) {
        clearInterval(durationTimer);
        durationTimer = null;
      }
    }

    let muted = false;
    const muteBtn = bar.querySelector('[data-call-mute]');
    const muteSlash = muteBtn.querySelector('[data-mute-slash]');
    muteBtn.onclick = () => {
      muted = !muted;
      call.setMuted(muted);
      muteBtn.classList.toggle('muted', muted);
      muteSlash.style.opacity = muted ? '1' : '0';
      muteBtn.setAttribute('aria-label', muted ? 'إلغاء كتم الصوت' : 'كتم الصوت');
      beep(muted ? 300 : 640, 90, 0.1);
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
      if (state === 'calling' || state === 'ringing') {
        ringer.start();
      } else {
        ringer.stop();
      }
      if (state === 'connected') {
        startDurationDisplay();
      } else {
        stopDurationDisplay();
        statusEl.textContent = state === 'calling' ? 'جاري الاتصال...' : '';
      }
      if (state === 'idle') {
        muted = false;
        muteBtn.classList.remove('muted');
        muteSlash.style.opacity = '0';
      }
    };
    call.onNoAnswer = () => showToast('لا يوجد رد — الطرف الآخر غير متصل بالشات حالياً.');
    call.onBusy = () => showToast('الطرف الآخر مشغول بمكالمة أخرى.');
    call.onConnectFailed = () =>
      showToast('تعذر إكمال المكالمة — تأكد من قوة الاتصال بالإنترنت وحاول مرة أخرى.');
    call.onError = (e) => showToast('تعذر الوصول للمايكروفون: ' + (e?.message || ''));

    return {
      destroy() {
        ringer.stop();
        stopDurationDisplay();
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
