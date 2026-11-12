// dashboard/deck.js
// Slide deck engine: navigation, build steps, HUD, speaker notes, starfield, and the two
// simulations (the TCP/UDP position race and the lost-ACK sequence). No dependencies.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const stage = $('#stage');
  const slides = $$('.slide');
  const hudL = $('#hud-l');
  const notes = $('#notes');
  // ?still freezes every animation on its final state (handy for screenshots and printing).
  const still = /[?&]still/.test(location.search);
  if (still) document.documentElement.classList.add('still');
  const reduced = still || matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = { i: 0, s: 0, loss: true, paused: false };

  // ---------------------------------------------------------------- crewmates
  // Original, tintable astronaut drawn in SVG (color comes from --c on the element).
  const CREW = '<svg viewBox="0 0 100 120" aria-hidden="true"><g class="cb">' +
    '<rect class="lg lg1" x="24" y="76" width="22" height="38" rx="9"/>' +
    '<rect class="lg lg2" x="56" y="76" width="22" height="38" rx="9"/>' +
    '<rect class="pack" x="4" y="42" width="28" height="44" rx="10"/>' +
    '<rect class="body" x="20" y="8" width="62" height="88" rx="31"/>' +
    '<rect class="visor" x="44" y="26" width="48" height="30" rx="15"/>' +
    '<rect class="shine" x="58" y="32" width="22" height="7" rx="3.5"/></g></svg>';
  const fillCrew = (root) => $$('.crew', root).forEach(el => { if (!el.firstChild) el.innerHTML = CREW; });
  fillCrew(document);

  // ---------------------------------------------------------------- fit 1920x1080 to the window
  function fit() {
    const k = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.setProperty('--k', k);
  }
  addEventListener('resize', fit);
  fit();

  // ---------------------------------------------------------------- editable placeholders
  $$('[data-edit]').forEach(el => {
    const key = 'deck:' + el.dataset.edit;
    try { const v = localStorage.getItem(key); if (v) el.textContent = v; } catch { /* storage unavailable */ }
    el.addEventListener('input', () => {
      // The same field can appear on several slides (team names): keep them identical.
      $$(`[data-edit="${el.dataset.edit}"]`).forEach(o => { if (o !== el) o.textContent = el.textContent; });
      try { localStorage.setItem(key, el.textContent); } catch { /* ignore */ }
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); el.blur(); } });
  });

  // ---------------------------------------------------------------- the position race
  // The same stream of positions p1, p2, ... sent over a TCP-like lane (in-order delivery, a lost
  // packet blocks everything behind it until its retransmission arrives) or a UDP FAST lane
  // (a lost packet is simply gone; the newest position always wins).
  const TRAVEL = 2200, EMIT = 450, RTO = 800, LOSS_EVERY = 12, LOSS_AT = 0.45;

  class Race {
    constructor(el) {
      this.el = el;
      this.tcp = el.dataset.mode === 'tcp';
      el.innerHTML =
        `<div class="r-label"><b>${this.tcp ? 'TCP' : 'UDP'}</b><span>${this.tcp ? 'every byte, in order' : 'FAST: newest wins'}</span></div>` +
        '<div class="r-track"><div class="r-door"></div></div>' +
        '<div class="r-screen"><span class="r-title">player 2\'s screen</span>' +
        `<div class="r-ghost"><i class="crew walk" style="--c:${this.tcp ? 'var(--tcp)' : 'var(--udp)'};--w:52px"></i></div>` +
        '<span class="r-status"></span></div>';
      fillCrew(el);
      this.track = $('.r-track', el);
      this.ghost = $('.r-ghost', el);
      this.status = $('.r-status', el);
      this.reset();
    }
    reset() {
      $$('.pk, .ejtxt', this.track).forEach(n => n.remove());
      Object.assign(this, { n: 0, pk: [], acc: EMIT, now: 0, expected: 1, shown: 0, blocked: 0,
        retx: [], notes: [], gx: 0, lost: 0, stall: 0 });
    }
    spawn(n, rt) {
      const el = document.createElement('div');
      el.className = 'pk' + (rt ? ' rt' : '');
      el.innerHTML = `<div class="in"><code class="lab">p${n}</code><i class="crew walk" style="--c:${this.tcp ? 'var(--tcp)' : 'var(--udp)'};--w:46px"></i></div>`;
      fillCrew(el);
      this.track.appendChild(el);
      this.pk.push({ n, rt, x: 0, st: 'fly', el });
    }
    remove(p, cls, after) {
      p.st = 'gone';
      p.el.classList.add(cls);
      this.notes.push({ el: p.el, until: this.now + after });
    }
    tick(dt, loss) {
      this.now += dt;
      this.acc += dt;
      if (this.acc >= EMIT) { this.acc -= EMIT; this.spawn(++this.n, false); }
      for (let k = this.retx.length - 1; k >= 0; k--) {
        if (this.now >= this.retx[k].at) { this.spawn(this.retx[k].n, true); this.retx.splice(k, 1); }
      }
      const queued = () => this.pk.filter(p => p.st === 'q').length;

      for (const p of this.pk) {
        if (p.st !== 'fly') continue;
        p.x += dt / TRAVEL;

        if (loss && !p.rt && p.n % LOSS_EVERY === 3 && p.x >= LOSS_AT) {
          this.lost++;
          const t = document.createElement('span');
          t.className = 'ejtxt';
          t.textContent = `p${p.n} was ejected.`;
          t.style.left = Math.round(p.x * this.w) + 'px';
          this.track.appendChild(t);
          this.notes.push({ el: t, until: this.now + 1700 });
          this.remove(p, 'ej', 900);
          if (this.tcp) { this.blocked = p.n; this.retx.push({ n: p.n, at: this.now + RTO }); }
          continue;
        }
        // TCP: anything newer than the missing packet has to wait in front of the door.
        if (this.tcp && this.blocked && p.n > this.blocked) {
          const stop = 0.955 - 0.064 * (queued() + 1);
          if (p.x >= stop) { p.x = stop; p.st = 'q'; p.el.classList.add('q'); }
          continue;
        }
        if (p.x >= 1) {
          if (this.tcp) {
            this.expected = p.n + 1;
            if (p.n === this.blocked) {
              this.blocked = 0;
              // The missing one arrived: everything waiting is delivered at once, in order.
              for (const w of this.pk.filter(q => q.st === 'q').sort((a, b) => a.n - b.n)) {
                this.expected = w.n + 1;
                this.remove(w, 'done', 300);
              }
            }
            this.shown = this.expected - 1;
          } else if (p.n > this.shown) {
            this.shown = p.n;
          }
          this.remove(p, 'done', 300);
        }
      }
      for (let k = this.notes.length - 1; k >= 0; k--) {
        if (this.now >= this.notes[k].until) { this.notes[k].el.remove(); this.notes.splice(k, 1); }
      }
      this.pk = this.pk.filter(p => p.st !== 'gone');
      if (this.blocked) this.stall += dt;

      // Player 2's screen: glide toward the last position that was actually delivered.
      const u = (this.shown % 24) / 12;
      const target = (u > 1 ? 2 - u : u) * this.gw;
      this.gx += (target - this.gx) * Math.min(1, dt * 0.012);
    }
    render() {
      for (const p of this.pk) p.el.style.transform = `translateX(${(p.x * this.w).toFixed(1)}px)`;
      this.ghost.style.transform = `translateX(${this.gx.toFixed(1)}px)`;
      let txt, cls;
      if (this.tcp) {
        if (this.blocked) { txt = `frozen · waiting for p${this.blocked}`; cls = 'bad'; }
        else { txt = `in order · p${this.shown}`; cls = 'ok'; }
        if (this.stall) txt += ` · stalled ${(this.stall / 1000).toFixed(1)} s`;
      } else {
        txt = `moving · p${this.shown}` + (this.lost ? ` · ${this.lost} lost` : '');
        cls = 'ok';
      }
      if (txt !== this.lastTxt) { this.status.textContent = txt; this.status.className = 'r-status ' + cls; this.lastTxt = txt; }
    }
    measure() {
      this.w = this.track.offsetWidth - 84;
      this.gw = $('.r-screen', this.el).offsetWidth - 96;
    }
    // Reduced motion: no loop, just one frozen frame that still shows the mechanism.
    freeze(loss) {
      this.reset(); this.measure();
      for (let k = 0; k < 290; k++) this.tick(16, loss);
      this.render();
    }
  }
  const races = new Map();
  $$('.race').forEach(el => races.set(el, new Race(el)));
  let activeRaces = [];

  // ---------------------------------------------------------------- the lost-ACK sequence (slide 5)
  const seq = $('#seq');
  const seqRows = seq ? $$('.sr', seq) : [];
  const counters = Object.fromEntries($$('[data-c]').map(el => [el.dataset.c, el]));
  const PHASES = [0, 1700, 3300, 5200, 6900];       // when each row appears (ms)
  const COUNTS = [                                   // counter values after each phase
    { sent: 1, rt: 0, dup: 0, ack: 0 }, { sent: 1, rt: 0, dup: 0, ack: 0 }, { sent: 1, rt: 0, dup: 0, ack: 0 },
    { sent: 1, rt: 1, dup: 1, ack: 0 }, { sent: 1, rt: 1, dup: 1, ack: 1 },
  ];
  let seqTimers = [];
  function seqPhase(p) {
    seqRows.forEach((r, k) => r.classList.toggle('show', k < p));
    const c = p ? COUNTS[p - 1] : { sent: 0, rt: 0, dup: 0, ack: 0 };
    for (const k in c) if (counters[k]) counters[k].textContent = c[k];
  }
  function seqStop() { seqTimers.forEach(clearTimeout); seqTimers = []; }
  function seqStart() {
    seqStop();
    if (reduced || state.paused) { seqPhase(5); return; }
    seqPhase(0);
    PHASES.forEach((t, k) => seqTimers.push(setTimeout(() => seqPhase(k + 1), t + 300)));
    seqTimers.push(setTimeout(seqStart, 11500));
  }

  // ---------------------------------------------------------------- navigation
  const stepsOf = (sl) => Number(sl.dataset.steps) || 0;

  function show(i, s) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    const sl = slides[i];
    s = Math.max(0, Math.min(stepsOf(sl), s));
    const slideChanged = i !== state.i || !sl.classList.contains('active');
    state.i = i; state.s = s;

    slides.forEach((x, k) => {
      x.classList.toggle('active', k === i);
      x.classList.toggle('past', k < i);
      x.inert = k !== i;
    });
    sl.dataset.s = s;
    sl.style.setProperty('--s', s);
    $$('[data-step]', sl).forEach(el => el.classList.toggle('on', s >= Number(el.dataset.step)));
    $$('[data-until]', sl).forEach(el => el.classList.toggle('off', s > Number(el.dataset.until)));
    $$('[data-fx]', sl).forEach(el => el.classList.toggle('fixed', s >= Number(el.dataset.fx)));

    // Simulations only run on the slide and step that shows them.
    const raceOn = sl.dataset.race !== undefined && s >= Number(sl.dataset.race);
    const next = raceOn ? $$('.race', sl).map(el => races.get(el)) : [];
    if (slideChanged || next.length !== activeRaces.length) {
      next.forEach(r => { r.reset(); r.measure(); });
      if (reduced) next.forEach(r => r.freeze(state.loss));
    }
    activeRaces = next;

    const seqOn = sl.dataset.seq !== undefined && s >= Number(sl.dataset.seq);
    if (seqOn && !seqTimers.length) seqStart();
    if (!seqOn) { seqStop(); seqPhase(0); }

    notes.textContent = $('.say', sl)?.textContent || '';
    history.replaceState(null, '', `#${i + 1}.${s}`);
    hud();
  }
  function hud() {
    const sl = slides[state.i];
    const n = String(state.i + 1).padStart(2, '0');
    const parts = [`${n}/${slides.length}`, sl.dataset.hud];
    if (stepsOf(sl)) parts.push(`step ${state.s}/${stepsOf(sl)}`);
    if (sl.dataset.race !== undefined) parts.push(state.loss ? 'loss ON' : 'loss off');
    if (state.paused) parts.push('PAUSED');
    hudL.textContent = parts.join(' · ');
  }
  const next = () => state.s < stepsOf(slides[state.i]) ? show(state.i, state.s + 1) : show(state.i + 1, 0);
  const prev = () => state.s > 0 ? show(state.i, state.s - 1)
    : state.i > 0 ? show(state.i - 1, stepsOf(slides[state.i - 1])) : null;

  function togglePause() {
    state.paused = !state.paused;
    document.body.classList.toggle('paused', state.paused);
    $('#pause').textContent = state.paused ? 'P play' : 'P pause';
    if (slides[state.i].dataset.seq !== undefined && seqTimers.length) seqStart();
    hud();
  }
  $('#pause').addEventListener('click', togglePause);

  addEventListener('keydown', (e) => {
    if (e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'Enter') { e.preventDefault(); next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); prev(); }
    else if (k === 'Home') show(0, 0);
    else if (k === 'End') show(slides.length - 1, 0);
    else if (k >= '0' && k <= '9') show(k === '0' ? 9 : Number(k) - 1, 0);
    else if (k === 'n' || k === 'N') notes.hidden = !notes.hidden;
    else if (k === 'p' || k === 'P') togglePause();
    else if (k === 'l' || k === 'L') {
      state.loss = !state.loss;
      if (reduced) activeRaces.forEach(r => r.freeze(state.loss));
      hud();
    }
    else if (k === 'f' || k === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    }
  });

  // ---------------------------------------------------------------- parallax
  if (!reduced) {
    addEventListener('pointermove', (e) => {
      document.body.style.setProperty('--px', (e.clientX / innerWidth * 2 - 1).toFixed(3));
      document.body.style.setProperty('--py', (e.clientY / innerHeight * 2 - 1).toFixed(3));
    });
  }

  // ---------------------------------------------------------------- starfield + main loop
  const cv = $('#stars');
  const ctx = cv.getContext('2d');
  let stars = [];
  function sizeStars() {
    cv.width = innerWidth; cv.height = innerHeight;
    stars = Array.from({ length: 170 }, () => ({
      x: Math.random() * cv.width, y: Math.random() * cv.height,
      r: Math.random() * 1.5 + 0.3, v: Math.random() * 0.012 + 0.003, a: Math.random() * 0.6 + 0.25,
    }));
    drawStars(0);
  }
  function drawStars(dt) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const s of stars) {
      s.x -= s.v * dt;
      if (s.x < -2) s.x = cv.width + 2;
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#dfe8ff';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
    }
  }
  addEventListener('resize', sizeStars);
  sizeStars();

  let last = performance.now();
  function frame(t) {
    const dt = Math.min(50, t - last);
    last = t;
    if (!state.paused && !reduced && !document.hidden) {
      drawStars(dt);
      for (const r of activeRaces) { r.tick(dt, state.loss); r.render(); }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- start (supports #slide.step)
  const m = location.hash.match(/^#(\d+)(?:\.(\d+))?/);
  show(m ? Number(m[1]) - 1 : 0, m && m[2] ? Number(m[2]) : 0);
})();
