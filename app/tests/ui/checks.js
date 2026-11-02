// Quick in-page UI/UX checks, evaluated by tests/ui/run.mjs on every screen.
// Returns: horizontal page scroll, small tap targets (phone), unlabeled
// controls, and text whose contrast is below WCAG AA.
(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
  const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || e.value || e.getAttribute('placeholder') || '').trim();
  const where = (e) => (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : e.tagName.toLowerCase()) + (name(e) ? ` "${name(e).slice(0, 24)}"` : '');

  const hscroll = document.documentElement.scrollWidth > innerWidth + 1;

  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')].filter(vis);
  const phone = innerWidth < 600;
  const smallTargets = phone ? controls.filter((e) => { const r = e.getBoundingClientRect(); return (r.width < 24 || r.height < 24) && e.type !== 'checkbox' && e.type !== 'radio'; }).map(where).slice(0, 12) : [];
  const unlabeled = controls.filter((e) => {
    if (name(e)) return false;
    if (e.id && document.querySelector(`label[for="${e.id}"]`)) return false;
    if (e.closest('label')) return false;
    return true;
  }).map(where).slice(0, 12);

  // Contrast: parse rgb(a), walk up for an opaque background.
  const rgb = (s) => { const m = s.match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c && (c[3] ?? 1) > .9) return c; } return [255, 255, 255]; };
  const lowContrast = [];
  const seen = new Set();
  for (const e of document.querySelectorAll('body *')) {
    if (lowContrast.length >= 12) break;
    if (!vis(e) || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(e);
    if (parseFloat(s.opacity) < 1 || e.closest('[disabled], .archived, .signin-page img')) continue;
    const fg = rgb(s.color); if (!fg) continue;
    const L1 = lum(fg), L2 = lum(bgOf(e));
    const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
    const big = parseFloat(s.fontSize) >= 18.66 || (parseFloat(s.fontSize) >= 14 && +s.fontWeight >= 700);
    if (ratio < (big ? 3 : 4.5)) {
      const k = where(e); if (seen.has(k)) continue; seen.add(k);
      lowContrast.push(`${k} ${ratio.toFixed(2)}`);
    }
  }
  return { hscroll, smallTargets, unlabeled, lowContrast };
})()
