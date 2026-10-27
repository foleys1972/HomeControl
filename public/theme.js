// Loaded in <head> (not deferred) so the chosen theme applies before the first paint.
// 'auto' follows the device; 'light' / 'dark' are set on <html data-theme>.
(function () {
  var t = 'auto';
  try { t = localStorage.getItem('hc-theme') || 'auto'; } catch (e) {}
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
