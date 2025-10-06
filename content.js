(() => {
  if (window.__launchpadDetectorInjected) {
    return;
  }
  window.__launchpadDetectorInjected = true;

  const TOKEN_ROOT_CLASSES = [
    'flex',
    'flex-row',
    'w-full',
    'gap-[12px]',
    'pl-[12px]',
    'pr-[12px]',
    'sm:pr-[16px]',
    'pt-[12px]',
    'pb-[2px]',
    'justify-start',
    'items-center'
  ];

  const TOKEN_NAME_CLASSES = [
    'text-textPrimary',
    'text-[16px]',
    'font-medium',
    'tracking-[-0.02em]',
    'truncate'
  ];

  const seenMints = new Set();
  const mintConfigs = new Map();
  const mintTimers = new Map();

  const REAPPLY_DELAY_MS = 100;
  const SCROLL_REAPPLY_DEBOUNCE_MS = 120;
  let reapplyTimer = null;
  window.__launchpadLastScrollAt = window.__launchpadLastScrollAt || 0;

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'TOKEN_DETECTED' || !message.token) {
      return;
    }

    const { mint, label, color } = message.token;
    if (!mint) {
      return;
    }

    scheduleBadge(mint, {
      label: label || '[TOKEN]',
      color: color || '#ff0000'
    });
  });

  requestInitialTokens();
  hookScrollAndVisibility();

  function scheduleBadge(mint, config, attempt = 0) {
    mintConfigs.set(mint, config);
    clearPendingTimer(mint);
    if (applyBadge(mint, config)) {
      clearPendingTimer(mint);
      return;
    }
    if (attempt >= 10) {
      console.debug(`launchpad detector: unable to locate ${mint} on page.`);
      clearPendingTimer(mint);
      return;
    }
    const timeoutId = setTimeout(() => {
      mintTimers.delete(mint);
      scheduleBadge(mint, config, attempt + 1);
    }, 350);
    mintTimers.set(mint, timeoutId);
  }

  function applyBadge(mint, config) {
    const roots = findRootsForMint(mint);
    if (!roots.length) {
      return false;
    }

    roots.forEach((root) => decorateRoot(root, mint, config));
    return true;
  }

  function findRootsForMint(mint) {
    const roots = new Set();
    const escapedMint = escapeForSelector(mint);
    const selectors = [
      `a[href*="${escapedMint}"]`,
      `[data-mint*="${escapedMint}"]`,
      `[data-token*="${escapedMint}"]`,
      `[data-address*="${escapedMint}"]`,
      `[data-url*="${escapedMint}"]`,
      `[src*="${escapedMint}"]`
    ];

    selectors.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((node) => {
          const root = findTokenRoot(node);
          if (root) {
            roots.add(root);
          }
        });
      } catch (err) {
        // ignore selector errors
      }
    });

    if (!roots.size) {
      document.querySelectorAll('div.flex.flex-row.w-full').forEach((candidate) => {
        if (hasAllClasses(candidate, TOKEN_ROOT_CLASSES) && candidate.innerHTML.includes(mint)) {
          roots.add(candidate);
        }
      });
    }

    return Array.from(roots);
  }

  function findTokenRoot(node) {
    let current = node instanceof HTMLElement ? node : node.parentElement;
    while (current && current !== document.body) {
      if (current instanceof HTMLElement && hasAllClasses(current, TOKEN_ROOT_CLASSES)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function hasAllClasses(element, classes) {
    return classes.every((cls) => element.classList.contains(cls));
  }

  function decorateRoot(root, mint, config) {
    const nameSpan = findNameSpan(root);
    if (!nameSpan) {
      return;
    }

    let badge = root.querySelector('.launchpad-detector-label');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'launchpad-detector-label';
      badge.style.fontWeight = '600';
      badge.style.display = 'inline';
      badge.style.verticalAlign = 'baseline';
      nameSpan.insertAdjacentElement('afterend', badge);
    }

    badge.textContent = config.label;
    badge.style.background = 'transparent';
    badge.style.color = config.color;

    clearPendingTimer(mint);

    if (!seenMints.has(mint)) {
      seenMints.add(mint);
      root.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function findNameSpan(root) {
    const spans = root.querySelectorAll('span');
    for (const span of spans) {
      if (hasAllClasses(span, TOKEN_NAME_CLASSES)) {
        return span;
      }
    }
    return root.querySelector('span.text-textPrimary') || spans[0] || null;
  }

  function escapeForSelector(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function clearPendingTimer(mint) {
    const timerId = mintTimers.get(mint);
    if (timerId) {
      clearTimeout(timerId);
      mintTimers.delete(mint);
    }
  }

  function requestReapply(immediate = false) {
    if (!mintConfigs.size) {
      return;
    }
    if (immediate) {
      if (reapplyTimer) {
        clearTimeout(reapplyTimer);
        reapplyTimer = null;
      }
      mintConfigs.forEach((config, mint) => {
        scheduleBadge(mint, config);
      });
      return;
    }
    if (reapplyTimer) {
      return;
    }
    reapplyTimer = setTimeout(() => {
      reapplyTimer = null;
      mintConfigs.forEach((config, mint) => {
        scheduleBadge(mint, config);
      });
    }, REAPPLY_DELAY_MS);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && (mutation.addedNodes.length || mutation.removedNodes.length)) {
        requestReapply();
        break;
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  function requestInitialTokens() {
    try {
      chrome.runtime.sendMessage({ type: 'REQUEST_TOKENS' }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          if (!/Receiving end does not exist/i.test(err.message || '')) {
            console.debug('Initial token request failed:', err.message);
          }
          return;
        }
        if (!response || !Array.isArray(response.tokens)) {
          return;
        }
        response.tokens.forEach((token) => {
          if (!token || !token.mint) {
            return;
          }
          scheduleBadge(token.mint, {
            label: token.label || '[TOKEN]',
            color: token.color || '#ff0000'
          });
        });
      });
    } catch (err) {
      console.debug('Initial token request threw error:', err);
    }
  }

  function hookScrollAndVisibility() {
    const rebroadcast = () => {
      const configEntries = Array.from(mintConfigs.entries());
      configEntries.forEach(([mint, cfg]) => {
        scheduleBadge(mint, cfg);
      });
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        rebroadcast();
      }
    });

    window.addEventListener('focus', rebroadcast);
    window.addEventListener('pageshow', rebroadcast);

    const onScroll = () => {
      const now = Date.now();
      if (now - window.__launchpadLastScrollAt < SCROLL_REAPPLY_DEBOUNCE_MS) {
        return;
      }
      window.__launchpadLastScrollAt = now;
      mintConfigs.forEach((cfg, mint) => {
        scheduleBadge(mint, cfg);
      });
    };

    window.addEventListener('scroll', onScroll, true);
  }
})();
