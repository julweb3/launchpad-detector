(() => {
  if (window.__launchpadDetectorInjected) {
    return;
  }
  window.__launchpadDetectorInjected = true;

  // Detect which site we're on
  const hostname = window.location.hostname;
  const isAxiom = hostname.includes('axiom.trade');
  const isGmgn = hostname.includes('gmgn.ai');

  // Axiom token container classes
  const AXIOM_ROOT_CLASSES = [
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

  const AXIOM_NAME_CLASSES = [
    'text-textPrimary',
    'text-[16px]',
    'font-medium',
    'tracking-[-0.02em]',
    'truncate'
  ];

  // GMGN token container classes (stable across different screen sizes)
  const GMGN_ROOT_CLASSES = [
    'relative',
    'flex',
    'overflow-hidden',
    'cursor-pointer'
  ];

  const GMGN_NAME_PARENT_CLASSES = [
    'flex',
    'items-center',
    'min-w-0',
    'overflow-hidden',
    'text-base',
    'gap-x-4px',
    'whitespace-nowrap',
    'leading-[20px]',
    'h-[20px]'
  ];

  const GMGN_NAME_CLASSES = [
    'whitespace-nowrap',
    'font-medium',
    'text-[16px]',
    'overflow-hidden',
    'text-ellipsis',
    'flex-shrink-0'
  ];

  const seenMints = new Set();
  const mintConfigs = new Map();

  const SCAN_DEBOUNCE_MS = 300;
  const SCROLL_DEBOUNCE_MS = 300;
  let scanTimer = null;
  let reobserveCallback = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'TOKEN_DETECTED' || !message.token) {
      return;
    }

    const { mint, label, color } = message.token;
    if (!mint) {
      return;
    }

    mintConfigs.set(mint, {
      label: label || '[TOKEN]',
      color: color || '#ff0000'
    });

    requestScan();
  });

  requestInitialTokens();
  hookScrollAndVisibility();
  setupIntersectionObserver();

  function scanAndApplyBadges() {
    if (!mintConfigs.size) {
      return;
    }

    let containers = [];
    let rootClasses = [];
    let selector = '';

    if (isAxiom) {
      selector = 'div.flex.flex-row.w-full';
      containers = document.querySelectorAll(selector);
      rootClasses = AXIOM_ROOT_CLASSES;
    } else if (isGmgn) {
      selector = 'div[href*="/token/"]';
      containers = document.querySelectorAll(selector);
      rootClasses = GMGN_ROOT_CLASSES;
    } else {
      return;
    }

    containers.forEach((container) => {
      // For Axiom, check classes. For GMGN, skip class check (href selector is enough)
      if (isAxiom && !hasAllClasses(container, rootClasses)) {
        return;
      }

      const mint = extractMintFromContainer(container);

      if (mint && mintConfigs.has(mint)) {
        const config = mintConfigs.get(mint);
        decorateRoot(container, mint, config);
      }
    });
  }

  function extractMintFromContainer(container) {
    // Check if container itself has href attribute (GMGN uses divs with href)
    if (container.hasAttribute('href')) {
      const href = container.getAttribute('href');
      const mint = extractMintFromHref(href);
      if (mint) {
        return mint;
      }
    }

    // Check links inside container (Axiom case)
    const links = container.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const mint = extractMintFromHref(href);
      if (mint) {
        return mint;
      }
    }

    // Check data attributes
    const dataElements = container.querySelectorAll('[data-mint], [data-address], [data-token]');
    for (const el of dataElements) {
      const mint = el.getAttribute('data-mint')
                || el.getAttribute('data-address')
                || el.getAttribute('data-token');
      if (mint && mint.length >= 32) {
        return mint;
      }
    }

    return null;
  }

  function extractMintFromHref(href) {
    if (!href) return null;

    // Common patterns: /token/ADDRESS (any chain), ?address=ADDRESS, /ADDRESS
    const patterns = [
      /\/token\/([a-zA-Z0-9]{32,})/,          // /token/ADDRESS (matches /sol/token/, /bsc/token/, /eth/token/, etc.)
      /[?&]address=([a-zA-Z0-9]{32,})/,       // ?address=ADDRESS
      /[?&]mint=([a-zA-Z0-9]{32,})/,          // ?mint=ADDRESS
      /\/([a-zA-Z0-9]{32,})$/                 // /ADDRESS (at end)
    ];

    for (const pattern of patterns) {
      const match = href.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  function hasAllClasses(element, classes) {
    return classes.every((cls) => element.classList.contains(cls));
  }

  function decorateRoot(root, mint, config) {
    const nameElement = findNameSpan(root);
    if (!nameElement) {
      return;
    }

    let badge = root.querySelector('.launchpad-detector-label');

    if (isAxiom) {
      // Axiom: insert badge after the name span
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'launchpad-detector-label';
        badge.style.fontWeight = '600';
        badge.style.display = 'inline';
        badge.style.verticalAlign = 'baseline';
        badge.style.marginLeft = '4px';
        nameElement.insertAdjacentElement('afterend', badge);
        badge.textContent = config.label;
        badge.style.background = 'transparent';
        badge.style.color = config.color;
      } else if (badge.textContent !== config.label || badge.style.color !== config.color) {
        // Only update if changed
        badge.textContent = config.label;
        badge.style.color = config.color;
      }
    } else if (isGmgn) {
      // GMGN: insert badge div into the parent flex container after the first child (token name)
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'launchpad-detector-label whitespace-nowrap font-medium text-[16px] flex-shrink-0';
        // Insert after the first child (token name div)
        if (nameElement.children.length > 0) {
          nameElement.insertBefore(badge, nameElement.children[1]);
        } else {
          nameElement.appendChild(badge);
        }
        badge.textContent = config.label;
        badge.style.color = config.color;
      } else if (badge.textContent !== config.label || badge.style.color !== config.color) {
        // Only update if changed
        badge.textContent = config.label;
        badge.style.color = config.color;
      }
    }

    if (!seenMints.has(mint)) {
      seenMints.add(mint);
    }
  }

  function findNameSpan(root) {
    if (isAxiom) {
      const spans = root.querySelectorAll('span');
      for (const span of spans) {
        if (hasAllClasses(span, AXIOM_NAME_CLASSES)) {
          return span;
        }
      }
      return null;
    } else if (isGmgn) {
      // For GMGN, find the parent flex container that holds the token name
      const divs = root.querySelectorAll('div');
      for (const div of divs) {
        if (hasAllClasses(div, GMGN_NAME_PARENT_CLASSES)) {
          return div;
        }
      }
      return null;
    }
    return null;
  }

  function requestScan(immediate = false) {
    if (immediate) {
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
      scanAndApplyBadges();
      return;
    }

    if (scanTimer) {
      return;
    }

    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanAndApplyBadges();
    }, SCAN_DEBOUNCE_MS);
  }

  let mutationDebounceTimer = null;
  const observer = new MutationObserver((mutations) => {
    let foundNewContainer = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length) {
        // Check if any added nodes are containers or contain containers
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the node itself is a token container
            let isContainer = false;
            if (isAxiom) {
              isContainer = hasAllClasses(node, AXIOM_ROOT_CLASSES);
            } else if (isGmgn) {
              isContainer = node.hasAttribute && node.hasAttribute('href') &&
                           node.getAttribute('href').includes('/token/');
            }

            if (isContainer) {
              foundNewContainer = true;
              break;
            }

            // Check if the node contains containers
            const selector = isAxiom ? 'div.flex.flex-row.w-full' : 'div[href*="/token/"]';
            const childContainers = node.querySelectorAll ? node.querySelectorAll(selector) : [];
            if (childContainers.length > 0) {
              foundNewContainer = true;
              break;
            }
          }
        }
        if (foundNewContainer) break;
      }
    }

    if (foundNewContainer) {
      // Debounce mutations to avoid excessive scans
      if (mutationDebounceTimer) {
        clearTimeout(mutationDebounceTimer);
      }

      mutationDebounceTimer = setTimeout(() => {
        requestScan(true);
        if (reobserveCallback) reobserveCallback();
      }, 100);
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
          return;
        }
        if (!response || !Array.isArray(response.tokens)) {
          return;
        }
        response.tokens.forEach((token) => {
          if (!token || !token.mint) {
            return;
          }
          mintConfigs.set(token.mint, {
            label: token.label || '[TOKEN]',
            color: token.color || '#ff0000'
          });
        });
        requestScan(true);
      });
    } catch (err) {
      // ignore
    }
  }

  function hookScrollAndVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestScan(true);
      }
    });

    window.addEventListener('focus', () => {
      requestScan(true);
    });

    window.addEventListener('pageshow', () => {
      requestScan(true);
    });

    let scrollTimer = null;
    const onScroll = () => {
      // Clear existing timer
      if (scrollTimer) {
        clearTimeout(scrollTimer);
      }

      // Debounce scroll scans
      scrollTimer = setTimeout(() => {
        requestScan();
      }, SCROLL_DEBOUNCE_MS);
    };

    window.addEventListener('scroll', onScroll, true);
  }

  function setupIntersectionObserver() {
    const selector = isAxiom ? 'div.flex.flex-row.w-full' : 'div[href*="/token/"]';
    const observedContainers = new WeakSet();

    const intersectionObserver = new IntersectionObserver((entries) => {
      let needsScan = false;
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const container = entry.target;
          const hasBadge = container.querySelector('.launchpad-detector-label');
          if (!hasBadge && mintConfigs.size > 0) {
            needsScan = true;
          }
        }
      });

      if (needsScan) {
        requestScan(true);
      }
    }, {
      root: null,
      threshold: 0.1
    });

    const observeContainers = () => {
      const containers = document.querySelectorAll(selector);

      containers.forEach(container => {
        if (!observedContainers.has(container)) {
          intersectionObserver.observe(container);
          observedContainers.add(container);
        }
      });
    };

    // Initial observe after page loads
    setTimeout(observeContainers, 1000);

    let reobserveTimer = null;
    reobserveCallback = () => {
      if (reobserveTimer) return;
      reobserveTimer = setTimeout(() => {
        reobserveTimer = null;
        observeContainers();
      }, 1000);
    };
  }
})();
