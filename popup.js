// Popup script - handles settings, theme, and stats

const notificationToggle = document.getElementById('notificationToggle');
const uxentoToggle = document.getElementById('uxentoToggle');
const rapidToggle = document.getElementById('rapidToggle');
const tokensDetected = document.getElementById('tokensDetected');
const uxentoColorInput = document.getElementById('uxentoColor');
const uxentoColorBar = document.getElementById('uxentoColorBar');
const rapidColorInput = document.getElementById('rapidColor');
const rapidColorBar = document.getElementById('rapidColorBar');
const wsStatus = document.getElementById('wsStatus');
const wsStatusNote = document.getElementById('wsStatusNote');
const launchpadCountsList = document.getElementById('launchpadCounts');
const resetDefaultsLink = document.getElementById('resetDefaults');
const domainNotice = document.getElementById('domainNotice');
const permissionNotice = document.getElementById('permissionNotice');
const permissionMessage = document.getElementById('permissionMessage');
const enableAxiomButton = document.getElementById('enableAxiomAccess');
const themeToggle = document.getElementById('themeToggle');
const themeToggleIcon = document.getElementById('themeToggleIcon');
const pageBody = document.body;

let currentDarkMode = true;
let hasAxiomPermission = false;

function safeSendMessage(message, callback) {
  chrome.runtime.sendMessage(message, (response) => {
    const error = chrome.runtime.lastError || null;
    if (error) {
      console.debug('Message error:', error.message);
    }
    if (typeof callback === 'function') {
      callback(response, error);
    }
  });
}

function applyTheme(isDark) {
  currentDarkMode = isDark;
  pageBody.classList.toggle('dark', isDark);
  pageBody.classList.toggle('light', !isDark);
  if (themeToggleIcon) {
    themeToggleIcon.src = isDark ? 'icon_sun.svg' : 'icon_moon.svg';
    themeToggleIcon.style.filter = '';
  }
}

chrome.storage.sync.get([
  'notificationsEnabled',
  'uxentoEnabled',
  'rapidEnabled',
  'uxentoColor',
  'rapidColor',
  'darkModeEnabled'
], (result) => {
  notificationToggle.checked = result.notificationsEnabled !== false;
  uxentoToggle.checked = result.uxentoEnabled !== false;
  rapidToggle.checked = result.rapidEnabled !== false;
  const color = result.uxentoColor || '#ff0000';
  uxentoColorInput.value = color;
  uxentoColorBar.style.background = color;
  const rapidColor = result.rapidColor || '#1e88e5';
  rapidColorInput.value = rapidColor;
  rapidColorBar.style.background = rapidColor;
  const darkModeEnabled = result.darkModeEnabled !== false; // default to dark
  applyTheme(darkModeEnabled);
  launchpadCountsList.textContent = 'No launchpad data yet.';
});

notificationToggle.addEventListener('change', (event) => {
  const enabled = event.target.checked;
  chrome.storage.sync.set({ notificationsEnabled: enabled });
});

uxentoToggle.addEventListener('change', (event) => {
  const enabled = event.target.checked;
  chrome.storage.sync.set({ uxentoEnabled: enabled }, () => {
    safeSendMessage({ type: 'UPDATE_FILTER', launchpad: 'uxento', enabled });
  });
});

rapidToggle.addEventListener('change', (event) => {
  const enabled = event.target.checked;
  chrome.storage.sync.set({ rapidEnabled: enabled }, () => {
    safeSendMessage({ type: 'UPDATE_FILTER', launchpad: 'rapid', enabled });
  });
});

uxentoColorInput.addEventListener('input', (event) => {
  const color = event.target.value || '#ff0000';
  uxentoColorBar.style.background = color;
  chrome.storage.sync.set({ uxentoColor: color }, () => {
    safeSendMessage({ type: 'UPDATE_COLOR', launchpad: 'uxento', color });
  });
});

rapidColorInput.addEventListener('input', (event) => {
  const color = event.target.value || '#1e88e5';
  rapidColorBar.style.background = color;
  chrome.storage.sync.set({ rapidColor: color }, () => {
    safeSendMessage({ type: 'UPDATE_COLOR', launchpad: 'rapid', color });
  });
});

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const nextTheme = !currentDarkMode;
    chrome.storage.sync.set({ darkModeEnabled: nextTheme }, () => {
      applyTheme(nextTheme);
    });
  });
}

