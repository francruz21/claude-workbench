// Mobile layout inspector. Paste as the body of `orca-ide eval --expression`.
// Adapted from pageel/para-workspace (mobile-responsive), with the noise cut:
// it only reports the outermost offender of each overflow (not its whole
// subtree), skips content inside intentional horizontal scrollers, and flags
// media by rendered size instead of by a missing CSS property.
(() => {
  const vw = document.documentElement.clientWidth;
  const scrollWidth = document.documentElement.scrollWidth;

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };

  // An element inside a container that clips or scrolls horizontally is not a
  // page overflow: carousels and wide tables in overflow-x-auto are by design.
  const insideHorizontalClip = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
    }
    return false;
  };

  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.')
      : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };

  const offenders = [];
  const offenderSet = new Set();
  document.querySelectorAll('body *').forEach((el) => {
    if (!isVisible(el)) return;
    const r = el.getBoundingClientRect();
    const spillRight = r.right - vw;
    const spillLeft = -r.left;
    if (spillRight <= 1 && spillLeft <= 1) return;
    if (insideHorizontalClip(el)) return;
    // Keep only the outermost offender; its descendants overflow because of it.
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (offenderSet.has(p)) return;
    }
    offenderSet.add(el);
    offenders.push({
      selector: describe(el),
      width: Math.round(r.width),
      overflowByPx: Math.round(Math.max(spillRight, spillLeft)),
      side: spillRight > spillLeft ? 'right' : 'left',
      text: (el.innerText || '').trim().slice(0, 40),
    });
  });

  // Touch targets. Below 24px fails WCAG 2.5.8 (AA) and is reported one by
  // one; below 44px only misses 2.5.5 (AAA) and is just counted. Inline links
  // inside running text are exempt under both criteria, so they are skipped.
  const smallTargets = [];
  let under44 = 0;
  document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]').forEach((el) => {
    if (!isVisible(el)) return;
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && /^(P|LI|SPAN|TD)$/.test(el.parentElement.tagName)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) under44++;
    if (r.width < 24 || r.height < 24) {
      smallTargets.push({
        selector: describe(el),
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    }
  });

  // Media rendered wider than the viewport.
  const wideMedia = [];
  document.querySelectorAll('img, video, iframe, canvas, svg').forEach((el) => {
    if (!isVisible(el) || insideHorizontalClip(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width > vw + 1) wideMedia.push({ selector: describe(el), width: Math.round(r.width) });
  });

  const viewportMeta = document.querySelector('meta[name=viewport]')?.getAttribute('content') || null;
  const hasHorizontalOverflow = scrollWidth > vw + 1;

  return JSON.stringify({
    innerWidth: window.innerWidth,
    clientWidth: vw,
    scrollWidth,
    hasHorizontalOverflow,
    viewportMeta,
    overflowing: offenders.slice(0, 15),
    overflowingCount: offenders.length,
    smallTargets: smallTargets.slice(0, 15),
    smallTargetsCount: smallTargets.length,
    under44Count: under44,
    wideMedia,
    verdict: hasHorizontalOverflow || offenders.length || wideMedia.length || !viewportMeta ? 'FAIL' : 'PASS',
  });
})()
