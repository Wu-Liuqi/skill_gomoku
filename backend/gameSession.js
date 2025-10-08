const { SKILLS, SKILL_MAP } = require('./skillDefinitions');

const BOARD_SIZE = 15;
const WIN_LENGTH = 5;

const DEFAULT_NAMES = {
  black: '\u5b50\u742a',
  white: '\u5f20\u5448'
};

class GameError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

const createEmptyBoard = () =>
  Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));

const opposite = (color) => (color === 'black' ? 'white' : 'black');

class GameSession {
  constructor(id) {
    this.id = id;
    this.board = createEmptyBoard();
    this.players = {
      black: null,
      white: null
    };
    this.clients = new Map();
    this.spectators = new Set();
    this.currentTurn = 'black';
    this.turnNumber = 0;
    this.history = [];
    this.freeze = { black: 0, white: 0 };
    this.usedSkills = { black: new Set(), white: new Set() };
    this.skillCooldowns = {
      black: new Map(SKILLS.map((skill) => [skill.id, 0])),
      white: new Map(SKILLS.map((skill) => [skill.id, 0]))
    };
    this.lastEvent = null;
    this.lastPlacement = null;
    this.winner = null;

    this.recordSnapshot('init', {});
  }

  attachClient(clientId, displayName) {
    const providedName = displayName && displayName.trim();

    const meta = {
      id: clientId,
      role: 'spectator',
      color: null,
      displayName: providedName || null
    };

    this.clients.set(clientId, meta);

    if (this._isSeatAvailable('black')) {
      this._assignSeat('black', meta);
    } else if (this._isSeatAvailable('white')) {
      this._assignSeat('white', meta);
    } else {
      this._assignSpectator(meta);
    }

    this._rebalanceSeats();

    const updated = this.clients.get(clientId);
    return {
      role: updated.role,
      color: updated.color,
      displayName: updated.displayName,
      state: this.serialize()
    };
  }

  detachClient(clientId) {
    const meta = this.clients.get(clientId);
    if (!meta) {
      return;
    }

    if (meta.role === 'player' && meta.color) {
      if (this.players[meta.color]?.clientId === clientId) {
        this.players[meta.color] = null;
      }
    } else {
      this.spectators.delete(clientId);
    }

    this.clients.delete(clientId);
    this._rebalanceSeats();
  }

  _assignSeat(color, meta) {
    if (!meta) {
      return;
    }

    const resolvedName = meta.displayName && meta.displayName.trim()
      ? meta.displayName.trim()
      : DEFAULT_NAMES[color];

    meta.role = 'player';
    meta.color = color;
    meta.displayName = resolvedName;

    this.players[color] = {
      clientId: meta.id,
      displayName: resolvedName
    };

    this.spectators.delete(meta.id);
  }

  _assignSpectator(meta) {
    const resolvedName = meta.displayName && meta.displayName.trim()
      ? meta.displayName.trim()
      : '\u89c2\u6218\u8005-' + (this.spectators.size + 1);

    meta.role = 'spectator';
    meta.color = null;
    meta.displayName = resolvedName;
    this.spectators.add(meta.id);
  }

  _isSeatAvailable(color) {
    const seat = this.players[color];
    if (!seat) {
      return true;
    }

    const meta = this.clients.get(seat.clientId);
    return !meta || meta.role !== 'player';
  }

  _nextSpectator() {
    for (const spectatorId of Array.from(this.spectators)) {
      const candidate = this.clients.get(spectatorId);
      if (candidate) {
        this.spectators.delete(spectatorId);
        return candidate;
      }

      this.spectators.delete(spectatorId);
    }

    return null;
  }

  _rebalanceSeats() {
    for (const color of ['black', 'white']) {
      const seat = this.players[color];
      const meta = seat ? this.clients.get(seat.clientId) : null;

      if (!meta || meta.role !== 'player') {
        if (seat && meta) {
          this._assignSpectator(meta);
        }

        this.players[color] = null;

        const replacement = this._nextSpectator();
        if (replacement) {
          this._assignSeat(color, replacement);
        }
      }
    }
  }

  isEmpty() {
    return this.clients.size === 0;
  }

