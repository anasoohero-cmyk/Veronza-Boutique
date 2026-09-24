// Minimal in-page audio calling over WebRTC, signaled through a Supabase Realtime
// broadcast channel keyed by conversation id. Only works while both sides have the
// chat open at the same time — there is no push-triggered ringing when the site/app
// is closed (that needs a native app + a paid telephony service).
(() => {
  const STUN_ONLY = [{ urls: 'stun:stun.l.google.com:19302' }];
  // The caller keeps re-broadcasting its offer every 3s for this whole
  // window, so any side that subscribes late still catches it. 30s wasn't
  // realistic for the admin's actual path: receive the push notification,
  // tap it, cold-launch/open the admin app, sign-in check, load
  // admin-chat.html, then deep-link into the right conversation - by the
  // time all that finished the call had frequently already timed out with
  // nothing to answer, exactly as reported live.
  const CALL_TIMEOUT_MS = 60000;
  const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  // A TURN relay is what actually makes calls work reliably between two
  // mobile-network connections (STUN alone frequently can't punch through
  // carrier-grade NAT on both ends). Fetched once per page load and cached;
  // a fetch failure or missing server-side config just falls back to
  // STUN-only rather than breaking calling entirely.
  let iceServersPromise = null;
  function getIceServers() {
    if (!iceServersPromise) {
      iceServersPromise = fetch('/api/calls')
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
      this._qualityInterval = null;
      this._qualityLastStats = null;
      this.onStateChange = null;
      this.onIncomingCall = null;
      this.onRemoteStream = null;
      this.onNoAnswer = null;
      this.onBusy = null;
      this.onRemoteEnd = null;
      this.onError = null;
      this.onConnectFailed = null;
      this.onCallEnded = null;
      this.onQualityChange = null;

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
      // Temporary diagnostic (kept on the instance, read by mountUI's debug
      // line): lastIceServerCount tells us whether /api/calls actually
      // returned a TURN server at all (1 = STUN-only fallback, the Metered
      // fetch failed or returned nothing); gatheredCandidateTypes tells us
      // whether a TURN relay candidate was ever actually usable even when
      // one was configured - "relay" missing there despite a TURN server
      // being present points at the credentials/account, not the code.
      this.lastIceServerCount = iceServers.length;
      this.gatheredCandidateTypes = new Set();
      const pc = new RTCPeerConnection({ iceServers });
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          this._send({ type: 'ice', candidate: e.candidate.toJSON() });
          const type = e.candidate.type || /typ (\w+)/.exec(e.candidate.candidate || '')?.[1];
          if (type) this.gatheredCandidateTypes.add(type);
        }
      };
      pc.ontrack = (e) => this.onRemoteStream?.(e.streams[0]);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          clearTimeout(this._callTimeout);
          clearTimeout(this._connectTimeout);
          clearInterval(this._offerInterval);
          this._connectedAt = Date.now();
          this._setState('connected');
          this._startQualityMonitor();
        } else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          if (this.state !== 'idle' && this.state !== 'ended') this._handleRemoteEnd();
        }
      };
      this.pc = pc;
      return pc;
    }

    // Polls the real, live connection stats (packet loss, jitter, round
    // trip time) so the UI can show a signal indicator that actually
    // reflects the call's network quality, not a decorative animation.
    _startQualityMonitor() {
      this._stopQualityMonitor();
      this._qualityInterval = setInterval(async () => {
        if (!this.pc || this.state !== 'connected') return;
        try {
          const stats = await this.pc.getStats();
          let inbound = null,
            candidatePair = null;
          stats.forEach((report) => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') inbound = report;
            if (report.type === 'candidate-pair' && report.state === 'succeeded')
              candidatePair = report;
          });
          if (!inbound) return;
          const now = {
            packetsLost: inbound.packetsLost || 0,
            packetsReceived: inbound.packetsReceived || 0,
            jitter: inbound.jitter || 0,
          };
          if (this._qualityLastStats) {
            const dLost = Math.max(0, now.packetsLost - this._qualityLastStats.packetsLost);
            const dRecv = Math.max(0, now.packetsReceived - this._qualityLastStats.packetsReceived);
            const total = dLost + dRecv;
            const lossRatio = total > 0 ? dLost / total : 0;
            const rtt = candidatePair?.currentRoundTripTime ?? 0;
            let level = 'good';
            if (lossRatio > 0.08 || rtt > 0.6 || now.jitter > 0.1) level = 'poor';
            else if (lossRatio > 0.02 || rtt > 0.3 || now.jitter > 0.05) level = 'fair';
            this.onQualityChange?.(level);
          }
          this._qualityLastStats = now;
        } catch (_) {}
      }, 3000);
    }
    _stopQualityMonitor() {
      clearInterval(this._qualityInterval);
      this._qualityInterval = null;
      this._qualityLastStats = null;
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
        // The caller re-broadcasts the same offer every few seconds until it
        // sees an answer (in case we weren't subscribed yet). A resend of the
        // call we already accepted isn't a second, different call — treating
        // it as one wrongly told the caller we were busy while we were still
        // in the middle of connecting to them.
        if (this._pendingOfferSdp?.sdp && payload.sdp?.sdp === this._pendingOfferSdp.sdp) return;
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

    _teardown() {
      clearTimeout(this._callTimeout);
      clearTimeout(this._connectTimeout);
      clearInterval(this._offerInterval);
      clearTimeout(this._ringTimeout);
      this._stopQualityMonitor();
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

  function mountCallUI(call, { calleeLabel = 'الطرف الآخر', onMissedCall = null } = {}) {
    if (!document.getElementById('vz-call-style')) {
      const style = document.createElement('style');
      style.id = 'vz-call-style';
      style.textContent = `
        .vz-call-window{position:fixed;inset:0;background:linear-gradient(165deg,#1c1c1c 0%,#0a0a0a 100%);color:#fff;z-index:400;display:none;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;font-family:Cairo,Arial,sans-serif;padding:calc(env(safe-area-inset-top,0px) + 36px) 24px calc(env(safe-area-inset-bottom,0px) + 44px)}
        .vz-call-window.show{display:flex}
        .vz-call-lock-row{display:flex;align-items:center;gap:6px;color:#3ecf6e;font-size:13px;font-weight:700}
        .vz-call-mid{display:flex;flex-direction:column;align-items:center;gap:18px}
        .vz-call-avatar{width:104px;height:104px;border-radius:50%;background:linear-gradient(160deg,#c9a15c,#8f6c2c);display:flex;align-items:center;justify-content:center;font:700 40px 'Playfair Display',serif;box-shadow:0 10px 34px rgba(0,0,0,.45)}
        .vz-call-name{font:700 23px/1.4 Cairo,sans-serif}
        .vz-call-status{font-size:15px;color:#cfc8b9;font-variant-numeric:tabular-nums;display:flex;align-items:center;justify-content:center;gap:7px}
        .vz-call-dot{width:8px;height:8px;border-radius:50%;background:#3ecf6e;flex-shrink:0;animation:vzCallPulse 1.2s infinite}
        .vz-call-signal{display:flex;align-items:flex-end;gap:3px;height:13px;margin-inline-start:2px}
        .vz-call-signal .bar{width:3.5px;background:#4a4a4a;border-radius:2px;transition:background .3s}
        .vz-call-signal .bar.b1{height:5px}
        .vz-call-signal .bar.b2{height:9px}
        .vz-call-signal .bar.b3{height:13px}
        .vz-call-signal.good .bar{background:#3ecf6e}
        .vz-call-signal.fair .bar.b1,.vz-call-signal.fair .bar.b2{background:#e0a92b}
        .vz-call-signal.poor .bar.b1{background:#e0392b}
        @keyframes vzCallPulse{0%,100%{opacity:1}50%{opacity:.3}}
        .vz-call-controls{display:flex;align-items:center;justify-content:center;gap:34px}
        .vz-call-speaker-btn{border:0;width:60px;height:60px;border-radius:50%;background:#2b2b2b;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s;flex-shrink:0}
        .vz-call-speaker-btn.active{background:#b58a3b}
        .vz-call-speaker-label{display:block;font-size:11px;color:#a89f8e;margin-top:8px}
        .vz-call-end-btn{border:0;width:66px;height:66px;border-radius:50%;background:#e0392b;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 10px 26px rgba(224,57,43,.45);flex-shrink:0}
        .vz-call-incoming{position:fixed;inset:0;background:#0007;display:none;align-items:center;justify-content:center;z-index:410;padding:16px}
        .vz-call-incoming.show{display:flex}
        .vz-call-incoming-card{background:#fff;border-radius:18px;padding:24px 20px;max-width:320px;width:100%;text-align:center;box-shadow:0 12px 40px #0003}
        .vz-call-incoming-title{font:700 16px/1.5 Cairo,sans-serif;margin-bottom:18px}
        .vz-call-incoming-actions{display:flex;gap:12px;justify-content:center}
        .vz-call-incoming-actions button{flex:1;border:0;border-radius:12px;padding:12px;font:700 14px Cairo,sans-serif;cursor:pointer}
        .vz-call-incoming-actions [data-call-accept]{background:#111;color:#fff}
        .vz-call-incoming-actions [data-call-reject]{background:#f4f1ec;color:#111}
        .vz-call-toast{position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 40px);left:50%;transform:translateX(-50%);background:#fff;color:#111;padding:10px 18px;border-radius:10px;font:600 13px Cairo,sans-serif;z-index:420;box-shadow:0 6px 20px #0004;max-width:88vw;text-align:center}
        .vz-call-debug{font-size:11px;color:#8a8a8a;margin-top:6px;font-family:monospace,Cairo}
      `;
      document.head.appendChild(style);
    }
    const win = document.createElement('div');
    win.className = 'vz-call-window';
    win.innerHTML =
      '<div class="vz-call-lock-row" title="مكالمة مشفرة">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
      '<span>مكالمة مشفرة</span>' +
      '</div>' +
      '<div class="vz-call-debug" data-call-debug></div>' +
      '<div class="vz-call-mid">' +
      `<div class="vz-call-avatar">${esc((calleeLabel || '؟').trim().charAt(0))}</div>` +
      `<div class="vz-call-name">${esc(calleeLabel)}</div>` +
      '<div class="vz-call-status"><span class="vz-call-dot"></span><span data-call-status></span>' +
      '<span class="vz-call-signal good" data-call-signal title="جودة الاتصال"><span class="bar b1"></span><span class="bar b2"></span><span class="bar b3"></span></span>' +
      '</div>' +
      '</div>' +
      '<div>' +
      '<div class="vz-call-controls">' +
      '<div>' +
      '<button type="button" class="vz-call-speaker-btn active" data-call-speaker aria-label="السماعة الخارجية">' +
      '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19.5 5.5a9 9 0 0 1 0 13"/></svg>' +
      '</button>' +
      '<span class="vz-call-speaker-label">السماعة الخارجية</span>' +
      '</div>' +
      '<button type="button" class="vz-call-end-btn" data-call-end aria-label="إنهاء المكالمة">' +
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" style="transform:rotate(135deg)"><path d="M20.6 15.2l-3.5-1.2c-.4-.1-.9 0-1.2.3l-1.6 1.6c-2.1-1.1-3.8-2.8-4.9-4.9l1.6-1.6c.3-.3.4-.8.3-1.2L9.9 4.7c-.2-.6-.8-1-1.5-.9L5.3 4.3c-.7.1-1.2.7-1.1 1.4C5 13.8 10.9 19.7 19 20.9c.7.1 1.3-.4 1.4-1.1l.5-3.1c.1-.7-.3-1.3-.9-1.5z"/></svg>' +
      '</button>' +
      '</div>' +
      '</div>';
    const incoming = document.createElement('div');
    incoming.className = 'vz-call-incoming';
    incoming.innerHTML = `<div class="vz-call-incoming-card"><div class="vz-call-incoming-title">مكالمة واردة من ${esc(calleeLabel)}</div><div class="vz-call-incoming-actions"><button type="button" data-call-accept>قبول</button><button type="button" data-call-reject>رفض</button></div></div>`;
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.volume = 1;
    audioEl.setAttribute('playsinline', '');
    document.body.append(win, incoming, audioEl);

    function showToast(msg) {
      const t = document.createElement('div');
      t.className = 'vz-call-toast';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3500);
    }

    const ringer = makeRinger();
    let durationTimer = null;
    const statusEl = win.querySelector('[data-call-status]');
    const fmtDuration = (secs) => {
      const mm = String(Math.floor(secs / 60)).padStart(2, '0');
      const ss = String(secs % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    };
    function startDurationDisplay() {
      stopDurationDisplay();
      const startedAt = Date.now();
      const tick = () => {
        statusEl.textContent = fmtDuration(Math.floor((Date.now() - startedAt) / 1000));
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

    // Temporary diagnostic line - see the comment on lastIceServerCount /
    // gatheredCandidateTypes in _ensurePc(). Left visible (not cleared) once
    // a call ends, so it can be read off the screen or screenshotted.
    const debugEl = win.querySelector('[data-call-debug]');
    let debugTimer = null;
    function updateDebugLine() {
      if (!call.pc) return;
      const servers = call.lastIceServerCount;
      const types = call.gatheredCandidateTypes ? Array.from(call.gatheredCandidateTypes) : [];
      const relay = types.includes('relay') ? 'نعم' : 'لا';
      debugEl.textContent = `TURN servers: ${servers ?? '؟'} — relay candidate: ${relay} — ICE: ${call.pc.iceConnectionState}`;
    }
    function startDebugUpdates() {
      stopDebugUpdates();
      updateDebugLine();
      debugTimer = setInterval(updateDebugLine, 1000);
    }
    function stopDebugUpdates() {
      if (debugTimer) {
        clearInterval(debugTimer);
        debugTimer = null;
      }
      updateDebugLine();
    }

    // Best-effort earpiece/loudspeaker switch. Most mobile browsers already
    // play call audio through the main (loud) speaker by default - there is
    // no reliable, universal web API to force the private earpiece the way
    // a native phone app can. Where the device exposes separate outputs
    // (mainly Android Chrome), this switches between them; elsewhere the
    // button stays a clear "speaker is on" indicator rather than pretending
    // to do something it can't.
    const speakerBtn = win.querySelector('[data-call-speaker]');
    const speakerLabel = win.querySelector('.vz-call-speaker-label');
    let speakerOn = true;
    speakerBtn.onclick = async () => {
      if (typeof audioEl.setSinkId !== 'function') {
        showToast('السماعة الخارجية مفعّلة افتراضيًا على هذا المتصفح.');
        return;
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter((d) => d.kind === 'audiooutput');
        const wantEarpiece = speakerOn;
        const target = wantEarpiece
          ? outputs.find((d) => /earpiece|receiver/i.test(d.label))
          : outputs.find((d) => /speaker/i.test(d.label));
        await audioEl.setSinkId(target ? target.deviceId : 'default');
        speakerOn = target ? wantEarpiece === false : true;
        speakerBtn.classList.toggle('active', speakerOn);
        speakerLabel.textContent = speakerOn ? 'السماعة الخارجية' : 'سماعة الأذن';
        if (!target) showToast('هذا الجهاز ما يدعمش التبديل بين السماعات.');
      } catch (_) {
        showToast('تعذر تبديل السماعة على هذا الجهاز.');
      }
    };
    win.querySelector('[data-call-end]').onclick = () => call.endCall();
    incoming.querySelector('[data-call-accept]').onclick = () => call.acceptCall();
    incoming.querySelector('[data-call-reject]').onclick = () => call.rejectCall();

    const signalEl = win.querySelector('[data-call-signal]');
    call.onRemoteStream = (stream) => {
      audioEl.srcObject = stream;
    };
    call.onQualityChange = (level) => {
      signalEl.classList.remove('good', 'fair', 'poor');
      signalEl.classList.add(level);
    };
    call.onIncomingCall = () => incoming.classList.add('show');
    // Tracked separately from call.state because _teardown() (which runs
    // before onRemoteEnd fires below) already resets the call's own
    // internal "was this connected" bookkeeping - this is the only way
    // onRemoteEnd can still tell the two cases apart by the time it runs.
    let wasConnected = false;
    call.onStateChange = (state) => {
      if (state === 'connected') wasConnected = true;
      else if (state === 'calling' || state === 'ringing') wasConnected = false;
      incoming.classList.toggle('show', state === 'ringing');
      win.classList.toggle('show', state === 'calling' || state === 'connected');
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
      if (state === 'calling' || state === 'connected') {
        startDebugUpdates();
      } else if (state === 'ended' || state === 'idle') {
        stopDebugUpdates();
      }
      if (state === 'calling') {
        signalEl.classList.remove('fair', 'poor');
        signalEl.classList.add('good');
      }
    };
    call.onNoAnswer = () => {
      showToast('لا يوجد رد — الطرف الآخر غير متصل بالشات حالياً.');
      onMissedCall?.();
    };
    call.onBusy = () => showToast('الطرف الآخر مشغول بمكالمة أخرى.');
    call.onConnectFailed = () =>
      showToast('تعذر إكمال المكالمة — تأكد من قوة الاتصال بالإنترنت وحاول مرة أخرى.');
    call.onError = (e) => showToast('تعذر الوصول للمايكروفون: ' + (e?.message || ''));
    // A call the other side ends (or whose own timeout ends it) while still
    // ringing/connecting used to just vanish here with zero feedback - the
    // caller's own timeout shows onConnectFailed locally, but the *other*
    // side only ever finds out via this silent teardown. A call that did
    // connect first is left alone; that gets logged to the chat instead
    // (onCallEnded, wired separately by admin-chat-widget.js).
    call.onRemoteEnd = () => {
      if (!wasConnected) showToast('انتهت المكالمة — الطرف الآخر أنهى الاتصال.');
    };

    return {
      destroy() {
        ringer.stop();
        stopDurationDisplay();
        if (debugTimer) clearInterval(debugTimer);
        win.remove();
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
