// Apply the saved (or system) theme before the page paints, so there is no
// flash of the wrong colours. A file of its own (not written into the page)
// so the Content-Security-Policy can forbid every inline script (2026-10-27).
try {
  var t = localStorage.getItem('printflow-theme');
  var dark = t === 'dark' || (t == null && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
} catch { /* no storage (private mode): the default light theme stays */ }
