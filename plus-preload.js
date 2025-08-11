// For Plus view: gently help downloads by promoting obvious http(s) file URLs.
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