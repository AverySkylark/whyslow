// Light/dark choice from the header button, saved as wsMode. Loaded in <head> so the popup never flashes the wrong mode.
// No saved choice: follow the browser/system (Keystone's light-dark colours).
(function () {
  let m = '';
  try { m = localStorage.getItem('wsMode') || ''; } catch (e) { /* storage is optional */ }
  if (m === 'light' || m === 'dark') document.documentElement.dataset.mode = m;
})();
