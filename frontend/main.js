const BOARD_SIZE = 15;
const BOARD_PADDING = 12;
const STAR_POINTS = [
  [3, 3],
  [3, 11],
  [11, 3],
  [11, 11],
  [7, 7]
];

const SKILL_META = {
  'flying-sand': {
    targetType: 'opponent',
    maxTargets: 1,
    instruction: '选择1颗敌方棋子以移除'
  },
  'yale-ya': {
    targetType: 'opponent',
    maxTargets: 2,
    instruction: '最多选择2颗敌方棋子以移除'
  },
  'calm-water': {
    instruction: '冻结对手1回合'
  },
  capture: {
    instruction: '为己方随机生成棋子'
  },
  rewind: {
    instruction: '悔棋一步'
  },
  'reset-board': {
    instruction: '清空棋盘并重置游戏',
    confirm: '确定要清空整个棋盘并重置技能冷却吗？'
  },
  restore: {
    instruction: '恢复至指定历史回合',
    requiresInput: true,
    prompt: '输入要恢复的历史回合号（0 表示开局状态）'
  },
  'see-you-again': {
    instruction: '移除敌方所有棋子',
    confirm: '确定要移除对方所有棋子吗？'
  }
};

// TTS音频管理器
class TTSAudioManager {
  constructor() {
    this.supported = typeof window !== 'undefined'
      && typeof window.speechSynthesis !== 'undefined'
      && typeof window.SpeechSynthesisUtterance === 'function';

    this.volume = 0.7;
    this.rate = 1.0;
    this.pitch = 1.0;
    this.voice = null;

    this.enabled = this.supported;
    this.notifiedUnsupported = !this.supported;

    if (this.supported) {
      try {
        const stored = localStorage.getItem('skills-gomoku-audio');
        if (stored !== null) {
          this.enabled = stored !== 'false';
        }
      } catch (err) {
        console.warn('Unable to read audio preference; using default setting', err);
        this.enabled = true;
      }

      this.initVoice();
    } else {
      this.enabled = false;
    }
  }

  initVoice() {
    if (!this.supported) {
      return;
    }

    const setVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      // 优先选择中文语音
      this.voice = voices.find(voice =>
        voice.lang.includes('zh') || voice.lang.includes('CN')
      ) || voices[0];
    };

    if (window.speechSynthesis.getVoices().length) {
      setVoice();
    } else {
      window.speechSynthesis.onvoiceschanged = setVoice;
    }
  }

  playSkillSound(skillId) {
    const skillNames = {
      'flying-sand': '飞沙走石',
      'calm-water': '静如止水',
      'yale-ya': '呀嘞呀',
      'capture': '擒拿擒拿',
      'rewind': '时光倒流',
      'reset-board': '力拔山兮',
      'restore': '东山再起',
      'see-you-again': 'See you again'
    };

    this.safeSpeak(skillNames[skillId]);
  }

  playMoveSound() {
    this.safeSpeak('嘿', { rateOffset: 0.2 });
  }

  playVictorySound(winner) {
    const victoryTexts = {
      black: '黑棋获胜',
      white: '白棋获胜'
    };

    const phrase = victoryTexts[winner];
    if (!phrase) {
      return;
    }

    this.safeSpeak(phrase, { rateOffset: -0.1, pitchOffset: 0.1 });
  }

  toggle() {
    if (!this.supported) {
      return false;
    }

    this.enabled = !this.enabled;

    try {
      localStorage.setItem('skills-gomoku-audio', this.enabled.toString());
    } catch (err) {
      console.warn('Unable to persist audio preference', err);
    }

    return this.enabled;
  }

  isEnabled() {
    return this.enabled;
  }

  isSupported() {
    return this.supported;
  }

  safeSpeak(text, { rateOffset = 0, pitchOffset = 0 } = {}) {
    if (!text || !this.supported || !this.enabled) {
      return;
    }

    try {
      const speech = typeof window !== 'undefined' ? window.speechSynthesis : null;
      const Utterance = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null;

      if (!speech || typeof speech.speak !== 'function' || typeof Utterance !== 'function') {
        throw new Error('Speech synthesis API unavailable');
      }

      speech.cancel();

      const utterance = new Utterance(text);
      utterance.volume = this.volume;
      utterance.rate = this.rate + rateOffset;
      utterance.pitch = this.pitch + pitchOffset;

      if (this.voice) {
        utterance.voice = this.voice;
      }

      speech.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis play failed; disabling audio features', err);
      this.supported = false;
      this.enabled = false;
      this.persistDisabled();
      this.notifyUnsupported();
    }
  }

  persistDisabled() {
    try {
      localStorage.setItem('skills-gomoku-audio', 'false');
    } catch (_) {
      // ignore storage errors
    }
  }

  notifyUnsupported() {
    if (this.notifiedUnsupported || typeof window === 'undefined') {
      return;
    }

    this.notifiedUnsupported = true;
    const eventName = 'skills-gomoku-audio-unsupported';

    try {
      window.dispatchEvent(new CustomEvent(eventName));
    } catch (_) {
      try {
        const event = document.createEvent('Event');
        event.initEvent(eventName, true, true);
        window.dispatchEvent(event);
      } catch (innerErr) {
        console.warn('Unable to dispatch unsupported audio event', innerErr);
      }
    }
  }
}

// 创建全局音频管理器实例
const audioManager = new TTSAudioManager();

const RULES_HTML = `
  <p>• 棋盘为15×15，黑棋（子琪）先行，任意直线上率先连成五子者胜。</p>
  <p>• 玩家共享 8 个一次性技能，每个技能具有不同冷却与效果：</p>
  <ul>
    <li><strong>飞沙走石</strong>：移除敌方1颗棋子（冷却2回合）。</li>
    <li><strong>静如止水</strong>：冻结敌方1回合，期间无法落子（冷却4回合）。</li>
    <li><strong>呀嘞呀</strong>：移除敌方2颗棋子（冷却5回合）。</li>
    <li><strong>擒拿擒拿</strong>：随机生成己方棋子（冷却6回合）。</li>
    <li><strong>时光倒流</strong>：悔棋一步（冷却7回合）。</li>
    <li><strong>力拔山兮</strong>：清空棋盘并保留双方阵营（冷却15回合）。</li>
    <li><strong>东山再起</strong>：恢复至指定历史回合（冷却10回合）。</li>
    <li><strong>See you again</strong>：移除敌方所有棋子（冷却20回合）。</li>
  </ul>
  <p>• 技能只能在己方回合且未被冻结时发动，每个技能每局仅可使用一次。</p>
  <p>• 点击技能图标按提示选择目标，或使用重新开始按钮重置整局。</p>
  <p>• 微信登录及好友邀请功能可通过后端接口接入真实服务，此演示提供模拟登录。</p>
`;

