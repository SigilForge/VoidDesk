// For Web view: gently help downloads by promoting obvious http(s) file URLs.
// Let native browser handling manage <a download> and blob/data URLs to avoid losing data.
(() => {
  const FILE_RX = /\.(png|jpe?g|gif|webp|svg|mp4|zip|pdf|txt|json|bin|csv|mp3|wav|webm)(\?|$)/i;

  function shouldPromoteHttpFile(href) {
    if (!href) return false;
    return /^https?:/i.test(href) && FILE_RX.test(href);
  }

  function findAnchor(el) {
    return el && (el.tagName === 'A' ? el : el.closest?.('a')) || null;
  }

  // 1) Intercept programmatic a.click() for obvious http(s) file links only
  const origAClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (...args) {
    try {
      const href = this.getAttribute('href') || this.href || '';
      if (shouldPromoteHttpFile(href)) {
        window.open(href, '_blank');
        return; // swallow original click
      }
    } catch {}
    return origAClick.apply(this, args);
  };

  // 2) Capture real user clicks and promote http(s) file links only
  window.addEventListener('click', (e) => {
    try {
      const a = findAnchor(e.target);
      if (a) {
        const href = a.getAttribute('href') || a.href || '';
        if (shouldPromoteHttpFile(href)) {
          e.preventDefault();
          e.stopPropagation();
          window.open(href, '_blank');
          return;
        }
      }
    } catch {}
  }, true);
})();

