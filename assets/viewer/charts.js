/**
 * Viewer charts: dependency-free inline SVG / HTML.
 * Colors come from CSS custom properties so light/dark themes swap in CSS.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const nf = new Intl.NumberFormat();

function niceMax(v) {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/**
 * Multi-series line chart with crosshair tooltip (mouse, touch and arrow keys).
 * @param {HTMLElement} host
 * @param {{xLabels:string[], xSub:string[], series:{name:string,color:string,dashed?:boolean,values:number[]}[], unit:string, label:string}} cfg
 */
export function lineChart(host, cfg) {
  host.innerHTML = '';
  const { xLabels, series } = cfg;
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  host.append(wrap);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');

  const width = Math.max(300, wrap.clientWidth || host.clientWidth || 600);
  const height = Math.round(Math.min(320, Math.max(220, width * 0.5)));
  const directLabels = series.length <= 4;
  const m = { t: 16, r: directLabels ? 92 : 16, b: 34, l: 44 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const n = xLabels.length;
  const yMax = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i) => m.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => m.t + ih - (v / yMax) * ih;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(height));
  svg.setAttribute('class', 'chart');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${cfg.label}. ${series.length} players over ${n} games. Use left and right arrow keys to read values for each game.`);

  let h = '';
  // grid + y ticks
  for (let k = 0; k <= 4; k += 1) {
    const v = (yMax / 4) * k;
    const yy = y(v);
    h += `<line class="${k === 0 ? 'axis' : 'grid'}" x1="${m.l}" x2="${m.l + iw}" y1="${yy}" y2="${yy}"/>`;
    h += `<text class="tick" x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${nf.format(v)}</text>`;
  }
  // x ticks (thinned)
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
  xLabels.forEach((lbl, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    h += `<text class="tick" x="${x(i)}" y="${m.t + ih + 22}" text-anchor="middle">${esc(lbl)}</text>`;
  });
  // series
  series.forEach((s) => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    h += `<path class="line ${s.dashed ? 'dashed' : ''}" d="${d}" style="stroke:${s.color}"/>`;
    if (n === 1) h += `<circle class="dot" cx="${x(0)}" cy="${y(s.values[0])}" r="5" style="fill:${s.color}"/>`;
  });
  // direct labels at line ends, nudged apart
  if (directLabels && n > 0) {
    const ends = series.map((s) => ({ s, yy: y(s.values[n - 1]) })).sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < ends.length; i += 1) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14;
    ends.forEach(({ s, yy }) => {
      h += `<circle class="end" cx="${x(n - 1)}" cy="${y(s.values[n - 1])}" r="4" style="fill:${s.color}"/>`;
      h += `<text class="direct" x="${x(n - 1) + 10}" y="${yy + 4}">${esc(s.name.length > 11 ? `${s.name.slice(0, 10)}…` : s.name)}</text>`;
    });
  }
  h += `<line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;
  h += `<g class="hover-dots"></g>`;
  h += `<rect class="hit" x="${m.l - 10}" y="${m.t}" width="${iw + 20}" height="${ih}" fill="transparent"/>`;
  svg.innerHTML = h;
  wrap.append(svg, tip, live);

  const cross = svg.querySelector('.crosshair');
  const dots = svg.querySelector('.hover-dots');
  let current = -1;

  function show(i, fromKey) {
    if (i < 0 || i >= n) return;
    current = i;
    const xx = x(i);
    cross.setAttribute('x1', xx); cross.setAttribute('x2', xx); cross.setAttribute('visibility', 'visible');
    dots.innerHTML = series.map((s) => `<circle cx="${xx}" cy="${y(s.values[i])}" r="5" class="hover-dot" style="fill:${s.color}"/>`).join('');
    const rows = series.map((s) => ({ s, v: s.values[i] })).sort((a, b) => b.v - a.v);
    tip.innerHTML = `<p class="tip-title">${esc(xLabels[i])}${cfg.xSub?.[i] ? ` <span>${esc(cfg.xSub[i])}</span>` : ''}</p>
      <ul>${rows.map(({ s, v }) => `<li><span class="key ${s.dashed ? 'dashed' : ''}" style="--c:${s.color}"></span><span class="tip-name">${esc(s.name)}</span><strong>${nf.format(v)}</strong></li>`).join('')}</ul>`;
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / width || 1;
    const tw = tip.offsetWidth;
    let left = xx * scale + 14;
    if (left + tw > wrap.clientWidth) left = xx * scale - tw - 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${m.t * scale}px`;
    if (fromKey) live.textContent = `${xLabels[i]}: ${rows.map(({ s, v }) => `${s.name} ${nf.format(v)} ${cfg.unit}`).join(', ')}`;
  }
  function hide() {
    current = -1;
    cross.setAttribute('visibility', 'hidden');
    dots.innerHTML = '';
    tip.hidden = true;
  }
  function fromPointer(e) {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = n <= 1 ? 0 : Math.round(((px - m.l) / iw) * (n - 1));
    show(Math.min(n - 1, Math.max(0, i)));
  }
  svg.addEventListener('pointermove', fromPointer);
  svg.addEventListener('pointerdown', fromPointer);
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  svg.addEventListener('focus', () => show(current < 0 ? n - 1 : current, true));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); show(Math.min(n - 1, current + 1), true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); show(Math.max(0, current - 1), true); }
    else if (e.key === 'Home') { e.preventDefault(); show(0, true); }
    else if (e.key === 'End') { e.preventDefault(); show(n - 1, true); }
    else if (e.key === 'Escape') { hide(); }
  });
}

/**
 * Diverging horizontal bars around zero (HTML, so it reflows on phones).
 * @param {HTMLElement} host
 * @param {{name:string, value:number, sub?:string}[]} rows
 */
export function divergingBars(host, rows, unit) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  host.innerHTML = `<ul class="dbars" role="list">${rows.map((r) => {
    const pct = (Math.abs(r.value) / max) * 50;
    const sign = r.value > 0 ? 'up' : r.value < 0 ? 'down' : 'zero';
    const label = `${r.value > 0 ? '+' : r.value < 0 ? '−' : ''}${nf.format(Math.abs(r.value))}`;
    return `<li class="dbar ${sign}">
      <span class="dbar-name">${esc(r.name)}${r.sub ? ` <span class="muted">${esc(r.sub)}</span>` : ''}</span>
      <span class="dbar-track" aria-hidden="true">
        <span class="dbar-mid"></span>
        <span class="dbar-fill" style="--w:${pct.toFixed(2)}%"></span>
      </span>
      <span class="dbar-val">${r.value ? `<span class="sr-only">${r.value < 0 ? 'down' : 'up'} </span>` : ''}${label}<span class="sr-only"> ${unit}</span></span>
    </li>`;
  }).join('')}</ul>`;
}