const elements = {
  subtitle: document.getElementById('subtitle'),
  roomCode: document.getElementById('room-code'),
  copyRoom: document.getElementById('copy-room'),
  boardCanvas: document.getElementById('board-canvas'),
  restartBtn: document.getElementById('restart-btn'),
  rulesBtn: document.getElementById('rules-btn'),
  audioToggleBtn: document.getElementById('audio-toggle-btn'),
  reconnectBtn: document.getElementById('reconnect-btn'),
  turnNumber: document.getElementById('turn-number'),
  moveCount: document.getElementById('move-count'),
  gameStatus: document.getElementById('game-status'),
  playerBlackName: document.getElementById('player-black-name'),
  playerWhiteName: document.getElementById('player-white-name'),
  playerBlackTurn: document.getElementById('player-black-turn'),
  playerWhiteTurn: document.getElementById('player-white-turn'),
  playerCards: {
    black: document.querySelector('.player-card[data-color="black"]'),
    white: document.querySelector('.player-card[data-color="white"]')
  },
  skillGrid: document.getElementById('skill-grid'),
  skillsPanelTitle: document.querySelector('.skills-panel h2'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modal-title'),
  modalBody: document.getElementById('modal-body'),
  modalClose: document.getElementById('modal-close'),
  toast: document.getElementById('toast'),
  effectOverlay: document.getElementById('effect-overlay'),
  mobilePanelTabs: document.querySelector('.mobile-panel-tabs'),
  mobilePanelButtons: Array.from(document.querySelectorAll('.panel-tab[data-panel-target]')),
  mobilePanels: Array.from(document.querySelectorAll('.mobile-panel[data-panel]'))
};

const state = {
  socket: null,
  clientId: null,
  roomId: new URLSearchParams(window.location.search).get('room') || null,
  displayName: null,
  role: 'spectator',
  color: null,
  game: null,
  selection: null,
  hoverCell: null,
  pingTimer: null,
  toastTimer: null,
  activeMobilePanel: null,
  resizeObserver: null
};

function init() {
  try {
    console.log('开始初始化游戏...');
    console.log('当前URL:', window.location.href);
    console.log('用户代理:', navigator.userAgent);

    state.displayName = ensureDisplayName();
    wireEvents();
    setupMobilePanels();

    // 检查网络连接
    checkNetworkAndConnect();

    adjustCanvasSize();
    drawBoard();
    updateAudioToggleButton(); // 初始化音效按钮状态
    window.requestAnimationFrame(() => {
      adjustCanvasSize();
      drawBoard();
    });
  } catch (error) {
    console.error('初始化失败:', error);
    // 显示错误信息给用户
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'position: fixed; top: 10px; left: 10px; background: red; color: white; padding: 10px; z-index: 9999; max-width: 300px;';
    errorDiv.textContent = '游戏初始化失败: ' + error.message;
    document.body.appendChild(errorDiv);
  }
}

function getWebSocketUrls() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host;
  const hostname = window.location.hostname;
  const port = window.location.port;

  // 检查是否通过nginx代理
  const isExternalIP = /^\d+\.\d+\.\d+\.\d+/.test(hostname);
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

  console.log('当前访问信息:', {
    protocol: window.location.protocol,
    hostname: hostname,
    host: host,
    port: port,
    isExternalIP: isExternalIP,
    isLocalhost: isLocalhost
  });

  const urls = [];

  if (isExternalIP && !port) {
    // 外网IP访问，可能通过nginx代理
    urls.push(`${protocol}://${host}/ws`);  // 带/ws路径
    urls.push(`${protocol}://${host}`);     // 直接连接
    urls.push(`${protocol}://${hostname}:3000`); // 尝试直连3000端口
  } else if (isLocalhost) {
    // 本地访问
    urls.push(`${protocol}://${host}`);     // 直接连接
    if (!port || port !== '3000') {
      urls.push(`${protocol}://${hostname}:3000`); // 尝试3000端口
    }
  } else {
    // 其他情况
    urls.push(`${protocol}://${host}`);     // 直接连接
    urls.push(`${protocol}://${host}/ws`);  // 带/ws路径
  }

  console.log('WebSocket URL候选列表:', urls);
  return urls;
}

function checkNetworkAndConnect() {
  // 检查基本的网络连接
  if (navigator.onLine === false) {
    updateSubtitle('网络连接不可用');
    showToast('请检查网络连接', 'error', 8000);
    return;
  }

  // 尝试ping服务器
  fetch('/health', {
    method: 'GET',
    cache: 'no-cache',
    timeout: 5000
  })
    .then(response => {
      if (response.ok) {
        console.log('服务器健康检查通过');
        connectSocket();
      } else {
        throw new Error('服务器响应异常: ' + response.status);
      }
    })
    .catch(error => {
      console.error('服务器健康检查失败:', error);
      updateSubtitle('无法连接到服务器，请点击重新连接');
      showToast('服务器不可用，请点击重新连接按钮', 'error', 8000);
      showReconnectButton();

      // 即使健康检查失败，也尝试WebSocket连接
      setTimeout(() => {
        console.log('尝试直接WebSocket连接...');
        connectSocket();
      }, 2000);
    });
}

// 全局错误处理
window.addEventListener('error', function (event) {
  console.error('JavaScript错误:', event.error);
});

window.addEventListener('unhandledrejection', function (event) {
  console.error('未处理的Promise拒绝:', event.reason);
});

function ensureDisplayName() {
  const stored = localStorage.getItem('skills-gomoku-name');
  if (stored) {
    return stored;
  }
  const fallback = `玩家${Math.floor(Math.random() * 1000)}`;
  const input = window.prompt('请输入昵称（用于展示给对手）', fallback) || fallback;
  const trimmed = input.trim().slice(0, 12) || fallback;
  localStorage.setItem('skills-gomoku-name', trimmed);
  return trimmed;
}

function wireEvents() {
  elements.copyRoom.addEventListener('click', copyRoomLink);
  elements.restartBtn.addEventListener('click', handleRestart);
  elements.rulesBtn.addEventListener('click', showRules);
  elements.audioToggleBtn.addEventListener('click', handleAudioToggle);
  elements.reconnectBtn.addEventListener('click', handleReconnect);
  elements.modalClose.addEventListener('click', hideModal);
  elements.modal.addEventListener('click', (evt) => {
    if (evt.target === elements.modal) {
      hideModal();
    }
  });

  const canvas = elements.boardCanvas;
  if (canvas) {
    canvas.addEventListener('click', handleBoardClick);

    const supportsPointer = typeof window.PointerEvent === 'function';
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    if (supportsPointer) {
      canvas.addEventListener('pointermove', handleBoardHover, { passive: true });
      canvas.addEventListener('pointerdown', handleBoardHover);
      canvas.addEventListener('pointerleave', clearHoverCell);
    } else {
      canvas.addEventListener('mousemove', handleBoardHover);
      canvas.addEventListener('mouseleave', clearHoverCell);

      // 为触摸设备优化事件处理
      if (isTouchDevice) {
        canvas.addEventListener('touchstart', handleBoardHover, { passive: false });
        canvas.addEventListener('touchmove', handleBoardHover, { passive: false });
        canvas.addEventListener('touchend', clearHoverCell, { passive: true });
        canvas.addEventListener('touchcancel', clearHoverCell, { passive: true });
      }
    }

    if (window.ResizeObserver) {
      if (state.resizeObserver) {
        state.resizeObserver.disconnect();
      }
      state.resizeObserver = new ResizeObserver(() => {
        adjustCanvasSize();
        drawBoard();
      });

      // 观察多个元素以确保棋盘大小与其他元素保持一致
      if (canvas.parentElement) {
        state.resizeObserver.observe(canvas.parentElement);
      }

      // 观察app容器
      const appShell = document.querySelector('.app-shell');
      if (appShell) {
        state.resizeObserver.observe(appShell);
      }

      // 观察技能面板
      const skillsPanel = document.querySelector('.skills-panel');
      if (skillsPanel) {
        state.resizeObserver.observe(skillsPanel);
      }

      // 观察玩家卡片容器
      const playersContainer = document.querySelector('.players-banner');
      if (playersContainer) {
        state.resizeObserver.observe(playersContainer);
      }
    }
  }

  const handleResize = () => {
    adjustCanvasSize();
    drawBoard();
  };

  window.addEventListener('resize', handleResize);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleResize);
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selection) {
      cancelSelection('取消当前技能目标选择');
    }
  });
}

