// Theme choice: auto (follow the system), light or dark. Loaded in <head> so there is no flash.
(function () {
  let saved = '';
  try { saved = localStorage.getItem('wsTheme') || ''; } catch (e) { /* storage is optional */ }
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
})();
