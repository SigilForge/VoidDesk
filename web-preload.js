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

// Allow scrolling within nested project folders in the ChatGPT sidebar.
(() => {
  const host = (window.location?.hostname || '').toLowerCase();
  if (!/chat(openai|gpt)\.com$/.test(host) && !host.endsWith('.chat.openai.com')) {
    return; // Only patch the ChatGPT sidebar; skip playground or other domains.
  }

  const STYLE_ID = 'voiddesk-sidebar-scroll-style';
  const GROUP_SELECTOR = '[role="treeitem"] [role="group"]';
  const NAV_ROOT_SELECTOR = 'nav,aside';
  const EXTRA_TARGETS = [
    'div[data-radix-scroll-area-viewport]',
    '[data-testid="tree-item-list"]',
    'ol',
    'ul'
  ];

  const applyScrollFix = (el) => {
    if (!(el instanceof HTMLElement)) return;
    if (!el.closest(NAV_ROOT_SELECTOR)) return;
    el.style.setProperty('max-height', 'min(65vh, 560px)', 'important');
    el.style.setProperty('overflow-y', 'auto', 'important');
    el.style.setProperty('overscroll-behavior', 'contain', 'important');
    el.style.setProperty('scrollbar-gutter', 'stable both-edges');
    el.style.setProperty('-webkit-overflow-scrolling', 'touch');
  };

  const ensureStyle = () => {
    try {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        nav [role="treeitem"] [role="group"],
        nav [role="treeitem"] [role="group"] div[data-radix-scroll-area-viewport],
        nav [role="treeitem"] [role="group"] [data-testid="tree-item-list"],
        nav [role="treeitem"] [role="group"] ol,
        nav [role="treeitem"] [role="group"] ul {
          max-height: min(65vh, 560px) !important;
          overflow-y: auto !important;
          overscroll-behavior: contain !important;
          scrollbar-gutter: stable both-edges;
          -webkit-overflow-scrolling: touch;
        }
      `;
      document.head?.appendChild(style);
    } catch {}
  };

  const patchGroups = (root = document) => {
    try {
      const scope = root.querySelectorAll?.(GROUP_SELECTOR) || [];
      scope.forEach((group) => {
        if (!(group instanceof HTMLElement)) return;
        if (!group.closest(NAV_ROOT_SELECTOR)) return;
        applyScrollFix(group);
        EXTRA_TARGETS.forEach((selector) => {
          group.querySelectorAll?.(selector)?.forEach?.((node) => applyScrollFix(node));
        });
      });
    } catch {}
  };

  const init = () => {
    ensureStyle();
    patchGroups(document);
    try {
      const observer = new MutationObserver((mutations) => {
        for (const mut of mutations) {
          if (mut.type === 'attributes') {
            applyScrollFix(mut.target);
          }
          for (const node of mut.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            patchGroups(node);
          }
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
      window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
    } catch {}
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