function setupMobilePanels() {
  const buttons = elements.mobilePanelButtons;
  const panels = elements.mobilePanels;
  if (!Array.isArray(buttons) || buttons.length === 0 || !Array.isArray(panels) || panels.length === 0) {
    return;
  }

  const fallback = (panels[0] && panels[0].dataset && panels[0].dataset.panel) || 'info';
  let preferred = fallback;

  try {
    const stored = localStorage.getItem('skills-mobile-panel-active');
    if (stored && panels.some((panel) => panel.dataset.panel === stored)) {
      preferred = stored;
    }
  } catch (err) {
    console.warn('无法读取面板偏好', err);
  }

  const mediaQuery = window.matchMedia('(max-width: 640px)');

  const apply = (panelId, options = {}) => {
    const { skipPersist = false } = options;
    const resolved = panels.some((panel) => panel.dataset.panel === panelId) ? panelId : fallback;
    const isDesktop = !mediaQuery.matches;

    panels.forEach((panel) => {
      const active = isDesktop || panel.dataset.panel === resolved;
      panel.classList.toggle('is-active', active);
      if (isDesktop) {
        panel.removeAttribute('aria-hidden');
      } else {
        panel.setAttribute('aria-hidden', active ? 'false' : 'true');
      }
    });

    buttons.forEach((button) => {
      const isActive = button.dataset.panelTarget === resolved;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', String(isActive));
      button.setAttribute('aria-pressed', String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });

    state.activeMobilePanel = resolved;

    if (!skipPersist) {
      try {
        localStorage.setItem('skills-mobile-panel-active', resolved);
      } catch (err) {
        console.warn('无法保存面板偏好', err);
      }
    }

    adjustCanvasSize();
    drawBoard();
  };

  const setActive = (panelId, options) => {
    apply(panelId, options);
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => setActive(button.dataset.panelTarget));
  });

  const handleMediaChange = () => {
    apply(state.activeMobilePanel || preferred, { skipPersist: true });
  };

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleMediaChange);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(handleMediaChange);
  }

  setActive(preferred, { skipPersist: true });
}

function connectSocket(fallbackAttempt = 0) {
  try {
    // 获取WebSocket URL列表，按优先级排序
    const wsUrls = getWebSocketUrls();
    const wsUrl = wsUrls[fallbackAttempt] || wsUrls[0];

    console.log(`尝试连接WebSocket (尝试 ${fallbackAttempt + 1}/${wsUrls.length}):`, wsUrl);
    updateSubtitle('正在连接服务器...');

    const socket = new WebSocket(wsUrl);
    state.socket = socket;

    socket.addEventListener('open', () => {
      console.log('WebSocket连接成功');
      updateSubtitle('连接成功，正在加入房间...');
      updateConnectionStatus('ws-status', '已连接', 'success');
      clearTimeout(state.connectionTimeout);

      // 立即发送join请求
      setTimeout(() => {
        console.log('准备发送join请求...');
        sendJoin();
      }, 100);
    });

    socket.addEventListener('message', handleSocketMessage);

    socket.addEventListener('close', (event) => {
      console.log('WebSocket连接关闭:', event.code, event.reason);
      clearInterval(state.pingTimer);
      clearTimeout(state.connectionTimeout);

      if (event.code === 1006) {
        // 异常关闭，可能是网络问题
        updateSubtitle('连接异常断开，请点击重新连接');
        showToast('网络连接异常，请点击重新连接按钮', 'error', 8000);
      } else {
        updateSubtitle('连接已断开，请点击重新连接');
        showToast('连接已断开，请点击重新连接按钮', 'error', 6000);
      }
      showReconnectButton();
    });

    socket.addEventListener('error', (error) => {
      console.error('WebSocket连接错误:', error);
      clearTimeout(state.connectionTimeout);

      // 尝试下一个URL
      const wsUrls = getWebSocketUrls();
      if (fallbackAttempt + 1 < wsUrls.length) {
        console.log('尝试下一个WebSocket URL...');
        setTimeout(() => {
          connectSocket(fallbackAttempt + 1);
        }, 1000);
      } else {
        updateSubtitle('连接失败，请点击重新连接');
        showToast('无法连接到服务器，请点击重新连接按钮', 'error', 8000);
        showReconnectButton();
      }
    });

    // 连接超时检测
    state.connectionTimeout = setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) {
        console.log('WebSocket连接超时');
        socket.close();

        // 尝试下一个URL
        const wsUrls = getWebSocketUrls();
        if (fallbackAttempt + 1 < wsUrls.length) {
          console.log('连接超时，尝试下一个WebSocket URL...');
          connectSocket(fallbackAttempt + 1);
        } else {
          updateSubtitle('连接超时，请点击重新连接');
          showToast('连接服务器超时，请点击重新连接按钮', 'error', 8000);
          showReconnectButton();
        }
      }
    }, 8000); // 8秒超时，给回退留时间

    state.pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        sendMessage('ping', { time: Date.now() });
      }
    }, 20000);

  } catch (error) {
    console.error('创建WebSocket连接失败:', error);
    updateSubtitle('连接失败');
    showToast('无法创建连接，请刷新页面重试', 'error', 8000);
  }
}

function handleSocketMessage(event) {
  console.log('收到WebSocket消息:', event.data);
  let message;
  try {
    message = JSON.parse(event.data);
  } catch (err) {
    console.warn('无法解析消息', err);
    return;
  }

  const { type, payload } = message;
  console.log('解析后的消息:', { type, payload });

  switch (type) {
    case 'connected':
      console.log('收到connected消息');
      state.clientId = (payload && payload.clientId) || null;
      console.log('设置clientId:', state.clientId);
      updateConnectionStatus('client-id', state.clientId || '无', 'info');
      sendJoin();
      break;
    case 'joined':
      console.log('收到joined消息');
      updateConnectionStatus('room-status', '已加入房间', 'success');
      applyJoinResult(payload);
      break;
    case 'state':
      console.log('收到state消息');
      // 检查是否有技能被使用，播放对应音效
      if (payload.lastEvent && payload.lastEvent.type === 'skill' && payload.lastEvent.skillId) {
        audioManager.playSkillSound(payload.lastEvent.skillId);
      }
      applyGameState(payload);
      break;
    case 'error':
      handleServerError(payload);
      break;
    case 'pong':
      break;
    default:
      console.debug('收到未知消息类型', type, payload);
  }
}

function sendJoin() {
  console.log('sendJoin被调用');
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    console.log('WebSocket未连接，无法发送join');
    return;
  }

  const joinData = {
    roomId: state.roomId,
    displayName: state.displayName
  };
  console.log('发送join消息:', joinData);

  sendMessage('join', joinData);
}

