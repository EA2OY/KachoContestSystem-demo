(() => {
  'use strict';

  const DEB = window.DEB;

  const $ = (id) => document.getElementById(id);

  let editing = false;
  let drag = null; // {type, index, startX, startY, orig}

  function current() {
    const key = String(DEB.cfg.numPlayers);
    return DEB.layout().players[key];
  }

  function setEditing(on) {
    editing = on;
    DEB.editing = on;
    $('admin').classList.toggle('layout-editing', on);
    $('mini-stage').classList.toggle('editing', on);
    $('editor-controls').classList.toggle('hidden', !on);
    if (on) {
      renderMini();
      setTimeout(() => {
        fitMini();
        $('panel-layout').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
      syncSliders();
    } else {
      setTimeout(fitMini, 60);
    }
  }

  function fitMini() {
    const wrap = $('mini-wrap');
    if (!wrap) return;
    const w = wrap.clientWidth;
    if (!w) return;
    const s = w / 1920;
    $('mini-stage').style.transform = 'scale(' + s + ')';
  }

  DEB.fitMini = fitMini;

  // renderiza los jugadores en el mini-stage y les adjunta los handles
  function renderMini() {
    DEB.renderPlayers($('mini-players'));
    attachHandles();
    renderMiniTitle();
    renderMiniHud();
  }

  // HUD (pregunta/mensaje/contador/reloj) en el mini con su desplazamiento del
  // layout — mismas reglas de base que el escenario real (renderQuestion usa
  // alturas reales; aquí estimadas para que el editor las recolocque a la vista)
  function renderMiniHud() {
    const L = DEB.layout();
    const hud = DEB.hudCfg();
    if (!L) return;
    const baseTop = (L.title ? L.title.y + L.title.size * 1.6 + 20 : 0);
    const qh = 68, mh = 84;
    const set = (sel, dx, dy, top) => {
      const el = document.querySelector('#mini-hud ' + sel);
      if (!el) return;
      el.style.left = 'calc(50% + ' + (dx || 0) + 'px)';
      el.style.top = (top + (dy || 0)) + 'px';
    };
    set('.mini-q', hud.question.dx, hud.question.dy, baseTop);
    set('.mini-msg', hud.msg.dx, hud.msg.dy, baseTop + qh + 40);
    set('.mini-timer', hud.timer.dx, hud.timer.dy, baseTop + qh + 40 + mh + 30);
    const cl = document.querySelector('#mini-hud .mini-clock');
    if (cl) {
      cl.style.top = (26 + (hud.clock.dy || 0)) + 'px';
      cl.style.right = (42 - (hud.clock.dx || 0)) + 'px';
    }
  }

  // el mini también arrastra los HUD (como hace con napis/textos)
  function attachHudHandles() {
    document.querySelectorAll('#mini-hud [data-hud]').forEach((el) => {
      const kind = el.dataset.hud;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const p = stagePoint(e);
        const L = DEB.layout();
        if (!L.hud) L.hud = {};
        if (!L.hud[kind]) L.hud[kind] = { dx: 0, dy: 0, size: DEB.HUD_DEFAULT[kind].size };
        drag = {
          type: 'hud', hud: kind,
          startX: p.x, startY: p.y,
          orig: { dx: L.hud[kind].dx || 0, dy: L.hud[kind].dy || 0 },
        };
      });
    });
  }

  // el mini muestra el título con su posición/size reales (para recolocarlo)
  function renderMiniTitle() {
    const el = $('mini-title');
    if (!el || !DEB.layout() || !DEB.layout().title) return;
    const t = DEB.layout().title;
    el.textContent = t.text || '';
    // centrado con desplazamiento: igual que renderTitle del escenario real
    el.style.left = '50%';
    el.style.width = 'auto';
    el.style.top = (t.y || 0) + 'px';
    el.style.fontSize = (t.size || 48) + 'px';
    el.style.transform = 'translate(calc(-50% + ' + (t.x || 0) + 'px), 0)';
  }

  function stagePoint(ev) {
    const stage = $('mini-stage');
    const s = stage.getBoundingClientRect();
    const scaleX = 1920 / s.width;
    const scaleY = 1080 / s.height;
    return {
      x: (ev.clientX - s.left) * scaleX,
      y: (ev.clientY - s.top) * scaleY,
    };
  }

  function attachHandles() {
    document.querySelectorAll('#mini-players .player').forEach((el) => {
      const i = parseInt(el.dataset.i, 10);

      const res = document.createElement('div');
      res.className = 'handle-resize';
      res.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const p = stagePoint(e);
        drag = { type: 'resize', index: i, startX: p.x, startY: p.y, orig: rects() };
      });
      el.appendChild(res);

      el.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('pname')) {
          e.stopPropagation();
          const p = stagePoint(e);
          drag = { type: 'name', index: i, startX: p.x, startY: p.y, orig: rects() };
          return;
        }
        if (e.target.classList.contains('ptime')) {
          e.stopPropagation();
          const p = stagePoint(e);
          drag = { type: 'ptime', index: i, startX: p.x, startY: p.y, orig: rects() };
          return;
        }
        if (e.target.classList.contains('ppoints')) {
          e.stopPropagation();
          const p = stagePoint(e);
          drag = { type: 'points', index: i, startX: p.x, startY: p.y, orig: rects() };
          return;
        }
        const p = stagePoint(e);
        drag = { type: 'napi', index: i, startX: p.x, startY: p.y, orig: rects() };
      });
    });
  }

  function onPointerMove(e) {
    if (!drag) return;
    const p = stagePoint(e);
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    const c = current();

    if (drag.type === 'napi') {
      const r = c.napi[drag.index];
      r.x = clamp(drag.orig.napi[drag.index].x + dx, 0, 1920 - r.w);
      r.y = clamp(drag.orig.napi[drag.index].y + dy, 0, 1080 - r.h);
    } else if (drag.type === 'resize') {
      // escala ligada: todos los napis escalan igual
      const base = drag.orig.napi[drag.index];
      const factor = clamp((base.w + dx) / base.w, 0.3, 3);
      c.napi.forEach((r, k) => {
        const b = drag.orig.napi[k];
        const nw = Math.round(b.w * factor);
        const nh = Math.round(b.h * factor);
        r.w = nw;
        r.h = nh;
        r.x = Math.round(b.x + (b.w - nw) / 2);
        r.y = Math.round(b.y + (b.h - nh) / 2);
      });
    } else if (drag.type === 'name' || drag.type === 'points' || drag.type === 'ptime') {
      // los textos viven en el layout '4' (misma fuente/offsets con 2/3 jugadores)
      const p4 = DEB.layout().players['4'];
      const off = ensureOff(p4, drag.index);
      off[drag.type].x = Math.round(drag.orig.off[drag.index][drag.type].x + dx);
      off[drag.type].y = Math.round(drag.orig.off[drag.index][drag.type].y + dy);
    } else if (drag.type === 'hud') {
      // pregunta/mensaje/contador/reloj: desplazamiento sobre su posición base
      const h = DEB.hudCfg()[drag.hud] || { dx: 0, dy: 0 };
      h.dx = Math.round((drag.orig.dx || 0) + dx);
      h.dy = Math.round((drag.orig.dy || 0) + dy);
    }
    renderMini();
  }

  function rects() {
    const key = String(DEB.cfg.numPlayers);
    const c = DEB.layout().players[key];
    const n = c.napi.length;
    const p4 = DEB.layout().players['4'];
    const off = {};
    for (let i = 0; i < n; i++) {
      const o = ensureOff(p4, i);
      off[i] = {
        name: { x: o.name.x, y: o.name.y },
        points: { x: o.points.x, y: o.points.y },
        ptime: { x: o.ptime.x, y: o.ptime.y },
      };
    }
    return {
      napi: c.napi.map((r) => Object.assign({}, r)),
      off: off,
    };
  }

  function ensureOff(c, i) {
    if (!c.off) c.off = [];
    if (!c.off[i]) c.off[i] = { name: { x: 0, y: 0 }, points: { x: 0, y: 0 }, ptime: { x: 0, y: 0 } };
    if (!c.off[i].ptime) c.off[i].ptime = { x: 0, y: 0 };
    return c.off[i];
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function syncSliders() {
    const t = DEB.layoutText();
    $('ctl-name-size').value = t.name;
    $('ctl-points-size').value = t.points;
    $('ctl-ptime-size').value = t.ptime;
    const L = DEB.layout();
    if (!L) return;
    if (L.title) $('ctl-title-size').value = L.title.size;
    const hud = DEB.hudCfg();
    $('ctl-q-size').value = hud.question.size || DEB.HUD_DEFAULT.question.size;
    $('ctl-msg-size').value = hud.msg.size || DEB.HUD_DEFAULT.msg.size;
    $('ctl-timer-size').value = hud.timer.size || DEB.HUD_DEFAULT.timer.size;
    $('ctl-clock-size').value = hud.clock.size || DEB.HUD_DEFAULT.clock.size;
  }

  function setFont(type, val) {
    // los tamaños de texto también viven en el layout '4' (se usan con 2/3)
    const p4 = DEB.layout().players['4'];
    if (!p4.text) p4.text = {};
    p4.text[type] = parseInt(val, 10);
    renderMini();
    DEB.renderStage();
  }

  // tamaño de un elemento del HUD (pregunta/mensaje/contador/reloj): layout.hud
  function setHudSize(kind, val) {
    const L = DEB.layout();
    if (!L.hud) L.hud = {};
    if (!L.hud[kind]) L.hud[kind] = { dx: 0, dy: 0, size: DEB.HUD_DEFAULT[kind].size };
    L.hud[kind].size = parseInt(val, 10);
    renderMini();
    DEB.renderStage();
  }

  // recolocación fina de textos/puntos/tiempo/título/HUD con los botones del
  // editor: mueve el bloque entero (nombres/puntos/tiempo de todos los
  // jugadores visibles) o el elemento global (título/pregunta/mensaje/
  // contador/reloj: layout.title o layout.hud)
  function nudgeMove(type, dx, dy) {
    const L = DEB.layout();
    if (!L) return;
    if (type === 'title') {
      if (!L.title) return;
      L.title.x = clamp(Math.round((L.title.x || 0) + dx), -1200, 2400);
      L.title.y = clamp(Math.round((L.title.y || 0) + dy), -60, 950);
      renderMini();
      DEB.renderStage();
      return;
    }
    const HUD_KEYS = ['question', 'msg', 'timer', 'clock'];
    if (HUD_KEYS.indexOf(type) >= 0) {
      if (!L.hud) L.hud = {};
      if (!L.hud[type]) L.hud[type] = { dx: 0, dy: 0, size: DEB.HUD_DEFAULT[type].size };
      L.hud[type].dx = Math.round((L.hud[type].dx || 0) + dx);
      L.hud[type].dy = Math.round((L.hud[type].dy || 0) + dy);
      renderMini();
      DEB.renderStage();
      return;
    }
    const p4 = L.players['4'];
    const n = DEB.cfg.numPlayers;
    for (let i = 0; i < n; i++) {
      const o = ensureOff(p4, i);
      o[type].x = clamp(Math.round(o[type].x + dx), -900, 1900);
      o[type].y = clamp(Math.round(o[type].y + dy), -400, 1500);
    }
    renderMini();
    DEB.renderStage();
  }

  function bindNudge(btn) {
    const type = btn.dataset.nudge;
    const dx = parseInt(btn.dataset.dx || '0', 10);
    const dy = parseInt(btn.dataset.dy || '0', 10);
    const fire = () => nudgeMove(type, dx, dy);
    let iv = null;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fire();
      iv = setInterval(fire, 90); // mantener pulsado repite
    });
    const stop = () => { if (iv) { clearInterval(iv); iv = null; } };
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
  }

  function init() {
    fitMini();
    window.addEventListener('resize', fitMini);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', () => { drag = null; });

    $('btn-editor').addEventListener('click', () => setEditing(!editing));

    $('ctl-name-size').addEventListener('input', (e) => setFont('name', e.target.value));
    $('ctl-points-size').addEventListener('input', (e) => setFont('points', e.target.value));
    $('ctl-ptime-size').addEventListener('input', (e) => setFont('ptime', e.target.value));
    $('ctl-title-size').addEventListener('input', (e) => {
      if (DEB.layout() && DEB.layout().title) {
        DEB.layout().title.size = parseInt(e.target.value, 10);
        renderMini();
        DEB.renderStage();
      }
    });
    $('ctl-q-size').addEventListener('input', (e) => setHudSize('question', e.target.value));
    $('ctl-msg-size').addEventListener('input', (e) => setHudSize('msg', e.target.value));
    $('ctl-timer-size').addEventListener('input', (e) => setHudSize('timer', e.target.value));
    $('ctl-clock-size').addEventListener('input', (e) => setHudSize('clock', e.target.value));

    document.querySelectorAll('.nudge-btn').forEach(bindNudge);
    attachHudHandles(); // los divs del mini-hud son estáticos: una sola vez

    $('btn-layout-save').addEventListener('click', () => {
      DEB.saveLayout();
      setEditing(false);
      DEB.renderStage();
      alert('Layout guardado (persistirá también tras factory reset en el firmware).');
    });

    $('btn-layout-reset').addEventListener('click', () => {
      if (confirm('¿Restaurar el layout por defecto?')) {
        DEB.resetLayout();
        renderMini();
        DEB.renderStage();
        syncSliders();
      }
    });

    $('btn-layout-export').addEventListener('click', () => {
      const key = String(DEB.cfg.numPlayers);
      $('layout-io').value = JSON.stringify(DEB.layout().players[key], null, 2);
    });

    $('btn-layout-import').addEventListener('click', () => {
      try {
        const data = JSON.parse($('layout-io').value);
        const key = String(DEB.cfg.numPlayers);
        DEB.layout().players[key] = Object.assign({}, DEB.layout().players[key], data);
        DEB.saveLayout();
        renderMini();
        DEB.renderStage();
        syncSliders();
      } catch (e) {
        alert('JSON no válido: ' + e.message);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
