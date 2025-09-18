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
  const GROUP_SELECTOR = '[role="treeitem"] > [role="group"]';

  const patchGroups = (root = document) => {
    try {
      const scope = root.querySelectorAll
        ? root.querySelectorAll(GROUP_SELECTOR)
        : [];
      scope.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        if (!el.closest('nav,aside')) return;
        el.style.setProperty('max-height', 'min(65vh, 560px)', 'important');
        el.style.setProperty('overflow-y', 'auto', 'important');
        el.style.setProperty('overscroll-behavior', 'contain', 'important');
        el.style.setProperty('scrollbar-gutter', 'stable both-edges');
        el.style.setProperty('-webkit-overflow-scrolling', 'touch');
      });
    } catch {}
  };

  const init = () => {
    patchGroups(document);
    try {
      const observer = new MutationObserver((mutations) => {
        for (const mut of mutations) {
          for (const node of mut.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            patchGroups(node);
          }
        }
        // Catch attribute-based updates or deeper changes
        patchGroups(document);
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
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