function applyJoinResult(payload) {
  if (!payload) {
    return;
  }

  state.roomId = payload.roomId || state.roomId;
  state.role = payload.role || state.role;
  state.color = payload.color || null;
  state.displayName = payload.displayName || state.displayName;

  if (state.roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set('room', state.roomId);
    window.history.replaceState(null, '', url.toString());
  }

  elements.roomCode.textContent = state.roomId || '--';
  elements.copyRoom.disabled = !state.roomId;

  if (payload.state) {
    applyGameState(payload.state);
  }

  const identity = state.role === 'player'
    ? `已加入房间，身份：${state.color === 'black' ? '黑棋（子琪）' : '白棋（张呈）'}`
    : '以观战者身份加入房间';
  showToast(identity, 'info');
}

function applyGameState(gameState) {
  if (!gameState) {
    return;
  }

  const previousGame = state.game;
  state.game = gameState;

  // 检查是否有获胜者（新的获胜）
  if (gameState.winner && (!previousGame || !previousGame.winner)) {
    EffectManager.createVictoryEffect(gameState.winner);
  }

  // 检查是否有新的棋子放置
  if (gameState.lastPlacement && previousGame) {
    const { x, y } = gameState.lastPlacement;
    EffectManager.createParticles(x, y, gameState.currentTurn === 'black' ? '#333' : '#fff', 4);
  }

  if (state.selection) {
    const skillId = state.selection.skill.id;
    const ownerSkills = (gameState.skills && gameState.skills[state.color || 'black']) || [];
    const skillNow = ownerSkills.find((item) => item.id === skillId);
    if (!skillNow || skillNow.used || !skillNow.available) {
      cancelSelection();
    }
  }

  updateUiFromState();
  drawBoard();
}

function handleServerError(payload) {
  const message = (payload && payload.message) || '服务器内部错误';
  showToast(message, 'error');
  if (state.selection) {
    cancelSelection();
  }
}

function sendMessage(type, payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    console.log('WebSocket未连接，无法发送消息:', type);
    return;
  }

  const message = { type, payload };
  console.log('发送WebSocket消息:', message);

  try {
    state.socket.send(JSON.stringify(message));
    console.log('消息发送成功');
  } catch (error) {
    console.error('发送消息失败:', error);
  }
}

function handleRestart() {
  if (!state.game) {
    return;
  }
  if (!window.confirm('确定重新开始？这会清空当前棋盘并重置技能使用状态。')) {
    return;
  }
  sendMessage('restart');
  showToast('已发送重新开始请求', 'info');
}

function showRules() {
  elements.modalTitle.textContent = '技能与规则说明';
  elements.modalBody.innerHTML = RULES_HTML;
  elements.modal.classList.remove('hidden');
}

function hideModal() {
  elements.modal.classList.add('hidden');
}

function copyRoomLink() {
  if (!state.roomId) {
    showToast('房间尚未创建', 'warning');
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set('room', state.roomId);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url.toString()).then(() => {
      showToast('邀请链接已复制', 'success');
    }).catch(() => {
      legacyCopy(url.toString());
    });
  } else {
    legacyCopy(url.toString());
  }
}

function legacyCopy(text) {
  const temp = document.createElement('textarea');
  temp.value = text;
  temp.setAttribute('readonly', 'true');
  temp.style.position = 'absolute';
  temp.style.left = '-9999px';
  document.body.appendChild(temp);
  temp.select();
  try {
    document.execCommand('copy');
    showToast('邀请链接已复制', 'success');
  } catch (err) {
    showToast('复制失败，请手动复制地址栏链接', 'error');
  } finally {
    document.body.removeChild(temp);
  }
}

function handleAudioToggle() {
  if (!audioManager.isSupported()) {
    showToast('当前浏览器暂不支持音效功能', 'warning');
    return;
  }

  const enabled = audioManager.toggle();
  updateAudioToggleButton();
  showToast(enabled ? '音效已开启' : '音效已关闭', 'info');
}

function updateAudioToggleButton() {
  const supported = audioManager.isSupported();
  const enabled = audioManager.isEnabled();

  if (!supported) {
    elements.audioToggleBtn.textContent = '🔇 音效不可用';
  } else {
    elements.audioToggleBtn.textContent = enabled ? '🔊 音效' : '🔇 音效';
  }

  elements.audioToggleBtn.classList.toggle('disabled', !enabled);
  elements.audioToggleBtn.disabled = !supported;
  elements.audioToggleBtn.setAttribute('aria-disabled', (!supported).toString());
}

if (typeof window !== 'undefined') {
  window.addEventListener('skills-gomoku-audio-unsupported', () => {
    updateAudioToggleButton();
    showToast('当前浏览器暂不支持音效功能', 'warning', 6000);
  }, { once: true });
}

function handleReconnect() {
  console.log('用户手动重连');
  elements.reconnectBtn.style.display = 'none';

  // 关闭现有连接
  if (state.socket) {
    state.socket.close();
  }

  // 清理定时器
  clearInterval(state.pingTimer);
  clearTimeout(state.connectionTimeout);

  // 重新连接
  setTimeout(() => {
    checkNetworkAndConnect();
  }, 1000);
}

function showReconnectButton() {
  if (elements.reconnectBtn) {
    elements.reconnectBtn.style.display = 'inline-block';
  }
}

function updateConnectionStatus(elementId, text, type = 'info') {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = text;
    element.className = `status-${type}`;
  }

  // 显示连接状态面板
  const statusPanel = document.getElementById('connection-status');
  if (statusPanel && isMobileDebugMode()) {
    statusPanel.style.display = 'block';
  }
}

function showToast(message, variant = 'info', duration = 3200) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.variant = variant;
  elements.toast.classList.remove('hidden');
  requestAnimationFrame(() => {
    elements.toast.classList.add('visible');
  });
  state.toastTimer = setTimeout(() => {
    elements.toast.classList.remove('visible');
  }, duration);
}

function updateUiFromState() {
  const { game } = state;
  if (!game) {
    return;
  }

  const moveCount = countPlacedStones(game.board);
  elements.turnNumber.textContent = (game.turnNumber !== undefined && game.turnNumber !== null) ? game.turnNumber : moveCount;
  elements.moveCount.textContent = moveCount;

  const statusText = {
    waiting: '等待玩家加入',
    playing: '对局进行中',
    finished: '对局已结束'
  }[(game.status && game.status.phase)] || '对局状态未知';

  elements.gameStatus.textContent = statusText;

  if (game.players && game.players.black) {
    elements.playerBlackName.textContent = game.players.black.displayName;
  }
  if (game.players && game.players.white) {
    elements.playerWhiteName.textContent = game.players.white.displayName;
  }

  updatePlayerCard('black');
  updatePlayerCard('white');
  renderSkillGrid();
  updateSubtitleFromState();
}

function updatePlayerCard(color) {
  const card = elements.playerCards[color];
  if (!card || !state.game) {
    return;
  }
  const turnElement = color === 'black' ? elements.playerBlackTurn : elements.playerWhiteTurn;
  const isActive = state.game.currentTurn === color && !state.game.winner;
  const freezeTurns = (state.game.freeze && state.game.freeze[color]) || 0;

  card.classList.toggle('active', isActive);
  card.classList.toggle('frozen', freezeTurns > 0);

  if (state.game.winner === color) {
    turnElement.textContent = '已获胜';
  } else if (state.game.winner) {
    turnElement.textContent = '对局结束';
  } else if (freezeTurns > 0) {
    turnElement.textContent = `冻结中（剩余 ${freezeTurns} 回合）`;
  } else if (isActive) {
    turnElement.textContent = '进行中';
  } else {
    turnElement.textContent = '等待中';
  }
}

