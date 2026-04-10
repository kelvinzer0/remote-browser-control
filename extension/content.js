// Content script — injected into all pages
// Relay page events to background
(() => {
  // Report page load
  chrome.runtime.sendMessage({
    type: 'pageLoaded',
    url: location.href,
    title: document.title,
  }).catch(() => {});
})();