if (enableAxiomButton) {
  enableAxiomButton.addEventListener('click', () => {
    if (enableAxiomButton.disabled) {
      return;
    }
    enableAxiomButton.disabled = true;
    if (permissionMessage) {
      permissionMessage.textContent = 'Requesting access to axiom.trade…';
    }
    safeSendMessage({ type: 'REQUEST_AXIOM_ACCESS' }, (response, error) => {
      enableAxiomButton.disabled = false;
      if (error) {
        if (permissionMessage) {
          permissionMessage.textContent = 'Could not request permission. Please try again.';
        }
        return;
      }
      if (response && response.granted) {
        if (permissionMessage) {
          permissionMessage.textContent = 'Access granted. Open axiom.trade to start detecting.';
        }
        setPermissionState(true);
        updateStats();
      } else if (permissionMessage) {
        permissionMessage.textContent = 'Permission was not granted. You can enable it anytime.';
      }
    });
  });
}

resetDefaultsLink.addEventListener('click', () => {
  chrome.storage.sync.set({
    notificationsEnabled: true,
    uxentoEnabled: true,
    rapidEnabled: true,
    uxentoColor: '#ff0000',
    rapidColor: '#1e88e5',
    darkModeEnabled: true
  }, () => {
    notificationToggle.checked = true;
    uxentoToggle.checked = true;
    rapidToggle.checked = true;
    uxentoColorInput.value = '#ff0000';
    uxentoColorBar.style.background = '#ff0000';
    rapidColorInput.value = '#1e88e5';
    rapidColorBar.style.background = '#1e88e5';
    applyTheme(true);
    safeSendMessage({ type: 'RESET_STATE' });
    updateStats();
  });
});

function updateStats() {
  safeSendMessage({ type: 'GET_STATS' }, (response) => {
    const permissionGranted = Boolean(response && response.hasPermission);
    setPermissionState(permissionGranted);

    if (!response) {
      wsStatus.textContent = 'Offline';
      wsStatus.className = 'ws-status disconnected';
      if (wsStatusNote) {
        wsStatusNote.textContent = '';
        wsStatusNote.hidden = true;
      }
      return;
    }

    const { wsConnected, tokensDetected: total, counts = {} } = response;

    tokensDetected.textContent = total || 0;
    if (wsConnected) {
      wsStatus.textContent = 'Connected';
      wsStatus.className = 'ws-status connected';
      if (wsStatusNote) {
        wsStatusNote.textContent = '';
        wsStatusNote.hidden = true;
      }
    } else {
      wsStatus.textContent = 'Offline';
      wsStatus.className = 'ws-status disconnected';
      if (wsStatusNote) {
        wsStatusNote.textContent = '';
        wsStatusNote.hidden = true;
      }
    }

    if (permissionGranted) {
      renderLaunchpadCounts(counts);
    }
  });
}

function renderLaunchpadCounts(counts) {
  const parts = [];
  if (typeof counts.uxento === 'number') {
    parts.push(`Uxento: ${counts.uxento}`);
  }
  if (typeof counts.rapid === 'number') {
    parts.push(`RapidLaunch: ${counts.rapid}`);
  }
  launchpadCountsList.textContent = parts.length ? parts.join('\n') : 'No launchpad data yet.';
}

function setPermissionState(granted) {
  hasAxiomPermission = granted;
  if (permissionNotice) {
    permissionNotice.hidden = granted;
  }
  if (permissionMessage && !granted) {
    permissionMessage.textContent = 'This extension needs access to axiom.trade to tag launchpad tokens.';
  }

  const controls = [notificationToggle, uxentoToggle, rapidToggle, uxentoColorInput, rapidColorInput];
  controls.forEach((control) => {
    if (control) {
      control.disabled = !granted;
    }
  });

  if (granted) {
    refreshDomainState();
  } else if (domainNotice) {
    domainNotice.hidden = true;
    launchpadCountsList.textContent = 'Grant axiom.trade permission to begin detection.';
    tokensDetected.textContent = '0';
    wsStatus.textContent = 'Offline';
    wsStatus.className = 'ws-status disconnected';
  }
}

function setDomainEnabled(isAxiom) {
  if (!domainNotice) return;
  if (!hasAxiomPermission) {
    domainNotice.hidden = true;
    return;
  }
  domainNotice.hidden = !!isAxiom;
}

function refreshDomainState() {
  if (!hasAxiomPermission) {
    setDomainEnabled(false);
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    let isAxiom = false;
    if (tab && tab.url) {
      try {
        const { hostname } = new URL(tab.url);
        isAxiom = hostname === 'axiom.trade' || hostname.endsWith('.axiom.trade');
      } catch (err) {
        // ignore
      }
    }
    setDomainEnabled(isAxiom);
  });
}

setPermissionState(false);
updateStats();
refreshDomainState();
setInterval(updateStats, 4000);