function renderSkillGrid() {
  const { game } = state;
  if (!game || !game.skills) {
    elements.skillGrid.innerHTML = '<p class="empty-hint">等待数据...</p>';
    return;
  }

  const owner = state.color || 'black';
  const skillList = game.skills[owner] || [];
  const ownerName = (game.players && game.players[owner] && game.players[owner].displayName) || (owner === 'black' ? '子琪' : '张呈');
  elements.skillsPanelTitle.textContent = `技能冷却（${ownerName}）`;

  const canOperate = canOperateNow();
  const fragment = document.createDocumentFragment();

  skillList.forEach((skill) => {
    const card = document.createElement('div');
    card.className = 'skill-card';
    card.dataset.skillId = skill.id;

    const statusTag = document.createElement('span');
    statusTag.classList.add('status-tag');

    if (skill.used) {
      card.classList.add('used');
      statusTag.classList.add('used');
      statusTag.textContent = '已使用';
    } else if (!skill.available) {
      card.classList.add('disabled');
      statusTag.classList.add('cooldown');
      statusTag.textContent = `冷却 ${skill.remainingCooldown}`;
    } else if (!canOperate || owner !== state.color) {
      card.classList.add('disabled');
      statusTag.classList.add('ready');
      statusTag.textContent = '待机';
    } else {
      statusTag.classList.add('ready');
      statusTag.textContent = '就绪';
    }

    if (state.selection && state.selection.skill && state.selection.skill.id === skill.id) {
      card.classList.add('selected');
    }

    card.innerHTML = `
      <header>
        <span class="skill-name">${skill.name}</span>
        <span class="cooldown">CD ${skill.cooldown}</span>
      </header>
      <p class="skill-desc">${skill.description}</p>
    `;
    card.appendChild(statusTag);

    if (!card.classList.contains('disabled') && !card.classList.contains('used')) {
      card.addEventListener('click', () => handleSkillClick(skill));
    }

    fragment.appendChild(card);
  });

  elements.skillGrid.innerHTML = '';
  elements.skillGrid.appendChild(fragment);
}

function handleSkillClick(skill) {
  if (!canOperateNow()) {
    showToast('当前无法使用技能（可能未轮到你或处于冻结状态）', 'warning');
    return;
  }

  const meta = SKILL_META[skill.id];
  if (!meta) {
    // 播放技能音效
    audioManager.playSkillSound(skill.id);
    // 触发技能特效
    EffectManager.createSkillEffect(skill.id);
    sendMessage('skill', { skillId: skill.id });
    return;
  }

  if (meta.confirm && !window.confirm(meta.confirm)) {
    return;
  }

  if (meta.requiresInput) {
    const turn = window.prompt(meta.prompt, '0');
    if (turn === null) {
      return;
    }
    const parsed = Number.parseInt(turn, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      showToast('请输入合法的回合号', 'warning');
      return;
    }
    // 播放技能音效
    audioManager.playSkillSound(skill.id);
    // 触发技能特效
    EffectManager.createSkillEffect(skill.id);
    sendMessage('skill', { skillId: skill.id, data: { turnNumber: parsed } });
    return;
  }

  if (meta.targetType === 'opponent') {
    startTargetSelection(skill, meta);
    return;
  }

  // 播放技能音效
  audioManager.playSkillSound(skill.id);
  // 触发技能特效
  EffectManager.createSkillEffect(skill.id);
  sendMessage('skill', { skillId: skill.id });
}

function startTargetSelection(skill, meta) {
  const validTargets = computeValidTargets(meta);
  if (!validTargets.length) {
    showToast('当前没有可选的敌方棋子', 'warning');
    return;
  }
  state.selection = {
    skill,
    meta,
    targets: [],
    validTargets
  };
  updateSubtitleFromState();
  drawBoard();
}

function cancelSelection(message) {
  state.selection = null;
  if (message) {
    showToast(message, 'info');
  }
  updateSubtitleFromState();
  drawBoard();
}

function computeValidTargets(meta) {
  if (!state.game) {
    return [];
  }
  const opponent = state.color === 'black' ? 'white' : 'black';
  const valid = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (state.game.board?.[y]?.[x] === opponent) {
        valid.push({ x, y });
      }
    }
  }
  return valid;
}

function handleBoardClick(event) {
  const cell = locateCell(event);
  if (!cell) {
    // 在开发模式下，可以取消注释下面的代码来调试触摸精度
    // console.log('No cell located for event:', event.type, getInputPoint(event));
    return;
  }

  if (state.selection) {
    handleSelectionClick(cell);
    return;
  }

  if (!canOperateNow()) {
    const reason = getOperationBlockReason();
    if (reason) {
      console.warn('[board] 阻止落子:', reason, {
        role: state.role,
        color: state.color,
        currentTurn: state.game?.currentTurn,
        freeze: state.game?.freeze
      });
      showToast(reason, 'warning');
    } else {
      showToast('当前无法落子', 'warning');
    }
    return;
  }


  if (state.game?.board?.[cell.y]?.[cell.x]) {
    showToast('该位置已有棋子', 'warning');
    return;
  }

  // 播放落子音效
  audioManager.playMoveSound();
  sendMessage('move', cell);
}

function handleSelectionClick(cell) {
  const selection = state.selection;
  if (!selection) {
    return;
  }
  const key = `${cell.x},${cell.y}`;
  const isValid = selection.validTargets.some((target) => target.x === cell.x && target.y === cell.y);
  if (!isValid) {
    showToast('该位置不是有效目标', 'warning');
    return;
  }

  const existingIndex = selection.targets.findIndex((target) => target.x === cell.x && target.y === cell.y);
  if (existingIndex >= 0) {
    selection.targets.splice(existingIndex, 1);
  } else {
    if (selection.meta.maxTargets && selection.targets.length >= selection.meta.maxTargets) {
      showToast(`最多可选择 ${selection.meta.maxTargets} 个目标`, 'warning');
      return;
    }
    selection.targets.push(cell);
  }

  if (selection.targets.length > 0 && (!selection.meta.maxTargets || selection.targets.length === selection.meta.maxTargets)) {
    // 播放技能音效
    audioManager.playSkillSound(selection.skill.id);
    // 在每个目标位置创建特效
    selection.targets.forEach(target => {
      EffectManager.createSkillEffect(selection.skill.id, target.x, target.y);
    });

    sendMessage('skill', {
      skillId: selection.skill.id,
      data: { positions: selection.targets }
    });
    state.selection = null;
  }

  updateSubtitleFromState();
  drawBoard();
}

function handleBoardHover(event) {
  // 多点触摸时忽略
  if (event && event.touches && event.touches.length > 1) {
    return;
  }

  // Pointer事件的非主要触摸点忽略
  if (event && typeof event.isPrimary === 'boolean' && event.isPrimary === false) {
    return;
  }

  // 对于触摸设备，在touchstart时提供即时反馈
  const isTouchStart = event.type === 'touchstart';
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth <= 768 ||
    ('ontouchstart' in window);

  const cell = locateCell(event);
  const changed = (state.hoverCell && state.hoverCell.x !== (cell && cell.x)) || (state.hoverCell && state.hoverCell.y !== (cell && cell.y));

  if (changed) {
    state.hoverCell = cell;
    drawBoard();

    // 移动设备上的触摸反馈
    if (isMobile && isTouchStart && cell && navigator.vibrate) {
      navigator.vibrate(10); // 轻微震动反馈
    }
  }
}

