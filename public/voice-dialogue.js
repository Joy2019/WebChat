/**
 * Web 语音对话（LiveKit）：对接文档「模式 A」——前端只拿短时 token，密钥不出后端。
 * 依赖 CDN：livekit-client ESM。
 */

const LIVEKIT_CDN =
  'https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/dist/livekit-client.esm.mjs';

const AGENT_STATE_LABEL = {
  idle: '空闲',
  listening: '正在听…',
  thinking: '思考中…',
  speaking: '正在说…',
  initializing: '初始化…',
};

let livekitModPromise = null;

function loadLivekit() {
  if (!livekitModPromise) {
    livekitModPromise = import(LIVEKIT_CDN);
  }
  return livekitModPromise;
}

function isAgentParticipant(participant) {
  if (!participant) return false;
  const id = String(participant.identity || '');
  if (id.startsWith('agent')) return true;
  // livekit-client ParticipantKind.AGENT === 4（兼容未导出常量的情况）
  return participant.kind === 4 || participant.kind === 'agent';
}

/**
 * @typedef {object} VoiceDialogueCallbacks
 * @property {(state: string, label: string) => void} [onAgentState]
 * @property {(role: 'user'|'ai', text: string, final: boolean) => void} [onTranscript]
 * @property {(message: string) => void} [onStatus]
 * @property {(err: Error) => void} [onError]
 * @property {() => void} [onDisconnected]
 */

export class VoiceDialogueSession {
  /** @param {VoiceDialogueCallbacks} callbacks */
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.room = null;
    this.audioEls = new Set();
    this._unlockHandler = null;
    this.connected = false;
    this.agentState = 'initializing';
  }

  async connect() {
    this.callbacks.onStatus?.('正在获取会话凭证…');
    const tokenRes = await fetch('/api/voice/token');
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenBody.token) {
      throw new Error(tokenBody.message || `获取 Token 失败（HTTP ${tokenRes.status}）`);
    }

    const { Room, RoomEvent, Track } = await loadLivekit();
    const room = new Room();
    this.room = room;

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      try {
        track.setPlayoutDelay?.(0.05);
      } catch {
        /* 内网低抖动可选 */
      }
      const el = new Audio();
      el.autoplay = true;
      el.srcObject = new MediaStream([track.mediaStreamTrack]);
      el.setAttribute('data-voice-ai', '1');
      document.body.appendChild(el);
      this.audioEls.add(el);
      const play = () => {
        el.play().catch(() => {
          this._armAutoplayUnlock(el);
        });
      };
      play();
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      this._cleanupAudioForTrack(track);
    });

    room.on(RoomEvent.ParticipantAttributesChanged, (changed) => {
      if (changed?.['lk.agent.state']) {
        this._setAgentState(changed['lk.agent.state']);
      }
    });

    room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      const seg = segments?.[segments.length - 1];
      if (!seg?.text) return;
      const role = isAgentParticipant(participant) ? 'ai' : 'user';
      this.callbacks.onTranscript?.(role, seg.text, !!seg.final);
    });

    room.on(RoomEvent.Disconnected, () => {
      this.connected = false;
      this.callbacks.onDisconnected?.();
    });

    this.callbacks.onStatus?.('正在连接语音房间…');
    await room.connect(tokenBody.url, tokenBody.token);
    this.connected = true;

    this.callbacks.onStatus?.('正在开启麦克风…');
    // 回声消除必须开启，否则 AI 播放会被回采导致自打断
    await room.localParticipant.setMicrophoneEnabled(
      true,
      { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      { dtx: false, red: false }
    );

    this._setAgentState('listening');
    this.callbacks.onStatus?.('已连接，请开始说话');
  }

  async setMicrophoneEnabled(enabled) {
    if (!this.room?.localParticipant) return;
    await this.room.localParticipant.setMicrophoneEnabled(
      !!enabled,
      { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      { dtx: false, red: false }
    );
  }

  async disconnect() {
    this._removeAutoplayUnlock();
    for (const el of this.audioEls) {
      try {
        el.pause();
        el.srcObject = null;
        el.remove();
      } catch {
        /* ignore */
      }
    }
    this.audioEls.clear();
    if (this.room) {
      try {
        await this.room.disconnect();
      } catch {
        /* ignore */
      }
      this.room = null;
    }
    this.connected = false;
  }

  _setAgentState(state) {
    this.agentState = state || 'idle';
    const label = AGENT_STATE_LABEL[this.agentState] || this.agentState;
    this.callbacks.onAgentState?.(this.agentState, label);
  }

  _armAutoplayUnlock(el) {
    if (this._unlockHandler) return;
    this._unlockHandler = () => {
      el.play().catch(() => {});
      this._removeAutoplayUnlock();
    };
    document.addEventListener('pointerdown', this._unlockHandler, { once: true });
    document.addEventListener('keydown', this._unlockHandler, { once: true });
    this.callbacks.onStatus?.('浏览器拦截了自动播放，请再点一下页面以听到 AI 声音');
  }

  _removeAutoplayUnlock() {
    if (!this._unlockHandler) return;
    document.removeEventListener('pointerdown', this._unlockHandler);
    document.removeEventListener('keydown', this._unlockHandler);
    this._unlockHandler = null;
  }

  _cleanupAudioForTrack(track) {
    const mst = track?.mediaStreamTrack;
    for (const el of [...this.audioEls]) {
      const stream = el.srcObject;
      const tracks = stream?.getAudioTracks?.() || [];
      if (!mst || tracks.some((t) => t.id === mst.id)) {
        try {
          el.pause();
          el.srcObject = null;
          el.remove();
        } catch {
          /* ignore */
        }
        this.audioEls.delete(el);
      }
    }
  }
}

export async function checkVoiceDialogueAvailable() {
  try {
    const res = await fetch('/api/voice/status');
    if (!res.ok) return { enabled: false };
    return await res.json();
  } catch {
    return { enabled: false };
  }
}

export { AGENT_STATE_LABEL };