// Allow scrolling inside ChatGPT project folders and their chat lists.
(() => {
  const host = (window.location?.hostname || '').toLowerCase();
  if (!/chat(openai|gpt)\.com$/.test(host) && !host.endsWith('.chat.openai.com')) {
    return; // Only patch the ChatGPT experience; skip other embeds such as the playground.
  }

  const TARGET_SELECTORS = [
    '[data-testid*="tree" i]',
    '[data-testid*="folder" i]',
    '[data-testid*="project" i]',
    '[data-testid*="conversation" i]',
    '[data-testid*="thread" i]',
    '[data-radix-scroll-area-viewport]',
    '[data-radix-scroll-area-content]',
    '[role="tree"]',
    '[role="group"]'
  ];
  const TARGET_SELECTOR = TARGET_SELECTORS.join(',');

  const LIST_CONTENT_SELECTOR = [
    'li',
    '[role="treeitem"]',
    '[data-testid*="tree-item" i]',
    '[data-testid*="folder-item" i]',
    '[data-testid*="conversation" i]',
    '[data-testid*="thread" i]',
    'a[href*="/g/"]',
    'a[href*="/share/"]'
  ].join(',');

  const CONTEXT_SELECTOR = 'nav,aside,main,[data-testid*="sidebar" i],[data-testid*="project" i],[data-testid*="folder" i],[data-testid*="workspace" i]';

  const tracked = new Set();
  let measurePending = false;
  const MIN_HEIGHT = 200;
  const VIEWPORT_PADDING = 16;

  const descriptorFor = (el) => {
    if (!(el instanceof HTMLElement)) return '';
    const parts = [
      el.getAttribute('role') || '',
      el.getAttribute('data-testid') || '',
      el.getAttribute('aria-label') || '',
      el.id || ''
    ];
    const className = typeof el.className === 'string' ? el.className : '';
    if (className) parts.push(className);
    return parts.join(' ').toLowerCase();
  };

  const looksListLike = (node) => {
    if (!(node instanceof HTMLElement)) return false;
    if (node.children.length >= 3) return true;
    try {
      return !!node.querySelector(LIST_CONTENT_SELECTOR);
    } catch {
      return false;
    }
  };

  const shouldHandle = (node) => {
    if (!(node instanceof HTMLElement)) return false;
    if (node.dataset?.voiddeskScrollFix === '1') return false;
    if (!node.matches(TARGET_SELECTOR)) return false;
    if (!node.closest(CONTEXT_SELECTOR)) return false;
    if (!looksListLike(node)) return false;

    const descriptor = descriptorFor(node);
    if (/tree|folder|project|conversation|thread|history|workspace|list/.test(descriptor)) {
      return true;
    }

    const parentDescriptor = descriptorFor(node.parentElement);
    return /tree|folder|project|conversation|thread|history|workspace|list/.test(parentDescriptor);
  };

  const markFlexParents = (node) => {
    let current = node.parentElement;
    while (current && current !== document.body) {
      if (current.dataset?.voiddeskFlexPatched === '1') {
        current = current.parentElement;
        continue;
      }
      try {
        const style = window.getComputedStyle(current);
        if (style.display === 'flex' || style.display === 'inline-flex') {
          current.style.setProperty('min-height', '0', 'important');
          current.dataset.voiddeskFlexPatched = '1';
        } else if (style.display === 'grid') {
          current.style.setProperty('min-height', '0', 'important');
          current.style.setProperty('align-content', 'stretch', 'important');
          current.dataset.voiddeskFlexPatched = '1';
        }
      } catch {}
      current = current.parentElement;
    }
  };

  const updateMaxHeight = (node) => {
    if (!(node instanceof HTMLElement) || !node.isConnected) {
      tracked.delete(node);
      return;
    }
    let viewportHeight = window.innerHeight;
    if (!viewportHeight) {
      viewportHeight = document.documentElement?.clientHeight || 0;
    }
    if (!viewportHeight) return;
    try {
      const rect = node.getBoundingClientRect();
      if (!rect || !Number.isFinite(rect.top)) return;
      const available = Math.max(
        MIN_HEIGHT,
        Math.round(viewportHeight - rect.top - VIEWPORT_PADDING)
      );
      if (available > 0) {
        node.style.setProperty('max-height', `${available}px`, 'important');
      }
    } catch {}
  };

  const scheduleMeasure = () => {
    if (measurePending) return;
    measurePending = true;
    try {
      window.requestAnimationFrame(() => {
        measurePending = false;
        tracked.forEach((node) => updateMaxHeight(node));
      });
    } catch {
      measurePending = false;
    }
  };

  const applyScrollFix = (node) => {
    if (!shouldHandle(node)) return;
    node.dataset.voiddeskScrollFix = '1';
    try {
      node.style.setProperty('overflow-y', 'auto', 'important');
      node.style.setProperty('overscroll-behavior', 'contain', 'important');
      node.style.setProperty('scrollbar-gutter', 'stable both-edges', 'important');
      node.style.setProperty('-webkit-overflow-scrolling', 'touch', 'important');
    } catch {}
    markFlexParents(node);
    tracked.add(node);
    scheduleMeasure();
  };

  const scan = (root) => {
    if (!root) return;
    if (root instanceof HTMLElement) {
      applyScrollFix(root);
    }
    const elements = typeof root.querySelectorAll === 'function'
      ? root.querySelectorAll(TARGET_SELECTOR)
      : [];
    elements.forEach((el) => applyScrollFix(el));
  };

  const init = () => {
    try {
      scan(document.documentElement || document);
    } catch {}

    try {
      const observer = new MutationObserver((mutations) => {
        let touched = false;
        for (const mut of mutations) {
          if (mut.type === 'attributes' && mut.target instanceof HTMLElement) {
            applyScrollFix(mut.target);
            touched = true;
          }
          mut.addedNodes.forEach?.((node) => {
            if (node instanceof HTMLElement) {
              scan(node);
              touched = true;
            }
          });
          mut.removedNodes.forEach?.((node) => {
            if (node instanceof HTMLElement && tracked.has(node)) {
              tracked.delete(node);
            }
          });
        }
        if (touched) scheduleMeasure();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'role', 'data-testid', 'aria-label']
      });
      window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
    } catch {}

    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('orientationchange', scheduleMeasure);
    window.addEventListener('pageshow', scheduleMeasure);
    window.addEventListener('load', scheduleMeasure);
    scheduleMeasure();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
