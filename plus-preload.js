// Force <a download>, blob/data links, and file-like URLs to open in a new window.
// The host (did-attach-webview setWindowOpenHandler) turns that into a real download.
(() => {
  const FILE_RX = /\.(png|jpe?g|gif|webp|svg|mp4|zip|pdf|txt|json|bin|csv|mp3|wav|webm)(\?|$)/i;

  function shouldForce(href, a) {
    if (!href) return false;
    return a?.hasAttribute('download') || href.startsWith('blob:') || href.startsWith('data:') || FILE_RX.test(href);
  }

  function findAnchor(el) {
    return el && (el.tagName === 'A' ? el : el.closest?.('a')) || null;
  }

  // 1) Intercept programmatic a.click() on <a download> / blob/data links
  const origAClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (...args) {
    try {
      const href = this.getAttribute('href') || this.href || '';
      if (shouldForce(href, this)) {
        window.open(href, '_blank'); // host will turn into a real download
        return; // swallow original click
      }
    } catch {}
    return origAClick.apply(this, args);
  };

  // 2) Capture real user clicks and promote to window.open
  window.addEventListener('click', (e) => {
    try {
      const a = findAnchor(e.target);
      if (a) {
        const href = a.getAttribute('href') || a.href || '';
        if (shouldForce(href, a)) {
          e.preventDefault();
          e.stopPropagation();
          window.open(href, '_blank');
          return;
        }
      }

      // Common case: a “Download” button that later creates a hidden <a>
      const btn = e.target.closest?.('button,[role="button"]');
      if (btn) {
        const label = (btn.getAttribute('aria-label') || btn.textContent || '').toLowerCase().trim();
        if (label.includes('download') || label.includes('save')) {
          // Give the UI a moment to inject the hidden <a>, then try again.
          setTimeout(() => {
            const a2 = document.querySelector('a[download]');
            if (a2) {
              const href2 = a2.getAttribute('href') || a2.href || '';
              if (shouldForce(href2, a2)) window.open(href2, '_blank');
            }
          }, 120);
        }
      }
    } catch {}
  }, true);
})();