// Background service worker – connects to backend WebSocket and tags tokens
const WS_ENDPOINT = 'wss://launchpaddetectorbackend-dev.fly.dev';
const RECONNECT_DELAY_MS = 5000;
const BADGE_IDLE = '●';
const HEARTBEAT_INTERVAL_MS = 30000;
const DEFAULT_UXENTO_COLOR = '#ff0000';
const DEFAULT_RAPID_COLOR = '#1e88e5';
const SUPPORTED_SITES = ['*://axiom.trade/*', '*://gmgn.ai/*'];
const TOKEN_CACHE_KEY = 'launchpadTokenCache';
const TOKEN_CACHE_MAX = 300;

let ws = null;
let reconnectTimer = null;
let wsConnected = false;
let notificationsEnabled = true;
let uxentoEnabled = true;
let uxentoColor = '#ff0000';
let rapidEnabled = true;
let rapidColor = DEFAULT_RAPID_COLOR;
let heartbeatInterval = null;
let sitesActive = false;

const seenMints = new Set();
let tokensDetected = 0;
const launchpadCounts = {
  uxento: 0,
  rapid: 0,
  other: 0
};
const tokenStyles = new Map();

chrome.storage.sync.get([
  'notificationsEnabled',
  'uxentoEnabled',
  'rapidEnabled',
  'uxentoColor',
  'rapidColor'
], (result) => {
  notificationsEnabled = result.notificationsEnabled !== false;
  uxentoEnabled = result.uxentoEnabled !== false;
  rapidEnabled = result.rapidEnabled !== false;
  if (typeof result.uxentoColor === 'string') {
    uxentoColor = result.uxentoColor;
  }
  if (typeof result.rapidColor === 'string') {
    rapidColor = result.rapidColor;
  }
  evaluateSiteActivity();
});

loadCachedTokens();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;
  if (Object.prototype.hasOwnProperty.call(changes, 'notificationsEnabled')) {
    notificationsEnabled = changes.notificationsEnabled.newValue !== false;
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'uxentoEnabled')) {
    uxentoEnabled = changes.uxentoEnabled.newValue !== false;
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'rapidEnabled')) {
    rapidEnabled = changes.rapidEnabled.newValue !== false;
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'uxentoColor')) {
    const value = changes.uxentoColor.newValue;
    if (typeof value === 'string') {
      uxentoColor = value;
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'rapidColor')) {
    const value = changes.rapidColor.newValue;
    if (typeof value === 'string') {
      rapidColor = value;
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'notificationsEnabled') && changes.notificationsEnabled.newValue === true) {
    notifyStatus('Notifications enabled', 'You will receive alerts for new launchpad tokens.');
  }
});

chrome.tabs.onUpdated.addListener(handleTabEvent);
chrome.tabs.onActivated.addListener(handleTabEvent);
chrome.tabs.onRemoved.addListener(handleTabEvent);

function connect() {
  clearTimeout(reconnectTimer);
  if (!sitesActive) {
    wsConnected = false;
    stopHeartbeat();
    chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
    return;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    console.log(`[ws] connecting -> ${WS_ENDPOINT}`);
    ws = new WebSocket(WS_ENDPOINT);
  } catch (err) {
    console.error('Failed to create WebSocket:', err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[ws] connected');
    wsConnected = true;
    startHeartbeat();
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    updateBadge();
  };

  ws.onmessage = (event) => {
    handleMessage(event.data);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    wsConnected = false;
    stopHeartbeat();
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close();
      } catch (closeErr) {
        console.debug('Error closing WebSocket after failure:', closeErr);
      }
    }
  };

  ws.onclose = () => {
    console.warn('[ws] closed');
    wsConnected = false;
    stopHeartbeat();
    ws = null;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
  if (!sitesActive) {
    return;
  }
  reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
}

function disconnect(reason) {
  clearTimeout(reconnectTimer);
  stopHeartbeat();
  wsConnected = false;
  if (!ws) {
    return;
  }
  try {
    console.log('[ws] disconnecting', reason || '');
    ws.close(1000, reason || 'axiom inactive');
  } catch (err) {
    console.debug('Error closing WebSocket:', err);
  }
  ws = null;
  chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
}

function handleMessage(raw) {
  // Handle pong response
  if (raw === 'pong') {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    console.debug('Ignoring non-JSON message:', raw);
    return;
  }

  if (Array.isArray(payload)) {
    payload.forEach(handleTokenMessage);
  } else {
    handleTokenMessage(payload);
  }
}