  canPlayerAct(clientId) {
    const meta = this.clients.get(clientId);

    if (!meta || meta.role !== 'player') {
      throw new GameError('客户端未绑定玩家身份', 'NOT_PLAYER');
    }

    if (this.winner) {
      throw new GameError('对局已结束', 'FINISHED');
    }

    if (meta.color !== this.currentTurn) {
      throw new GameError('尚未轮到该玩家', 'NOT_TURN');
    }

    if (this.freeze[meta.color] > 0) {
      throw new GameError('玩家处于冻结状态', 'FROZEN');
    }

    return meta;
  }

  placeStone(clientId, x, y) {
    const player = this.canPlayerAct(clientId);
    this._assertCoordinate(x, y);

    if (this.board[y][x]) {
      throw new GameError('该位置已有棋子', 'CELL_OCCUPIED');
    }

    this.board[y][x] = player.color;
    this.turnNumber += 1;
    this.lastPlacement = { x, y, color: player.color, bySkill: false };

    const win = this._checkWin(x, y, player.color);
    this.lastEvent = {
      type: 'move',
      x,
      y,
      color: player.color,
      win
    };

    let skipped = [];
    if (win) {
      this.winner = player.color;
    } else {
      skipped = this._advanceTurn();
      if (skipped.length) {
        this.lastEvent.skipped = skipped;
      }
    }

    this.recordSnapshot('move', this.lastEvent);
    return this.serialize();
  }

  applySkill(clientId, skillId, payload = {}) {
    const player = this.canPlayerAct(clientId);
    const skill = SKILL_MAP.get(skillId);

    if (!skill) {
      throw new GameError('未找到对应技能', 'UNKNOWN_SKILL');
    }

    if (this.usedSkills[player.color].has(skillId)) {
      throw new GameError('技能已被使用', 'SKILL_USED');
    }

    const remaining = this.skillCooldowns[player.color].get(skillId) ?? 0;
    if (remaining > 0) {
      throw new GameError('技能尚未冷却', 'SKILL_COOLDOWN');
    }

    let turnConsumed = false;

    switch (skill.type) {
      case 'remove-opponent':
        this._removeOpponent(player.color, skill, payload);
        break;
      case 'freeze-opponent':
        this._freezeOpponent(player.color, skill);
        break;
      case 'random-self':
        this._randomSelfPlacement(player.color, skill);
        turnConsumed = true;
        break;
      case 'undo':
        this._undoSteps(player.color, skill, payload);
        break;
      case 'reset-board':
        this._resetBoard(player.color, skill);
        break;
      case 'restore-history':
        this._restoreHistory(player.color, skill, payload);
        break;
      case 'remove-all-opponent':
        this._removeAllOpponent(player.color, skill);
        break;
      default:
        throw new GameError('技能类型未实现', 'SKILL_UNIMPLEMENTED');
    }

    if (!this.lastEvent) {
      this.lastEvent = {
        type: 'skill',
        skillId: skill.id,
        actor: player.color
      };
    } else {
      this.lastEvent.type = 'skill';
      this.lastEvent.skillId = skill.id;
      this.lastEvent.actor = player.color;
    }

    this.usedSkills[player.color].add(skillId);
    this.skillCooldowns[player.color].set(skillId, -1);

    let skipped = [];
    if (turnConsumed && !this.winner) {
      skipped = this._advanceTurn();
    }
    if (skipped.length) {
      this.lastEvent.skipped = skipped;
    }

    this.recordSnapshot('skill', this.lastEvent);
    return this.serialize();
  }

  _removeOpponent(color, skill, payload) {
    const opponent = opposite(color);
    const targets = Array.isArray(payload.positions) ? payload.positions : [];
    if (!targets.length) {
      throw new GameError('请选择要移除的棋子位置', 'MISSING_TARGET');
    }

    const max = skill.payload?.count ?? 1;
    const applied = [];

    for (const { x, y } of targets.slice(0, max)) {
      this._assertCoordinate(x, y);
      if (this.board[y][x] !== opponent) {
        continue;
      }
      this.board[y][x] = null;
      applied.push({ x, y });
    }

    if (!applied.length) {
      throw new GameError('未找到可移除的棋子', 'INVALID_TARGET');
    }

    this.lastEvent = {
      type: 'skill',
      skillId: skill.id,
      actor: color,
      details: { removed: applied }
    };
  }

