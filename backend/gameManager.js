const { v4: uuid } = require('uuid');
const { WebSocket } = require('ws');
const { GameSession, GameError } = require('./gameSession');

class GameManager {
  constructor() {
    this.sessions = new Map();
    this.clients = new Map();
  }

  registerClient(ws) {
    const id = uuid();
    this.clients.set(id, { ws, sessionId: null });
    return id;
  }

  handleJoin(clientId, payload = {}) {
    const { roomId, displayName } = payload;
    const targetRoom = roomId || this._createRoomId();
    let session = this.sessions.get(targetRoom);

    if (!session) {
      session = new GameSession(targetRoom);
      this.sessions.set(targetRoom, session);
    }

    this._cleanupStaleClients(session);

    const joinInfo = session.attachClient(clientId, displayName);
    this.clients.get(clientId).sessionId = targetRoom;

    this.broadcastSession(session);

    return {
      roomId: targetRoom,
      role: joinInfo.role,
      color: joinInfo.color,
      displayName: joinInfo.displayName,
      state: joinInfo.state
    };
  }

  handleMove(clientId, payload) {
    const session = this._requireSession(clientId);
    const { x, y } = payload ?? {};
    const state = session.placeStone(clientId, x, y);
    this.broadcastSession(session);
    return state;
  }

  handleSkill(clientId, payload) {
    const session = this._requireSession(clientId);
    const { skillId, data } = payload ?? {};

    if (!skillId) {
      throw new GameError('缺少技能编号', 'MISSING_SKILL');
    }

    const state = session.applySkill(clientId, skillId, data || {});
    this.broadcastSession(session);
    return state;
  }

  handleRestart(clientId) {
    const session = this._requireSession(clientId);
    session.forceRestart();
    this.broadcastSession(session);
    return session.serialize();
  }

  getState(clientId) {
    const session = this._requireSession(clientId);
    return session.serialize();
  }

  removeClient(clientId) {
    const meta = this.clients.get(clientId);
    if (!meta) {
      return;
    }

    const session = meta.sessionId ? this.sessions.get(meta.sessionId) : null;

    if (session) {
      session.detachClient(clientId);
      if (session.isEmpty()) {
        this.sessions.delete(session.id);
      } else {
        this.broadcastSession(session);
      }
    }

    this.clients.delete(clientId);
  }

  broadcastSession(session) {
    const state = session.serialize();
    for (const clientId of session.clients.keys()) {
      this._send(clientId, { type: 'state', payload: state });
    }
  }

  sendError(clientId, error) {
    const serialised = error instanceof GameError
      ? { message: error.message, code: error.code }
      : { message: error.message || '服务器内部错误' };
    this._send(clientId, { type: 'error', payload: serialised });
  }

  _createRoomId() {
    return uuid().slice(0, 8);
  }

  _requireSession(clientId) {
    const meta = this.clients.get(clientId);
    if (!meta || !meta.sessionId) {
      throw new GameError('客户端尚未加入房间', 'NO_SESSION');
    }

    const session = this.sessions.get(meta.sessionId);
    if (!session) {
      throw new GameError('房间不存在', 'SESSION_MISSING');
    }

    return session;
  }

  _send(clientId, message) {
    const meta = this.clients.get(clientId);
    if (!meta) {
      return;
    }

    try {
      meta.ws.send(JSON.stringify(message));
    } catch (err) {
      try {
        meta.ws.terminate?.();
      } catch (_) {
        // ignore terminate errors
      }
      this.removeClient(clientId);
    }
  }

  _cleanupStaleClients(session) {
    const staleIds = [];

    for (const [participantId] of session.clients) {
      const clientMeta = this.clients.get(participantId);
      const isOpen = clientMeta && clientMeta.ws && clientMeta.ws.readyState === WebSocket.OPEN;

      if (!clientMeta || !isOpen) {
        staleIds.push(participantId);
      }
    }

    for (const staleId of staleIds) {
      const meta = this.clients.get(staleId);
      try {
        meta?.ws?.terminate?.();
      } catch (_) {
        // ignore termination errors
      }
      session.detachClient(staleId);
      this.clients.delete(staleId);
    }
  }

}

module.exports = {
  GameManager,
  GameError
};