function clearHoverCell() {
  if (!state.hoverCell) {
    return;
  }
  state.hoverCell = null;
  drawBoard();
}


function getInputPoint(event) {
  if (!event) {
    return null;
  }

  // 优先处理触摸事件，确保获取正确的触摸点
  if (event.touches && event.touches.length > 0) {
    return event.touches[0];
  }

  // 处理触摸结束事件
  if (event.changedTouches && event.changedTouches.length > 0) {
    return event.changedTouches[0];
  }

  // 处理鼠标事件
  if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
    return event;
  }

  return null;
}

function locateCell(event) {
  const canvas = elements.boardCanvas;
  if (!canvas) {
    return null;
  }
  const point = getInputPoint(event);
  if (!point) {
    return null;
  }

  // 获取更精确的边界矩形
  const rect = canvas.getBoundingClientRect();
  const size = rect.width;
  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }

  const gap = (size - BOARD_PADDING * 2) / (BOARD_SIZE - 1);
  if (!Number.isFinite(gap) || gap <= 0) {
    return null;
  }

  // 计算相对坐标，考虑可能的滚动偏移
  const relativeX = (point.clientX - rect.left) - BOARD_PADDING;
  const relativeY = (point.clientY - rect.top) - BOARD_PADDING;

  const x = relativeX / gap;
  const y = relativeY / gap;
  const gridX = Math.round(x);
  const gridY = Math.round(y);

  // 边界检查
  if (gridX < 0 || gridX >= BOARD_SIZE || gridY < 0 || gridY >= BOARD_SIZE) {
    return null;
  }

  // 动态调整容差：移动设备使用更大的容差，桌面设备使用较小的容差
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth <= 768 ||
    ('ontouchstart' in window);

  // 根据gap大小和设备类型调整容差
  const baseTolerance = isMobile ? 0.6 : 0.4;
  const tolerance = Math.min(baseTolerance, gap / 20); // 确保容差不会太大

  const dx = Math.abs(gridX - x);
  const dy = Math.abs(gridY - y);

  if (dx > tolerance || dy > tolerance) {
    return null;
  }

  return { x: gridX, y: gridY };
}

function adjustCanvasSize() {
  const canvas = elements.boardCanvas;
  if (!canvas) {
    return;
  }

  // 获取容器宽度作为基准
  const appShell = document.querySelector('.app-shell');
  const skillsPanel = elements.skillGrid?.parentElement;
  const playersContainer = document.querySelector('.players-banner');

  let targetWidth = 0;

  // 优先使用技能面板宽度作为参考
  if (skillsPanel) {
    targetWidth = skillsPanel.getBoundingClientRect().width;
  }
  // 其次使用玩家卡片容器宽度
  else if (playersContainer) {
    targetWidth = playersContainer.getBoundingClientRect().width;
  }
  // 最后使用app容器宽度
  else if (appShell) {
    targetWidth = appShell.getBoundingClientRect().width - 80; // 减去padding
  }

  // 如果都获取不到，使用父容器宽度
  if (!targetWidth || targetWidth <= 0) {
    const parent = canvas.parentElement;
    const parentWidth = parent ? parent.clientWidth : 0;
    targetWidth = parentWidth > 0 ? parentWidth : 400;
  }

  // 减去棋盘容器的padding
  const boardSection = canvas.closest('.board-section');
  if (boardSection) {
    const computedStyle = window.getComputedStyle(boardSection);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
    targetWidth = Math.max(220, targetWidth - paddingLeft - paddingRight);
  }

  let size = targetWidth;

  // 移动端适配
  const isCompact = window.innerWidth <= 720;
  if (isCompact) {
    const viewportHeight = (window.visualViewport && window.visualViewport.height) || window.innerHeight || size;
    const reservedForPanels = Math.min(Math.max(viewportHeight * 0.4, 240), 380);
    const availableHeight = viewportHeight - reservedForPanels - 72;
    const mobileLimit = Math.max(220, Math.min(availableHeight, viewportHeight * 0.62));
    size = Math.min(size, mobileLimit);
  }

  // 设置最小和最大尺寸限制
  size = Math.max(220, Math.min(size, 800));

  const dpr = window.devicePixelRatio || 1;
  canvas.style.maxWidth = '100%';
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.width = Math.max(1, Math.floor(size * dpr));
  canvas.height = Math.max(1, Math.floor(size * dpr));
}




