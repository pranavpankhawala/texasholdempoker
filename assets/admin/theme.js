// Runs before first paint so the saved theme never flashes. Dark is the default.
(function () {
  try {
    var t = localStorage.getItem('thp.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: follow the system setting */ }
})();
