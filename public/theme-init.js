// Applies the theme before first paint. A classic script, so it runs while the head is parsed; src/ui/theme.ts keeps
// the same key up to date when the user changes the setting.
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('nb.theme') || 'system';
  } catch (e) {
    // Storage unavailable: follow the system.
  }
  var dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