function drawBoard() {
  const canvas = elements.boardCanvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  const size = canvas.width / dpr;
  const playableSize = size - BOARD_PADDING * 2;
  const gap = playableSize / (BOARD_SIZE - 1);

  ctx.clearRect(0, 0, size, size);

  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#f4d8aa');
  gradient.addColorStop(1, '#d7b07c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(48, 28, 12, 0.8)';
  ctx.lineWidth = 1;

  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const offset = BOARD_PADDING + i * gap;
    ctx.beginPath();
    ctx.moveTo(BOARD_PADDING, offset);
    ctx.lineTo(size - BOARD_PADDING, offset);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(offset, BOARD_PADDING);
    ctx.lineTo(offset, size - BOARD_PADDING);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(48, 28, 12, 0.9)';
  STAR_POINTS.forEach(([gx, gy]) => {
    const { x, y } = gridToPixel(gx, gy, gap);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  if (state.selection) {
    ctx.fillStyle = 'rgba(59, 169, 255, 0.16)';
    state.selection.validTargets.forEach(({ x, y }) => {
      const pos = gridToPixel(x, y, gap);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, gap * 0.4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  if (state.game?.board) {
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const cell = state.game.board[y][x];
        if (cell) {
          drawStone(ctx, cell, gridToPixel(x, y, gap), gap);
        }
      }
    }
  }

  if (state.selection) {
    ctx.strokeStyle = 'rgba(59, 169, 255, 0.9)';
    ctx.lineWidth = 2;
    state.selection.targets.forEach(({ x, y }) => {
      const { x: px, y: py } = gridToPixel(x, y, gap);
      ctx.beginPath();
      ctx.arc(px, py, gap * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  if (state.game?.lastPlacement) {
    const { x, y } = state.game.lastPlacement;
    const { x: px, y: py } = gridToPixel(x, y, gap);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, gap * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (state.hoverCell && canOperateNow() && !state.selection) {
    const { x, y } = gridToPixel(state.hoverCell.x, state.hoverCell.y, gap);
    ctx.fillStyle = 'rgba(59, 169, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(x, y, gap * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

function gridToPixel(gridX, gridY, gap) {
  return {
    x: BOARD_PADDING + gridX * gap,
    y: BOARD_PADDING + gridY * gap
  };
}

function drawStone(ctx, color, position, gap) {
  const radius = gap * 0.42;
  const gradient = ctx.createRadialGradient(position.x - radius * 0.4, position.y - radius * 0.4, radius * 0.2, position.x, position.y, radius);

  if (color === 'black') {
    gradient.addColorStop(0, '#5a5a5a');
    gradient.addColorStop(1, '#141414');
  } else {
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#d7d7d7');
  }

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

function canOperateNow() {
  return !getOperationBlockReason();
}

function getOperationBlockReason() {
  if (!state.game) {
    return '棋局状态尚未同步，请稍候';
  }
  if (state.role !== 'player') {
    return '当前为观战身份，无法落子';
  }
  if (state.game.winner) {
    return '对局已结束';
  }
  if (state.game.currentTurn !== state.color) {
    const opponentName = state.color === 'black'
      ? ((state.game.players && state.game.players.white && state.game.players.white.displayName) || '白方')
      : ((state.game.players && state.game.players.black && state.game.players.black.displayName) || '黑方');
    return `等待 ${opponentName} 落子`;
  }
  const freezeTurns = (state.game.freeze && state.game.freeze[state.color]) || 0;
  if (freezeTurns > 0) {
    return `你被“静如止水”冻结，还需等待 ${freezeTurns} 回合`;
  }
  return null;
}

function updateSubtitleFromState() {
  if (state.selection) {
    const { meta, targets } = state.selection;
    const done = targets.length;
    const total = meta.maxTargets || 1;
    updateSubtitle(`${meta.instruction}（${done}/${total}）`);
    return;
  }

  const { game } = state;
  if (!game) {
    updateSubtitle('等待服务器同步数据...');
    return;
  }

  if (game.winner) {
    const name = game.winner === 'black'
      ? ((game.players && game.players.black && game.players.black.displayName) || '子琪')
      : ((game.players && game.players.white && game.players.white.displayName) || '张呈');
    updateSubtitle(`对局结束，${name} 获胜`);
    return;
  }

  if (!game.players || !game.players.black || !game.players.white) {
    updateSubtitle('等待另一位玩家加入...');
    return;
  }

  if (state.role !== 'player') {
    const actor = game.currentTurn === 'black'
      ? (game.players.black.displayName || '子琪')
      : (game.players.white.displayName || '张呈');
    updateSubtitle(`观战中，轮到 ${actor}`);
    return;
  }

  const freezeTurns = (game.freeze && game.freeze[state.color]) || 0;
  if (freezeTurns > 0) {
    updateSubtitle(`你被静如止水冻结，还需等待 ${freezeTurns} 回合`);
    return;
  }

  if (game.currentTurn === state.color) {
    updateSubtitle('轮到你落子或使用技能');
  } else {
    const opponent = state.color === 'black'
      ? ((game.players && game.players.white && game.players.white.displayName) || '张呈')
      : ((game.players && game.players.black && game.players.black.displayName) || '子琪');
    updateSubtitle(`等待 ${opponent} 行动`);
  }
}

function updateSubtitle(text) {
  elements.subtitle.textContent = text;

  // 移动端额外显示连接状态
  if (isMobileDebugMode()) {
    console.log('状态更新:', text);

    // 如果连接失败，自动显示调试面板
    if (text.includes('失败') || text.includes('断开') || text.includes('超时')) {
      setTimeout(() => {
        const debugToggle = document.getElementById('debug-toggle');
        if (debugToggle && debugToggle.style.display !== 'none') {
          debugToggle.style.background = 'rgba(255, 0, 0, 0.8)';
          debugToggle.textContent = '❗';
        }
      }, 1000);
    }
  }
}

function countPlacedStones(board) {
  if (!board) {
    return 0;
  }
  let count = 0;
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[y][x]) {
        count += 1;
      }
    }
  }
  return count;
}

// 移动设备检测
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth <= 768 ||
    ('ontouchstart' in window);
}

// 特效管理器
const EffectManager = {
  // 创建技能特效
  createSkillEffect(skillId, x = null, y = null) {
    // 获取技能名称
    const skillNames = {
      'flying-sand': '飞沙走石',
      'yale-ya': '呀嘞呀',
      'calm-water': '静如止水',
      'capture': '擒拿擒拿',
      'rewind': '时光倒流',
      'reset-board': '力拔山兮',
      'restore': '东山再起',
      'see-you-again': 'See you again'
    };

    const skillName = skillNames[skillId] || skillId;

    // 创建飞字特效
    this.createSkillFlyText(skillName, x, y);

    // 创建原有的特效
    const effect = document.createElement('div');
    effect.className = `skill-effect ${skillId}`;

    // 如果提供了坐标，在该位置显示特效
    if (x !== null && y !== null) {
      const canvas = elements.boardCanvas;
      const rect = canvas.getBoundingClientRect();
      const size = rect.width;
      const gap = (size - BOARD_PADDING * 2) / (BOARD_SIZE - 1);
      const pixelX = rect.left + BOARD_PADDING + x * gap;
      const pixelY = rect.top + BOARD_PADDING + y * gap;

      effect.style.left = `${pixelX - 25}px`;
      effect.style.top = `${pixelY - 25}px`;
      effect.style.width = '50px';
      effect.style.height = '50px';
    } else {
      // 在屏幕中央显示
      effect.style.left = '50%';
      effect.style.top = '50%';
      effect.style.transform = 'translate(-50%, -50%)';
      effect.style.width = '100px';
      effect.style.height = '100px';
    }

    elements.effectOverlay.appendChild(effect);

    // 800ms后移除特效
    setTimeout(() => {
      if (effect.parentNode) {
        effect.parentNode.removeChild(effect);
      }
    }, 800);
  },

  // 创建技能飞字特效
  createSkillFlyText(skillName, x = null, y = null) {
    const flyText = document.createElement('div');
    flyText.className = 'skill-fly-text';
    flyText.textContent = skillName;

    let startX, startY;

    // 如果提供了棋盘坐标，从该位置开始
    if (x !== null && y !== null) {
      const canvas = elements.boardCanvas;
      const rect = canvas.getBoundingClientRect();
      const size = rect.width;
      const gap = (size - BOARD_PADDING * 2) / (BOARD_SIZE - 1);
      startX = rect.left + BOARD_PADDING + x * gap;
      startY = rect.top + BOARD_PADDING + y * gap;
    } else {
      // 从屏幕中心开始，考虑移动端视口
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      startX = viewportWidth / 2;
      startY = viewportHeight / 2;
    }

    // 确保起始位置在视口内
    startX = Math.max(50, Math.min(startX, (window.innerWidth || 320) - 50));
    startY = Math.max(50, Math.min(startY, (window.innerHeight || 568) - 50));

    flyText.style.left = startX + 'px';
    flyText.style.top = startY + 'px';

    elements.effectOverlay.appendChild(flyText);

    // 触发动画
    requestAnimationFrame(() => {
      flyText.classList.add('animate');
    });

    // 动画结束后移除元素
    setTimeout(() => {
      if (flyText.parentNode) {
        flyText.parentNode.removeChild(flyText);
      }
    }, 2000);
  },

  // 创建获胜特效
  createVictoryEffect(winner) {
    const winnerName = (state.game && state.game.players && state.game.players[winner] && state.game.players[winner].displayName) || (winner === 'black' ? '子琪' : '张呈');

    // 播放胜利音效
    audioManager.playVictorySound(winner);

    // 创建获胜弹窗
    this.createVictoryModal(winner, winnerName);

    // 背景闪光
    const victoryBg = document.createElement('div');
    victoryBg.className = 'victory-effect';
    elements.effectOverlay.appendChild(victoryBg);

    // 烟花特效（移动端延迟启动以避免性能问题）
    const delay = isMobileDevice() ? 300 : 0;
    setTimeout(() => {
      this.createFireworks();
    }, delay);

    // 震动效果（移动端支持触觉反馈）
    if (isMobileDevice() && navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
    document.body.classList.add('shake-effect');

    setTimeout(() => {
      if (victoryBg.parentNode) {
        victoryBg.parentNode.removeChild(victoryBg);
      }
      document.body.classList.remove('shake-effect');
    }, 2000);
  },

  // 创建获胜弹窗
  createVictoryModal(winner, winnerName) {
    const modal = document.createElement('div');
    modal.className = 'victory-modal';

    const winnerText = winner === 'black' ? '黑棋获胜' : '白棋获胜';
    const winnerEmoji = winner === 'black' ? '⚫' : '⚪';

    modal.innerHTML = `
      <div class="victory-content">
        <div class="victory-crown">${winnerEmoji}</div>
        <h2 class="victory-title">🎉 游戏结束 🎉</h2>
        <p class="victory-winner">${winnerText}</p>
        <div class="victory-celebration">
          🎊 🎉 🎊 🎉 🎊
        </div>
        <div class="victory-stats">
          <div class="stat-item">
            <span class="stat-label">回合数</span>
            <span class="stat-value">${(state.game && state.game.turnNumber) || 0}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">步数</span>
            <span class="stat-value">${countPlacedStones(state.game && state.game.board)}</span>
          </div>
        </div>
        <button class="victory-close">
          确定
        </button>
      </div>
    `;

    elements.effectOverlay.appendChild(modal);

    // 添加点击事件监听器
    const closeButton = modal.querySelector('.victory-close');
    closeButton.addEventListener('click', () => {
      this.closeVictoryModal();
    });

    // 触发动画
    requestAnimationFrame(() => {
      modal.classList.add('show');
    });
  },

  // 关闭获胜弹窗
  closeVictoryModal() {
    const modal = elements.effectOverlay.querySelector('.victory-modal');
    if (modal) {
      modal.classList.add('hide');
      setTimeout(() => {
        if (modal.parentNode) {
          modal.parentNode.removeChild(modal);
        }
      }, 300);
    }
  },

  // 创建烟花特效
  createFireworks() {
    const colors = ['gold', 'red', 'blue', 'green'];
    const isMobile = window.innerWidth <= 768;

    // 移动端减少烟花数量和位置
    const positions = isMobile ? [
      { x: '25%', y: '35%' },
      { x: '75%', y: '30%' },
      { x: '50%', y: '25%' }
    ] : [
      { x: '20%', y: '30%' },
      { x: '80%', y: '25%' },
      { x: '15%', y: '70%' },
      { x: '85%', y: '65%' },
      { x: '50%', y: '20%' }
    ];

    const fireworkCount = isMobile ? 6 : 8;
    const maxDistance = isMobile ? 35 : 50;

    positions.forEach((pos, index) => {
      setTimeout(() => {
        for (let i = 0; i < fireworkCount; i++) {
          const firework = document.createElement('div');
          firework.className = `firework ${colors[Math.floor(Math.random() * colors.length)]}`;
          firework.style.left = pos.x;
          firework.style.top = pos.y;

          // 随机方向，移动端距离更小
          const angle = (i * (360 / fireworkCount)) * Math.PI / 180;
          const distance = (maxDistance * 0.7) + Math.random() * (maxDistance * 0.3);
          firework.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
          firework.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);

          elements.effectOverlay.appendChild(firework);

          setTimeout(() => {
            if (firework.parentNode) {
              firework.parentNode.removeChild(firework);
            }
          }, 1500);
        }
      }, index * 200);
    });
  },

  // 创建粒子特效
  createParticles(x, y, color = '#ffd700', count = 6) {
    const canvas = elements.boardCanvas;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const size = rect.width;
    const gap = (size - BOARD_PADDING * 2) / (BOARD_SIZE - 1);
    const pixelX = rect.left + BOARD_PADDING + x * gap;
    const pixelY = rect.top + BOARD_PADDING + y * gap;

    // 移动端减少粒子数量
    const isMobile = window.innerWidth <= 768;
    const particleCount = isMobile ? Math.max(3, Math.floor(count * 0.6)) : count;
    const spreadRange = isMobile ? 15 : 20;

    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.backgroundColor = color;

      // 确保粒子位置在视口内
      const offsetX = (Math.random() - 0.5) * spreadRange;
      const offsetY = (Math.random() - 0.5) * spreadRange;
      const finalX = Math.max(5, Math.min(pixelX + offsetX, window.innerWidth - 5));
      const finalY = Math.max(5, Math.min(pixelY + offsetY, window.innerHeight - 5));

      particle.style.left = `${finalX}px`;
      particle.style.top = `${finalY}px`;

      elements.effectOverlay.appendChild(particle);

      setTimeout(() => {
        if (particle.parentNode) {
          particle.parentNode.removeChild(particle);
        }
      }, 2000);
    }
  },

  // 闪光特效
  flashEffect(element) {
    element.classList.add('flash-effect');
    setTimeout(() => {
      element.classList.remove('flash-effect');
    }, 300);
  }
};

// 移动端调试功能
let debugLog = [];
let originalConsoleLog = console.log;
let originalConsoleError = console.error;
let originalConsoleWarn = console.warn;

function isMobileDebugMode() {
  return window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function addDebugLog(message, type = 'log') {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
  debugLog.push(logEntry);

  // 保持最近100条日志
  if (debugLog.length > 100) {
    debugLog.shift();
  }

  // 更新调试面板
  const debugLogElement = document.getElementById('debug-log');
  if (debugLogElement) {
    debugLogElement.textContent = debugLog.join('\n');
    debugLogElement.scrollTop = debugLogElement.scrollHeight;
  }
}

// 重写console方法以捕获日志
if (isMobileDebugMode()) {
  console.log = function (...args) {
    originalConsoleLog.apply(console, args);
    addDebugLog(args.join(' '), 'log');
  };

  console.error = function (...args) {
    originalConsoleError.apply(console, args);
    addDebugLog(args.join(' '), 'error');
  };

  console.warn = function (...args) {
    originalConsoleWarn.apply(console, args);
    addDebugLog(args.join(' '), 'warn');
  };
}

function toggleMobileDebug() {
  const debugPanel = document.getElementById('mobile-debug');
  const debugToggle = document.getElementById('debug-toggle');

  if (debugPanel.style.display === 'none') {
    debugPanel.style.display = 'flex';
    debugToggle.style.display = 'none';
  } else {
    debugPanel.style.display = 'none';
    debugToggle.style.display = 'block';
  }
}

function clearDebugLog() {
  debugLog = [];
  const debugLogElement = document.getElementById('debug-log');
  if (debugLogElement) {
    debugLogElement.textContent = '';
  }
}

function testConnection() {
  addDebugLog('用户手动测试连接', 'info');
  handleReconnect();
}

// 显示调试按钮（仅移动端）
if (isMobileDebugMode()) {
  document.addEventListener('DOMContentLoaded', () => {
    const debugToggle = document.getElementById('debug-toggle');
    if (debugToggle) {
      debugToggle.style.display = 'block';
    }
  });
}

// 全局错误处理
window.addEventListener('error', function (event) {
  console.error('JavaScript错误:', event.error);
});

window.addEventListener('unhandledrejection', function (event) {
  console.error('未处理的Promise拒绝:', event.reason);
});

init();