  _freezeOpponent(color, skill) {
    const opponent = opposite(color);
    const turns = skill.payload?.turns ?? 1;
    this.freeze[opponent] += turns;

    this.lastEvent = {
      type: 'skill',
      skillId: skill.id,
      actor: color,
      details: { frozen: opponent, turns }
    };
  }

  _randomSelfPlacement(color, skill) {
    const emptyCells = [];
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        if (!this.board[y][x]) {
          emptyCells.push({ x, y });
        }
      }
    }

    if (!emptyCells.length) {
      throw new GameError('棋盘已满，无法生成棋子', 'BOARD_FULL');
    }

    const pick = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    this.board[pick.y][pick.x] = color;
    this.turnNumber += 1;
    this.lastPlacement = { ...pick, color, bySkill: true };

    const win = this._checkWin(pick.x, pick.y, color);

    if (win) {
      this.winner = color;
    }

    this.lastEvent = {
      type: 'skill',
      skillId: skill.id,
      actor: color,
      details: { placed: pick, win }
    };
  }

  _undoSteps(color, skill, payload) {
    const steps = payload.steps || skill.payload?.steps || 1;
    const targetIndex = this.history.length - 1 - steps;

    if (targetIndex < 0) {
      throw new GameError('无法继续悔棋', 'UNDO_LIMIT');
    }

    const snapshot = this.history[targetIndex];
    this._restoreFromSnapshot(snapshot);
    this.history = this.history.slice(0, targetIndex + 1);

    this.lastEvent = {
      type: 'skill',
      skillId: skill.id,
      actor: color,
      details: { steps }
    };
  }

  _resetBoard(color, skill) {
    this.board = createEmptyBoard();
    this.turnNumber = 0;
    this.currentTurn = 'black';
    this.freeze = { black: 0, white: 0 };
    this.winner = null;
    this.lastPlacement = null;

    this.skillCooldowns = {
      black: new Map(SKILLS.map((item) => [
        item.id,
        this.usedSkills.black.has(item.id) ? -1 : 0
      ])),
      white: new Map(SKILLS.map((item) => [
        item.id,
        this.usedSkills.white.has(item.id) ? -1 : 0
      ]))
    };

    this.lastEvent = {
      type: 'skill',
      skillId: skill.id,
      actor: color,
      details: { reset: true }
    };
  }

  _restoreHistory(color, skill, payload) {
    const turnNumber = payload?.turnNumber;
    if (typeof turnNumber !== 'number' || turnNumber < 0) {
      throw new GameError('缺少有效的历史回合', 'INVALID_HISTORY');
    }

    const index = this.history.findIndex(
      (entry) => entry.turnNumber === turnNumber
    );

    if (index === -1) {
      throw new GameError('未找到指定的历史状态', 'HISTORY_NOT_FOUND');
    }

    const snapshot = this.history[index];
    this._restoreFromSnapshot(snapshot);
    this.history = this.history.slice(0, index + 1);

    this.lastEvent = {
      type: 'skill',
      skillId: skill.id,
      actor: color,
      details: { turnNumber }
    };
  }

  _removeAllOpponent(color, skill) {
    const opponent = opposite(color);
    const removed = [];

    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        if (this.board[y][x] === opponent) {
          this.board[y][x] = null;
          removed.push({ x, y });
        }
      }
    }

    if (!removed.length) {
      throw new GameError('对方无棋可移除', 'NO_PIECES');
    }

    this.lastEvent = {
      type: 'skill',
      skillId: skill.id,
      actor: color,
      details: { removedCount: removed.length }
    };
  }

  _advanceTurn() {
    this._tickCooldowns();
    let next = opposite(this.currentTurn);
    const skipped = [];
    let guard = 0;

    while (this.freeze[next] > 0 && guard < 4) {
      this.freeze[next] -= 1;
      skipped.push(next);
      next = opposite(next);
      guard += 1;
    }

    this.currentTurn = next;
    return skipped;
  }

  _tickCooldowns() {
    ['black', 'white'].forEach((color) => {
      this.skillCooldowns[color].forEach((value, key, map) => {
        if (value > 0) {
          map.set(key, value - 1);
        }
      });
    });
  }

  _restoreFromSnapshot(snapshot) {
    this.board = snapshot.board.map((row) => row.slice());
    this.freeze = { ...snapshot.freeze };
    this.usedSkills = {
      black: new Set(snapshot.usedSkills.black),
      white: new Set(snapshot.usedSkills.white)
    };
    this.skillCooldowns = {
      black: new Map(snapshot.skillCooldowns.black),
      white: new Map(snapshot.skillCooldowns.white)
    };
    this.currentTurn = snapshot.currentTurn;
    this.turnNumber = snapshot.turnNumber;
    this.winner = snapshot.winner;
    this.lastEvent = snapshot.lastEvent;
    this.lastPlacement = snapshot.lastPlacement || null;
  }

  _assertCoordinate(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new GameError('坐标必须为整数', 'INVALID_COORD');
    }
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
      throw new GameError('坐标超出棋盘范围', 'OUT_OF_RANGE');
    }
  }

  _checkWin(x, y, color) {
    return (
      this._lineCount(x, y, color, 1, 0) >= WIN_LENGTH ||
      this._lineCount(x, y, color, 0, 1) >= WIN_LENGTH ||
      this._lineCount(x, y, color, 1, 1) >= WIN_LENGTH ||
      this._lineCount(x, y, color, 1, -1) >= WIN_LENGTH
    );
  }

  _lineCount(x, y, color, dx, dy) {
    let count = 1;

    count += this._countDirection(x, y, color, dx, dy);
    count += this._countDirection(x, y, color, -dx, -dy);

    return count;
  }

  _countDirection(x, y, color, dx, dy) {
    let cx = x + dx;
    let cy = y + dy;
    let total = 0;

    while (
      cx >= 0 &&
      cx < BOARD_SIZE &&
      cy >= 0 &&
      cy < BOARD_SIZE &&
      this.board[cy][cx] === color
    ) {
      total += 1;
      cx += dx;
      cy += dy;
    }

    return total;
  }

  buildSkillState(color) {
    const states = [];
    for (const skill of SKILLS) {
      const remaining = this.skillCooldowns[color].get(skill.id) ?? 0;
      const used = this.usedSkills[color].has(skill.id);

      states.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        cooldown: skill.cooldown,
        remainingCooldown: used ? 0 : Math.max(0, remaining),
        used,
        available: !used && remaining <= 0
      });
    }
    return states;
  }

  serialize() {
    const status = this.winner
      ? { phase: 'finished', winner: this.winner }
      : this.players.black && this.players.white
        ? { phase: 'playing' }
        : { phase: 'waiting' };

    return {
      id: this.id,
      board: this.board,
      currentTurn: this.currentTurn,
      turnNumber: this.turnNumber,
      players: {
        black: this.players.black,
        white: this.players.white
      },
      freeze: this.freeze,
      winner: this.winner,
      lastEvent: this.lastEvent,
      lastPlacement: this.lastPlacement,
      skills: {
        black: this.buildSkillState('black'),
        white: this.buildSkillState('white')
      },
      historyLength: this.history.length,
      status,
      spectatorCount: this.spectators.size
    };
  }

  forceRestart() {
    this.board = createEmptyBoard();
    this.turnNumber = 0;
    this.currentTurn = 'black';
    this.freeze = { black: 0, white: 0 };
    this.winner = null;
    this.lastPlacement = null;
    this.usedSkills = { black: new Set(), white: new Set() };
    this.skillCooldowns = {
      black: new Map(SKILLS.map((skill) => [skill.id, 0])),
      white: new Map(SKILLS.map((skill) => [skill.id, 0]))
    };
    this.history = [];
    this.lastEvent = { type: 'system', action: 'restart' };
    this.recordSnapshot('restart', {});
  }

    recordSnapshot(action, meta) {
    const snapshot = {
      action,
      meta,
      board: this.board.map((row) => row.slice()),
      freeze: { ...this.freeze },
      usedSkills: {
        black: Array.from(this.usedSkills.black),
        white: Array.from(this.usedSkills.white)
      },
      skillCooldowns: {
        black: Array.from(this.skillCooldowns.black.entries()),
        white: Array.from(this.skillCooldowns.white.entries())
      },
      currentTurn: this.currentTurn,
      turnNumber: this.turnNumber,
      winner: this.winner,
      lastEvent: this.lastEvent,
      lastPlacement: this.lastPlacement
    };

    this.history.push(snapshot);
  }
}

module.exports = {
  GameSession,
  GameError,
  BOARD_SIZE
};
