// dashboard/title.js
// Title slide (the arcade cabinet). Draws everything that is easier as generated SVG than as
// markup: dot-matrix text, glossy 3D crewmates, extruded voxel crewmates, marquee bulbs, dust.
// Pure decoration; the deck engine (deck.js) still owns navigation. No dependencies.
(() => {
  'use strict';
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.querySelector('.s1');
  if (!root) return;
  let uid = 0;

  // ---------------------------------------------------------------- 5x7 dot-matrix font
  const F = {
    A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
    C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
    E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
    G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
    I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
    K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
    M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 10001 11001 10101 10011 10001 10001',
    O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
    Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
    S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
    U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
    W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
    Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
    0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
    2: '01110 10001 00001 00010 00100 01000 11111', 3: '11110 00001 00001 01110 00001 00001 11110',
    4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
    6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
    8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
    ' ': '000 000 000 000 000 000 000', '·': '000 000 000 010 000 000 000',
    ':': '0 0 1 0 1 0 0', '.': '0 0 0 0 0 0 1', '-': '000 000 000 111 000 000 000',
  };

  // One <svg> per line of text, 1 unit per dot, so it stays razor sharp at any scale.
  // Each lit dot is drawn twice: a fat back square (outline + glow) and the face on top.
  function dotMatrix(text) {
    let x = 0;
    const back = [], face = [];
    for (const ch of text.toUpperCase()) {
      const rows = (F[ch] || F[' ']).split(' ');
      rows.forEach((row, y) => [...row].forEach((b, c) => {
        if (b !== '1') return;
        back.push(`<rect x="${x + c - .16}" y="${y - .16}" width="1.32" height="1.32" rx=".3"/>`);
        face.push(`<rect x="${x + c + .09}" y="${y + .09}" width=".82" height=".82" rx=".2"/>`);
      }));
      x += rows[0].length + 1;
    }
    const w = x - 1;
    return { cols: w, svg: `<svg viewBox="-.3 -.3 ${w + .6} 7.6" aria-hidden="true"><g class="dk">${back.join('')}</g><g class="lt">${face.join('')}</g></svg>` };
  }
  $$('[data-dm]', root).forEach(el => {
    const { cols, svg } = dotMatrix(el.dataset.dm);
    el.innerHTML = svg;
    el.style.setProperty('--cols', cols);
    el.style.setProperty('--dot', el.dataset.dot + 'px');
  });

  // ---------------------------------------------------------------- colour helpers
  const hex = (c) => { const m = c.trim().replace('#', ''); return [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16)); };
  const mix = (a, b, t) => '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
  const shades = (c) => { const rgb = hex(c); return { base: mix(rgb, rgb, 0), lite: mix(rgb, [255, 255, 255], .55), dark: mix(rgb, [20, 0, 20], .5), deep: mix(rgb, [10, 0, 16], .72) }; };

  // ---------------------------------------------------------------- glossy "3D" crewmate
  // Soft, lit, toy-like render (radial body shading, rim light, glass visor, contact shadow).
  function glossy(c) {
    const s = shades(c), i = ++uid;
    return `<svg viewBox="0 0 120 140" aria-hidden="true"><defs>
<radialGradient id="gb${i}" cx="34%" cy="26%" r="85%"><stop offset="0" stop-color="${s.lite}"/><stop offset=".42" stop-color="${s.base}"/><stop offset=".86" stop-color="${s.dark}"/><stop offset="1" stop-color="${s.deep}"/></radialGradient>
<linearGradient id="gl${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.base}"/><stop offset="1" stop-color="${s.deep}"/></linearGradient>
<linearGradient id="gv${i}" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#f2fdff"/><stop offset=".38" stop-color="#9fe2f7"/><stop offset=".72" stop-color="#4a9fc4"/><stop offset="1" stop-color="#22607e"/></linearGradient>
</defs>
<g class="gc" stroke="#1a0612" stroke-width="3.5" stroke-linejoin="round">
<rect x="6" y="50" width="30" height="52" rx="13" fill="url(#gl${i})"/>
<rect class="lgA" x="27" y="92" width="31" height="40" rx="14" fill="url(#gl${i})"/>
<rect class="lgB" x="63" y="92" width="31" height="40" rx="14" fill="url(#gl${i})"/>
<rect x="20" y="7" width="82" height="108" rx="41" fill="url(#gb${i})"/>
<rect x="54" y="29" width="60" height="38" rx="19" fill="url(#gv${i})"/>
</g>
<rect x="69" y="36" width="28" height="9" rx="4.5" fill="#fff" opacity=".92"/>
<rect x="101" y="49" width="6" height="6" rx="3" fill="#fff" opacity=".6"/>
<ellipse cx="38" cy="30" rx="9" ry="15" fill="#fff" opacity=".28" transform="rotate(-20 38 30)"/>
<path d="M30 104 Q 60 116 96 98" fill="none" stroke="${s.lite}" stroke-width="3" opacity=".45" stroke-linecap="round"/>
</svg>`;
  }
  $$('.amg', root).forEach(el => { el.innerHTML = glossy(getComputedStyle(el).getPropertyValue('--c') || '#ff3b4e'); });

  // ---------------------------------------------------------------- voxel crewmate
  // A 14x16 pixel sprite, stacked into 3D: one bevelled face layer plus darker slabs behind it
  // (translateZ), so it reads as a solid block model when the parallax turns it.
  const SPRITE = [
    '.....bbbbb....',
    '....bbbbbbb...',
    '...bbbbbbbbb..',
    '...bbbbvvvvvv.',
    '..pbbbvvvvvvvv',
    '.ppbbbvvssvvvv',
    '.ppbbbvvvvvvvv',
    '.ppbbbbvvvvvv.',
    '.ppbbbbbbbbbb.',
    '.ppbbbbbbbbbb.',
    '.ppbbbbbbbbbb.',
    '..pbbbbbbbbbb.',
    '...bbbbbbbbbb.',
    '...bbbb..bbbb.',
    '...bbbb..bbbb.',
    '...bbb....bbb.',
  ];
  const SLABS = 9;
  function voxelLayer(face) {
    const i = ++uid;
    let r = '';
    SPRITE.forEach((row, y) => [...row].forEach((k, x) => {
      if (k === '.') return;
      r += `<rect class="${k}" x="${x}" y="${y}" width="1.02" height="1.02"/>`;
      if (face) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="url(#bv${i})"/>`;
    }));
    const defs = face ? `<defs><linearGradient id="bv${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".22" stop-color="#fff" stop-opacity=".08"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient></defs>` : '';
    return `<svg viewBox="0 0 14 16" class="${face ? 'face' : 'slab'}" shape-rendering="crispEdges">${defs}${r}</svg>`;
  }
  $$('.vbody', root).forEach(el => {
    el.style.setProperty('--px', el.dataset.px + 'px');
    let html = '';
    for (let k = SLABS; k >= 1; k--) html += voxelLayer(false).replace('<svg ', `<svg style="--z:${k}" `);
    el.innerHTML = html + voxelLayer(true);
  });

  // ---------------------------------------------------------------- marquee bulbs, pips, dust
  $$('.bulbs', root).forEach(el => { el.innerHTML = Array.from({ length: 24 }, (_, k) => `<i style="--i:${k}"></i>`).join(''); });
  $$('.pips', root).forEach(el => { el.innerHTML = '<i></i>'.repeat(5); });
  const dust = root.querySelector('.dust');
  if (dust) {
    let d = '';
    for (let k = 0; k < 34; k++) {
      const x = (k * 137.5) % 100, y = (k * 61.8) % 100, s = 2 + (k % 4);
      d += `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--s:${s}px;--t:${7 + (k % 7) * 1.6}s;--k:${(-k * .9).toFixed(1)}s"></i>`;
    }
    dust.innerHTML = d;
  }
})();