function handleTokenMessage(message) {
  if (!message || message.type !== 'new_token' || !message.token || !message.token.mint) {
    return;
  }

  const token = message.token;
  const mint = String(token.mint);
  const launchpadKey = classifyLaunchpad(token.launchpad);
  if (seenMints.has(mint)) {
    return;
  }
  if (!launchpadKey) {
    launchpadCounts.other += 1;
    return;
  }

  if (!isLaunchpadEnabled(launchpadKey)) {
    return;
  }

  seenMints.add(mint);
  tokensDetected += 1;
  updateBadge();

  console.log('[token]', token);

  incrementLaunchpadCount(launchpadKey);

  tokenStyles.set(mint, {
    launchpad: launchpadKey
  });

  const label = launchpadKey;
  const color = getLaunchpadColor(launchpadKey);

  cacheToken(mint, launchpadKey);

  if (notificationsEnabled) {
    createNotification(token.name || 'Unknown', mint, label);
  }

  broadcastToContent({
    type: 'TOKEN_DETECTED',
    token: {
      mint,
      label,
      color
    }
  });
}

function classifyLaunchpad(value) {
  if (!value) return null;
  const lower = String(value).toLowerCase();
  if (lower.includes('uxento')) return 'UXENTO';
  if (lower.includes('rapid')) return 'RAPIDLAUNCH';
  return null;
}

function emitNotification(notificationId, options, logData = null) {
  const emit = () => {
    if (logData) {
      console.log('[notification]', ...logData);
    }
    chrome.notifications.create(notificationId, options, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.debug('Notification error:', err.message);
      }
    });
    autoClearNotification(notificationId);
  };

  if (typeof chrome.notifications.getPermissionLevel === 'function') {
    chrome.notifications.getPermissionLevel((level) => {
      if (level === 'granted') {
        emit();
      } else {
        console.warn('Notifications suppressed - permission level:', level);
      }
    });
  } else {
    emit();
  }
}

function createNotification(name, mint, label) {
  const notificationId = `launchpad-${mint}-${Date.now()}`;
  const options = {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon.png'),
    title: `${label} token detected`,
    message: `${name}\nMint: ${mint.slice(0, 8)}...`,
    priority: 2
  };
  emitNotification(notificationId, options, [label, name, mint]);
}

function notifyStatus(title, message) {
  const notificationId = `status-${Date.now()}`;
  const options = {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon.png'),
    title,
    message,
    priority: 0
  };
  emitNotification(notificationId, options);
}

function broadcastToContent(message) {
  chrome.tabs.query({ url: SUPPORTED_SITES }, (tabs) => {
    tabs.forEach((tab) => {
      if (!tab || typeof tab.id !== 'number') return;
      chrome.tabs.sendMessage(tab.id, message, () => {
        const err = chrome.runtime.lastError;
        if (err && !err.message?.includes('Receiving end does not exist')) {
          console.debug('Content message delivery failed:', err.message);
        }
      });
    });
  });
}

function updateBadge() {
  if (!tokensDetected) {
    chrome.action.setBadgeText({ text: BADGE_IDLE });
    return;
  }
  const text = tokensDetected > 999 ? '999+' : tokensDetected.toString();
  chrome.action.setBadgeText({ text });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      stopHeartbeat();
      scheduleReconnect();
      return;
    }
    try {
      ws.send('ping');
    } catch (err) {
      console.debug('Heartbeat send failed:', err);
      stopHeartbeat();
      scheduleReconnect();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.type) return false;

  if (request.type === 'GET_STATS') {
    sendResponse({
      wsConnected,
      tokensDetected,
      counts: {
        uxento: launchpadCounts.uxento,
        rapid: launchpadCounts.rapid,
        other: launchpadCounts.other
      }
    });
    return true;
  }

  if (request.type === 'RESET_STATE') {
    seenMints.clear();
    tokensDetected = 0;
    resetLaunchpadCounts();
    tokenStyles.clear();
    updateBadge();
    chrome.storage.local.remove(TOKEN_CACHE_KEY);
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'UPDATE_FILTER') {
    const { launchpad, enabled } = request;
    if (launchpad === 'uxento') {
      uxentoEnabled = enabled !== false;
    } else if (launchpad === 'rapid') {
      rapidEnabled = enabled !== false;
    }
    return true;
  }

  if (request.type === 'UPDATE_COLOR') {
    const { launchpad, color } = request;
    if (typeof color === 'string') {
      if (launchpad === 'uxento') {
        uxentoColor = color;
      } else if (launchpad === 'rapid') {
        rapidColor = color;
      }
    }
    return true;
  }

  if (request.type === 'REQUEST_TOKENS') {
    const tokens = [];
    tokenStyles.forEach((metadata, mint) => {
      if (!metadata || !metadata.launchpad) {
        return;
      }
      if (!isLaunchpadEnabled(metadata.launchpad)) {
        return;
      }
      tokens.push({
        mint,
        label: metadata.launchpad,
        color: getLaunchpadColor(metadata.launchpad)
      });
    });
    sendResponse({ tokens });
    return true;
  }

  return false;
});

chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
chrome.action.setBadgeText({ text: BADGE_IDLE });
evaluateSiteActivity();

const LAUNCHPAD_CONFIG = {
  UXENTO: {
    getEnabled: () => uxentoEnabled,
    getColor: () => uxentoColor || DEFAULT_UXENTO_COLOR,
    countKey: 'uxento'
  },
  RAPIDLAUNCH: {
    getEnabled: () => rapidEnabled,
    getColor: () => rapidColor || DEFAULT_RAPID_COLOR,
    countKey: 'rapid'
  }
};

function isLaunchpadEnabled(key) {
  return LAUNCHPAD_CONFIG[key]?.getEnabled() || false;
}

function getLaunchpadColor(key) {
  return LAUNCHPAD_CONFIG[key]?.getColor() || DEFAULT_UXENTO_COLOR;
}

function incrementLaunchpadCount(key) {
  const config = LAUNCHPAD_CONFIG[key];
  if (config) {
    launchpadCounts[config.countKey] += 1;
  } else {
    launchpadCounts.other += 1;
  }
}

function resetLaunchpadCounts() {
  launchpadCounts.uxento = 0;
  launchpadCounts.rapid = 0;
  launchpadCounts.other = 0;
}

function handleTabEvent() {
  evaluateSiteActivity();
}

function evaluateSiteActivity() {
  chrome.tabs.query({ url: SUPPORTED_SITES }, (tabs) => {
    const hasSites = Array.isArray(tabs) && tabs.length > 0;
    if (hasSites === sitesActive) {
      return;
    }
    sitesActive = hasSites;
    if (sitesActive) {
      connect();
    } else {
      disconnect('sites closed');
    }
  });
}

function autoClearNotification(notificationId) {
  setTimeout(() => {
    try {
      chrome.notifications.clear(notificationId, () => {
        const err = chrome.runtime.lastError;
        if (err && !/Invalid notification id/i.test(err.message || '')) {
          console.debug('Notification clear error:', err.message);
        }
      });
    } catch (err) {
      console.debug('Notification clear threw error:', err);
    }
  }, 10000);
}

function loadCachedTokens() {
  chrome.storage.local.get([TOKEN_CACHE_KEY], (result) => {
    const err = chrome.runtime.lastError;
    if (err) {
      console.debug('Token cache load error:', err.message);
    }
    const cached = Array.isArray(result?.[TOKEN_CACHE_KEY]) ? result[TOKEN_CACHE_KEY] : [];
    cached.forEach((entry) => {
      if (!entry || !entry.mint || !entry.launchpad) {
        return;
      }
      if (seenMints.has(entry.mint)) {
        return;
      }
      seenMints.add(entry.mint);
      tokenStyles.set(entry.mint, { launchpad: entry.launchpad });
      incrementLaunchpadCount(entry.launchpad);
    });
    tokensDetected = seenMints.size;
    updateBadge();
  });
}

function cacheToken(mint, launchpad) {
  chrome.storage.local.get([TOKEN_CACHE_KEY], (result) => {
    const err = chrome.runtime.lastError;
    if (err) {
      console.debug('Token cache read error:', err.message);
    }
    const cache = Array.isArray(result?.[TOKEN_CACHE_KEY]) ? result[TOKEN_CACHE_KEY] : [];
    if (cache.some((item) => item && item.mint === mint)) {
      return;
    }
    cache.push({ mint, launchpad, timestamp: Date.now() });
    if (cache.length > TOKEN_CACHE_MAX) {
      cache.splice(0, cache.length - TOKEN_CACHE_MAX);
    }
    chrome.storage.local.set({ [TOKEN_CACHE_KEY]: cache }, () => {
      const writeErr = chrome.runtime.lastError;
      if (writeErr) {
        console.debug('Token cache write error:', writeErr.message);
      }
    });
  });
}
