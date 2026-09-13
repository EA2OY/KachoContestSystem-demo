(() => {
  'use strict';

  const DEB = window.DEB = {};

  // proyector.html = pantalla pública (sin PIN ni panel); index.html = super
  const IS_PROYECTOR = document.body.classList.contains('proyector');

  const LS_CFG = 'dateelbit.cfg';
  const LS_LAYOUT = 'dateelbit.layout';
  const LS_SESSION = 'dateelbit.admin';
  const SESSION_HOURS = 4; // la sesión del super se recuerda este tiempo sin pedir PIN

  const DEFAULT_CFG = {
    pin: '134679',
    numPlayers: 4,
    players: [
      { name: 'Jugador 1', color: 'rojo', napi: 'napirojo', points: 0 },
      { name: 'Jugador 2', color: 'azul', napi: 'napiazul', points: 0 },
      { name: 'Jugador 3', color: 'verde', napi: 'napiverde', points: 0 },
      { name: 'Jugador 4', color: 'amarillo', napi: 'napiamarillo', points: 0 },
    ],
    timer: { on: false, secs: 10 },
    anim: { on: true },
    sound: { on: true, q: true }, // q = sonido de "sale la pregunta" (slot arm)
    question: '',
    faceDigital: false, // rostro 8-bit sobre napis sin gestos
    haloColor: true,    // parpadeo del turno con el color del pulsador
    gameMode: 'puntos', // 'puntos' (clásico) | 'vidas' (modo de juego 2)
    livesStart: 5,      // vidas iniciales al Restablecer en modo vidas
    livesFail: false,   // modo vidas: fallar la pregunta resta 1 vida (check fallo=-1)
  };

  const COLORS = ['rojo', 'azul', 'verde', 'amarillo', 'morado', 'blanco'];
  const NAPIS = ['napirojo', 'napiazul', 'napiverde', 'napiamarillo', 'napiblank'];
  // color del pulsador de cada jugador (halo del parpadeo al pulsar)
  const PLAYER_COLOR_HEX = { rojo: '#e5484d', azul: '#4da3ff', verde: '#52c41a', amarillo: '#ffd75e', morado: '#a855f7', blanco: '#ffffff' };

  // Animaciones rotativas al rearmar (procedimentales; si existe
  // /anim/<napi>_<anim>.png se usa como sprite estático con el mismo movimiento)
  const ANIMS = ['globos', 'salto', 'giro', 'baile', 'barrer', 'correr', 'despegue',
                 'fiesta', 'teleport', 'nado', 'equilibrio', 'acrobacia', 'crecer',
                 'aplausos'];

  const ANIM_TAGS = {
    globos: '¡PREPARATE... PREGUNTA INTENSA!',
    salto: '¡A SALTAR! ESTA PREGUNTA TRAE TRAMPOLIN',
    giro: '¡GIRA! QUE LA PREGUNTA TE PILLE GIRANDO',
    baile: '¡A BAILAR! MUEVE ESAS CADERAS Y ACIERTA',
    barrer: '¡BARRED A LOS RIVALES!',
    correr: '¡CORRE! ESTA SE LA SABE HASTA MI ABUELA',
    despegue: '¡DESPEGUE INMINENTE! PREGUNTA ORBITAL',
    fiesta: '¡FIESTA! Y DE PROPINA, PREGUNTA',
    teleport: '¡TELEPORT! PREGUNTA DE OTRO PLANETA',
    nado: '¡A NADAR! ME LA ENSEÑARON EN PARVULOS',
    equilibrio: '¡EQUILIBRIO! NI TE CAIGAS NI FALLES',
    acrobacia: '¡ACROBACIA! TRIPLE SALTO MORTAL DE PREGUNTA',
    crecer: '¡CRECER! HOY LA GLORIA ESPERA',
    aplausos: '¡APLAUSOS! ¡RESPUESTA CORRECTA!',
    focos: '¡FOCOS! ¡LA ESTRELLA BAJO LOS REFLECTORES!',
  };

  const CONFETTI_COLORS = ['#e5484d', '#4da3ff', '#ffd75e', '#52c41a', '#ff7ae0', '#ff9d2e'];

  // texto visible de una animación: el personalizado (cfg.animTags, guardado en
  // la placa) o el original de ANIM_TAGS si no se ha tocado
  function tagText(anim) {
    const t = cfg.animTags && cfg.animTags[anim];
    return (t && t.trim()) || ANIM_TAGS[anim] || '¡REARME!';
  }

  // duración visible (ms) de la parte central de una animación: la que fije el
  // super en el panel (cfg.animDur, segundos) o la de sistema (la melodía 1-bit)
  function animDurMs(anim) {
    const s = cfg.animDur && cfg.animDur[anim];
    if (s && s > 0) return Math.min(120, Math.round(s)) * 1000;
    return tuneDurMs(anim);
  }

  const state = DEB.state = {
    phase: 'idle',
    winner: null,
    order: [],
    turn: 0,
    times: [],      // segundero: ms del 1º (desde pregunta visible) y +Δ de cada siguiente
    pulseOrder: [], // numeración GLOBAL de pulsación de la pregunta: sobrevive a
    // la reapertura tras fallos (el 4º en pulsar sigue siendo 4º aunque la
    // ronda se reabra); se limpia con nueva pregunta/rearme/quitar (idle)
    invalid: false,
    timerLeft: 0,
    timerHandle: null,
    animIdx: 0,
  };
  let t0LocalMs = 0; // base local del segundero (sin firmware): armado/reapertura
  let pulseLocalMs = []; // instantes locales de cada pulsación del order actual

  let cfg = DEB.cfg = loadCfg();
  let layoutDefault = null;
  let layout = null;

  const $ = (id) => document.getElementById(id);

  // ---------- Persistencia ----------
  function loadCfg() {
    try {
      const raw = localStorage.getItem(LS_CFG);
      if (raw) return Object.assign({}, DEFAULT_CFG, JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return JSON.parse(JSON.stringify(DEFAULT_CFG));
  }

  function saveCfg() {
    // _ts: el servidor descarta cfg más viejos que el almacenado (anti-stale)
    cfg._ts = Date.now();
    localStorage.setItem(LS_CFG, JSON.stringify(cfg));
    lastSentCfgJson = JSON.stringify(cfg);
    cfgSentHistory.push(lastSentCfgJson);
    if (cfgSentHistory.length > 16) cfgSentHistory.shift();
    send({ t: 'cfg', cfg });
  }

  let lastSentCfgJson = null;
  let lastSentLayoutJson = null;
  // historial de envíos propios: un eco retrasado no debe pisar lo tecleado después
  const cfgSentHistory = [];
  // última fase remota aplicada: una reentrega idéntica (reconexión/eco) no
  // debe re-sonar ni re-renderizar (pruebafixconexion1)
  let lastPhaseSig = null;

  DEB.saveCfg = saveCfg;

  function loadLayout() {
    if (!layoutDefault) return layout;
    try {
      const raw = localStorage.getItem(LS_LAYOUT);
      if (raw) {
        const saved = JSON.parse(raw);
        return mergeLayout(layoutDefault, saved);
      }
    } catch (e) { /* ignore */ }
    return layoutDefault;
  }

  function mergeLayout(base, over) {
    const out = JSON.parse(JSON.stringify(base));
    for (const n of ['2', '3', '4']) {
      if (!over[n]) continue;
      if (over[n].napi) out[n].napi = over[n].napi;
      if (over[n].text) Object.assign(out[n].text, over[n].text);
      if (over[n].off) out[n].off = over[n].off;
    }
    if (over.title) Object.assign(out.title, over.title);
    if (over.hud) out.hud = over.hud;
    return out;
  }

  DEB.saveLayout = () => {
    localStorage.setItem(LS_LAYOUT, JSON.stringify(layout));
    lastSentLayoutJson = JSON.stringify(layout);
    send({ t: 'layout', layout });
  };

  DEB.resetLayout = () => {
    localStorage.removeItem(LS_LAYOUT);
    layout = layoutDefault;
    renderStage();
  };

  // ---------- Subida de imágenes (fondo y napis) ----------
  const NAPI_FILES = { napirojo: 'napirojo.png', napiazul: 'napiazul.png', napiverde: 'napiverde.png', napiamarillo: 'napiamarillo.png', napiblank: 'napiblank.png', napicambios: 'napicambios.png' };
  let imgBust = 0; // cache-buster: cambia tras cada subida para forzar recarga

  function bustImg(el) {
    const base = el.src.split('?')[0];
    el.src = base + '?v=' + imgBust;
  }

  async function uploadImg(file, remoteName, aviso) {
    if (!file) return;
    if (file.size > 1048576) {
      log('Imagen de más de 1 MB: bloqueada (' + (file.size / 1048576).toFixed(2) + ' MB)');
      return;
    }
    const fd = new FormData();
    fd.append('file', new File([file], remoteName, { type: file.type }));
    try {
      const r = await fetch('/api/upload?dir=img', { method: 'POST', body: fd });
      if (!r.ok) {
        log('Subida rechazada por el ESP32 (' + r.status + ')');
        return;
      }
      imgBust++;
      bustAllImgs();
      log(aviso + ' (' + remoteName + ')');
      refreshFsChip();
      if (localDemo) log('Modo local: la imagen no se guarda en el ESP32');
    } catch (e) {
      log('Sin ESP32: sube la web con fs_tool para cambiar imágenes');
    }
  }

  function bustAllImgs() {
    bustImg($('bg'));
    bustImg($('mini-bg'));
    document.querySelectorAll('#players .player .napi').forEach(bustImg);
    document.querySelectorAll('#mini-players .napi').forEach(bustImg);
  }

  // restaura la copia original del ESP32 (la de referencia: la que trajo el
  // firmware, nunca se pierde)
  async function resetImg(remoteName, aviso) {
    try {
      const r = await fetch('/api/img/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: remoteName }),
      });
      if (!r.ok) {
        log('Sin copia original de ' + remoteName + ' en el ESP32 (' + r.status + ')');
        return;
      }
      imgBust++;
      bustAllImgs();
      log(aviso + ' (' + remoteName + ')');
      refreshFsChip();
    } catch (e) {
      log('Sin ESP32: restaura con fs_tool desde firmware\\data');
    }
  }

  function buildNapiUploaders() {
    const wrap = $('napi-uploaders');
    if (!wrap) return;
    wrap.innerHTML = '';
    NAPIS.forEach((id) => {
      const row = document.createElement('div');
      row.className = 'row';
      const lbl = document.createElement('span');
      lbl.className = 'hint';
      lbl.textContent = id;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png';
      input.id = 'img-' + id;
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Subir PNG';
      btn.addEventListener('click', () => {
        const f = input.files && input.files[0];
        uploadImg(f, NAPI_FILES[id], 'Napi ' + id + ' actualizado');
      });
      const btnR = document.createElement('button');
      btnR.className = 'btn';
      btnR.textContent = 'Restaurar original';
      btnR.title = 'Vuelve a la imagen original que traía el firmware';
      btnR.addEventListener('click', () => resetImg(NAPI_FILES[id], 'Napi ' + id + ' restaurado'));
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = 'PNG transparente · 681×800 (la misma para todos) · máx 1 MB';
      row.appendChild(lbl);
      row.appendChild(input);
      row.appendChild(btn);
      row.appendChild(btnR);
      row.appendChild(hint);
      wrap.appendChild(row);
    });
    // fila especial: napi de las ANIMACIONES (napicambios)
    const row = document.createElement('div');
    row.className = 'row';
    const lbl = document.createElement('span');
    lbl.className = 'hint';
    lbl.textContent = 'napicambios (napi de animaciones — por defecto)';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png';
    input.id = 'img-napicambios';
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Subir PNG';
    btn.addEventListener('click', () => {
      const f = input.files && input.files[0];
      uploadImg(f, 'napicambios.png', 'Napi de animaciones actualizado');
    });
    const btnR = document.createElement('button');
    btnR.className = 'btn';
    btnR.textContent = 'Restaurar original';
    btnR.title = 'Vuelve al napicambios.png original que traía el firmware';
    btnR.addEventListener('click', () => resetImg('napicambios.png', 'Napi de animaciones restaurado'));
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'PNG · 681×800 · el que sale en todas las animaciones';
    row.appendChild(lbl);
    row.appendChild(input);
    row.appendChild(btn);
    row.appendChild(btnR);
    row.appendChild(hint);
    wrap.appendChild(row);
  }

  // ---------- Utilidades ----------
  const BASE_H = 543;

  function playerRect(i) {
    const key = String(cfg.numPlayers);
    const r = layout.players[key].napi[i] || { x: 0, y: 0, w: 200, h: 543 };
    if (key === '4') return r;
    // con 2/3 jugadores se REORDENAN (posición del layout propio) pero NO se
    // agrandan: mismo tamaño que con 4, centrado en la zona que ocupa el layout
    const b = layout.players['4'].napi[i] || r;
    return {
      x: r.x + (r.w - b.w) / 2,
      y: r.y + (r.h - b.h) / 2,
      w: b.w,
      h: b.h,
    };
  }

  function anchorFor(i) {
    const info = layout.napis.find((n) => n.id === cfg.players[i].napi) || layout.napis[0];
    return info ? info.anchor : { cx: 0.5, cy: 0.782, w: 0.66, h: 0.275 };
  }

  function layoutText() {
    const key = String(cfg.numPlayers);
    // mismo tamaño de letra que con 4 jugadores (los layouts 2/3 no se agrandan)
    const t = layout.players['4'].text || layout.players[key].text || { name: 24, points: 28 };
    // tamaño del segundero (text.ptime): por defecto un 55% del de los puntos
    if (t.ptime === undefined) t.ptime = Math.round((t.points || 28) * 0.55);
    return t;
  }

  function layoutOff(i) {
    const key = String(cfg.numPlayers);
    const offs = layout.players['4'].off || layout.players[key].off;
    const o = offs && offs[i] ? offs[i] : {};
    if (!o.ptime) o.ptime = { x: 0, y: 0 };
    if (!o.name) o.name = { x: 0, y: 0 };
    if (!o.points) o.points = { x: 0, y: 0 };
    return o;
  }

  DEB.playerRect = playerRect;
  DEB.anchorFor = anchorFor;
  DEB.layoutText = layoutText;
  DEB.layoutOff = layoutOff;
  DEB.layout = () => layout;

  // zona de la cara por defecto (fracciones del rect del jugador); se puede
  // ajustar por napi en el layout (napis[].face). Para napiblank coincide con
  // la "pantalla negra" del casco del robot.
  const FACE_DEFAULT = { cx: 0.507, cy: 0.285, w: 0.26, h: 0.17 };
  // zona del botón del pecho (el overlay pinta el color del pulsador encima)
  const BTN_DEFAULT = { cx: 0.501, cy: 0.464, w: 0.20, h: 0.14 };
  const FACE_FUNS = ['fx-normal', 'fx-happy', 'fx-wink', 'fx-surprise', 'fx-cool', 'fx-love', 'fx-zzz'];

  // actualiza el gesto de la cara de cada jugador según el estado
  function updateFaces() {
    if (!cfg.faceDigital) return;
    document.querySelectorAll('#players .player').forEach((el, i) => {
      const facer = el.querySelector('.facer');
      if (!facer) return;
      const pts = cfg.players[i].points;
      let cls = 'fx-normal';
      if (muerto(i)) {
        cls = 'fx-x'; // eliminado (0 vidas): la X permanece hasta revivir o Restablecer
      } else if (state.phase === 'timeout' && state.order.length &&
          (state.order[state.turn] === i || (state.winner === i && state.order.length === 1))) {
        cls = 'fx-x'; // tiempo agotado en su turno
      } else if (faceFailPlayers.has(i)) {
        cls = 'fx-x'; // falló (Falso): la X neón se mantiene hasta rearmar
      } else if (state.phase === 'pressed' && state.winner === i) {
        cls = 'fx-surprise'; // acaba de pulsar
      } else if (state.phase === 'rebounce' && state.order.length && state.order[state.turn] === i) {
        cls = 'fx-wink'; // es su turno
      } else if (pts >= 10) {
        cls = 'fx-happy'; // buen ánimo con buenas puntuaciones
      } else if (state.phase === 'idle' || state.phase === 'armed') {
        cls = FACE_FUNS[Math.floor(Math.random() * FACE_FUNS.length)];
      }
      facer.classList.remove('fx-normal', 'fx-happy', 'fx-sad', 'fx-wink', 'fx-surprise', 'fx-x', 'fx-cool', 'fx-love', 'fx-zzz');
      facer.classList.add(cls);
    });
  }

  // vidilla en espera: cambia el gesto aleatorio cada 5-9 s
  let faceFailPlayers = new Set(); // jugadores que fallaron (Falso): X neón hasta rearme/quitar pregunta

  // ---------- Modo de juego 2 (vidas) ----------
  // En modo vidas el contador de puntos son VIDAS: todos empiezan con
  // cfg.livesStart (al Restablecer), el acierto NO suma y es el super quien
  // quita 1 vida a la víctima elegida (botón −1). Un jugador con ≤ 0 vidas
  // está ELIMINADO: X fija (derivada del estado, no un flag temporal: sobrevive
  // a rearmes/reconexiones), no participa y su turno se salta solo.
  function esModoVidas() { return cfg.gameMode === 'vidas'; }
  function muerto(i) {
    return esModoVidas() && cfg.players[i] && cfg.players[i].points <= 0;
  }
  function vidasIniciales() {
    const v = parseInt(cfg.livesStart, 10);
    return isFinite(v) && v > 0 ? Math.min(20, v) : 5;
  }

  let faceFunTimer = null;
  function scheduleFaceFun() {
    if (faceFunTimer) clearTimeout(faceFunTimer);
    faceFunTimer = setTimeout(() => {
      faceFunTimer = null;
      if (cfg.faceDigital && (state.phase === 'idle' || state.phase === 'armed')) {
        document.querySelectorAll('#players .player').forEach((el) => {
          const facer = el.querySelector('.facer');
          const idx = parseInt(el.dataset.i, 10);
          if (facer && !el.classList.contains('lit') && !(idx >= 0 && (faceFailPlayers.has(idx) || muerto(idx)))) {
            facer.classList.remove('fx-normal', 'fx-happy', 'fx-sad', 'fx-wink', 'fx-surprise', 'fx-x', 'fx-cool', 'fx-love', 'fx-zzz');
            facer.classList.add(FACE_FUNS[Math.floor(Math.random() * FACE_FUNS.length)]);
          }
        });
      }
      scheduleFaceFun();
    }, 5000 + Math.random() * 4000);
  }

  // ---------- Render ----------
  function buildPlayer(container, i) {
    const p = cfg.players[i];
    const r = playerRect(i);
    const a = anchorFor(i);
    const t = layoutText();
    const off = layoutOff(i);

    const div = document.createElement('div');
    div.className = 'player';
    div.dataset.i = i;
    div.style.left = r.x + 'px';
    div.style.top = r.y + 'px';
    div.style.width = r.w + 'px';
    div.style.height = r.h + 'px';
    div.style.setProperty('--player-color', PLAYER_COLOR_HEX[p.color] || '#ffffff');

    const img = document.createElement('img');
    img.className = 'napi';
    // lazy: si el escenario está oculto (bajo el login), el navegador NO baja
    // las imágenes en cada refresco (evita saturar el servidor y cortar el JS)
    img.loading = 'lazy';
    img.src = 'img/' + p.napi + '.png' + (imgBust ? '?v=' + imgBust : '');
    img.alt = '';

    const scale = r.h / BASE_H;
    const boxTop = (a.cy - a.h / 2) * 100;
    const boxLeft = (a.cx - a.w / 2) * 100;

    const name = document.createElement('div');
    name.className = 'pname';
    name.style.left = boxLeft + '%';
    name.style.width = a.w * 100 + '%';
    name.style.top = ((a.cy - a.h * 0.42) * 100) + '%';
    name.style.height = a.h * 42 + '%';
    name.style.fontSize = Math.round(t.name * scale * 0.42) + 'px';
    name.style.transform = 'translate(' + off.name.x + 'px,' + off.name.y + 'px)';
    name.textContent = p.name;

    // línea de puntos: la puntuación a la derecha (off.points la recoloca);
    // el segundero del pulso (.ptime) es un elemento aparte con su propio
    // offset (off.ptime) y tamaño (text.ptime) — movibles por separado
    const points = document.createElement('div');
    points.className = 'ppoints';
    points.style.left = boxLeft + '%';
    points.style.width = a.w * 100 + '%';
    points.style.top = (boxTop + a.h * 52) + '%';
    points.style.height = (a.h * 30) + '%';
    points.style.fontSize = Math.round(t.points * scale * 0.6) + 'px';
    points.style.transform = 'translate(' + off.points.x + 'px,' + off.points.y + 'px)';
    const pval = document.createElement('span');
    pval.className = 'pval';
    pval.textContent = p.points;
    points.appendChild(pval);
    // segundero del pulso: misma caja que los puntos pero offset propio
    const ptime = document.createElement('span');
    ptime.className = 'ptime';
    ptime.style.left = boxLeft + '%';
    ptime.style.width = a.w * 100 + '%';
    ptime.style.top = (boxTop + a.h * 52) + '%';
    ptime.style.height = (a.h * 30) + '%';
    ptime.style.fontSize = Math.round((t.ptime) * scale * 0.6) + 'px';
    const ptOff = off.ptime || { x: 0, y: 0 };
    ptime.style.transform = 'translate(' + ptOff.x + 'px,' + ptOff.y + 'px)';

    const badge = document.createElement('div');
    badge.className = 'badge';

    // rostro digital 8-bit: overlay de gestos para napis sin cara dibujada.
    // La zona de la cara es configurable por napi en el layout (face);
    // el overlay vive dentro de .player, así que se mueve con el napi.
    const pulsColorHex = PLAYER_COLOR_HEX[p.color] || '#ffffff';
    if (cfg.faceDigital) {
      const info = layout.napis.find((n) => n.id === p.napi) || layout.napis[0];
      const f = (info && info.face) || FACE_DEFAULT;
      const facer = document.createElement('div');
      facer.className = 'facer';
      facer.style.left = (f.cx - f.w / 2) * 100 + '%';
      facer.style.top = (f.cy - f.h / 2) * 100 + '%';
      facer.style.width = f.w * 100 + '%';
      facer.style.height = f.h * 100 + '%';
      facer.innerHTML = '<div class="f-eyes"><div class="f-eye f-eye-l"></div><div class="f-eye f-eye-r"></div></div>' +
        '<div class="f-mouth"></div>';
      div.appendChild(facer);
      // overlay del botón del pecho: pinta encima del botón del napi el color
      // del pulsador del jugador (p. ej. el morado del napi blank)
      const btp = (info && info.btn) || BTN_DEFAULT;
      const btnov = document.createElement('div');
      btnov.className = 'btn-ov';
      btnov.style.left = (btp.cx * 100) + '%';
      btnov.style.top = (btp.cy * 100) + '%';
      btnov.style.width = btp.w * 100 + '%';
      btnov.style.height = btp.h * 100 + '%';
      btnov.style.setProperty('--btn-color', pulsColorHex);
      div.appendChild(btnov);
    }

    div.appendChild(img);
    div.appendChild(name);
    div.appendChild(ptime);
    div.appendChild(points);
    div.appendChild(badge);
    div.addEventListener('pointerdown', () => { if (!DEB.editing) press(i); });
    container.appendChild(div);
  }

  function renderPlayers(container) {
    container.innerHTML = '';
    for (let i = 0; i < cfg.numPlayers; i++) buildPlayer(container, i);
  }

  DEB.renderPlayers = renderPlayers;

  function renderStage() {
    if (!layout) return; // el layout aún no ha cargado: nada que pintar
    renderPlayers($('players'));
    renderTitle();
    renderQuestion();
    renderClock();
    applyPhaseUI();
    updateTurnButtons();
    updateFaces();
  }

  DEB.renderStage = renderStage;

  // HUD recolocables del escenario (el editor los mueve con nudges/arrastre):
  // la pregunta, el mensaje de estado (¡PULSÓ!/REBOTE/TIEMPO), la cuenta atrás
  // y el reloj. dx/dy = desplazamiento sobre su posición calculada; size = px.
  const HUD_DEFAULT = {
    question: { dx: 0, dy: 0, size: 54 },
    msg: { dx: 0, dy: 0, size: 64 },
    timer: { dx: 0, dy: 0, size: 160 },
    clock: { dx: 0, dy: 0, size: 26 },
  };
  function hudCfg() {
    // rellena con los defaults cualquier clave HUD que falte (un layout puede
    // tener layout.hud parcial si solo se movió un elemento) → nunca undefined
    const h = (layout && layout.hud) ? layout.hud : {};
    for (const k of Object.keys(HUD_DEFAULT)) {
      if (!h[k]) h[k] = { dx: 0, dy: 0, size: HUD_DEFAULT[k].size };
    }
    return h;
  }
  DEB.hudCfg = hudCfg;
  DEB.HUD_DEFAULT = HUD_DEFAULT;

  // el reloj se posiciona arriba a la derecha (base top 26 / right 42) y el
  // editor lo puede desplazar (hud.clock.dx/dy) y redimensionar (size)
  function renderClock() {
    const el = $('clock');
    if (!el) return;
    const c = hudCfg().clock || HUD_DEFAULT.clock;
    el.style.fontSize = (c.size || HUD_DEFAULT.clock.size) + 'px';
    el.style.top = (26 + (c.dy || 0)) + 'px';
    el.style.right = (42 - (c.dx || 0)) + 'px';
  }

  function renderTitle() {
    const el = $('pixel-title');
    if (!layout || !layout.title) return;
    el.textContent = layout.title.text || '';
    // centrado con desplazamiento: left 50% + translateX(-50%+x) (antes con
    // width:100% el x no tenía efecto y los nudges del título "no funcionaban")
    el.style.left = '50%';
    el.style.width = 'auto';
    el.style.top = (layout.title.y || 0) + 'px';
    el.style.fontSize = layout.title.size + 'px';
    el.style.transform = 'translate(calc(-50% + ' + (layout.title.x || 0) + 'px), 0)';
    el.style.textAlign = 'center';
  }

  function renderQuestion() {
    const el = $('question');
    const h = hudCfg();
    const baseTop = (layout && layout.title)
      ? layout.title.y + layout.title.size * 1.6 + 20
      : 0;
    if (cfg.question && cfg.question.trim()) {
      el.textContent = cfg.question;
      el.classList.add('visible');
      // centrada debajo del título, con un espacio lógico (el editor puede
      // desplazarla con hud.question.dx/dy y cambiar su tamaño)
      el.style.fontSize = (h.question.size || HUD_DEFAULT.question.size) + 'px';
      el.style.top = (baseTop + (h.question.dy || 0)) + 'px';
      el.style.left = 'calc(50% + ' + (h.question.dx || 0) + 'px)';
    } else {
      el.classList.remove('visible');
    }
    // mensajes de estado y cuenta atrás debajo de la pregunta, midiendo lo real
    const qH = el.offsetHeight || 68;
    const msg = $('state-msg');
    msg.style.fontSize = (h.msg.size || HUD_DEFAULT.msg.size) + 'px';
    msg.style.top = (baseTop + qH + 40 + (h.msg.dy || 0)) + 'px';
    msg.style.left = 'calc(50% + ' + (h.msg.dx || 0) + 'px)';
    const timer = $('timer');
    timer.style.fontSize = (h.timer.size || HUD_DEFAULT.timer.size) + 'px';
    timer.style.top = (baseTop + qH + 40 + (msg.offsetHeight || 74) + 30 + (h.timer.dy || 0)) + 'px';
    timer.style.left = 'calc(50% + ' + (h.timer.dx || 0) + 'px)';
  }

  function applyPhaseUI() {
    const players = document.querySelectorAll('#players .player');
    players.forEach((el) => el.classList.remove('lit', 'flash-invalid'));
    players.forEach((el, i) => {
      el.classList.toggle('idle-breath', state.phase === 'idle');
      el.style.animationDelay = (i * 0.5) + 's';
    });

    const msg = $('state-msg');
    msg.classList.remove('armed', 'pressed', 'timeout');
    const timerEl = $('timer');

    if (state.phase === 'armed') {
      // sin cartel: solo la pregunta en pantalla
      msg.classList.remove('visible');
      msg.textContent = '';
    } else if (state.phase === 'pressed') {
      msg.textContent = '¡' + cfg.players[state.winner].name + ' PULSÓ!';
      msg.classList.add('visible', 'pressed');
      const el = players[state.winner];
      el.classList.add('lit');
      el.style.setProperty('--blink', blinkFor(state.timerLeft));
      el.style.setProperty('--pulse-color', (cfg.haloColor ? PLAYER_COLOR_HEX[cfg.players[state.winner].color] : null) || '#ffffff');
    } else if (state.phase === 'rebounce') {
      const ti = Math.min(state.turn, state.order.length - 1);
      msg.textContent = state.order.length > 1
        ? 'REBOTE · ' + cfg.players[state.order[ti]].name
        : 'SOLO ' + cfg.players[state.winner].name + ' PULSÓ';
      msg.classList.add('visible', 'pressed');
      const el = players[state.order[ti]];
      el.classList.add('lit');
      el.style.setProperty('--blink', '1.2s');
      el.style.setProperty('--pulse-color', (cfg.haloColor ? PLAYER_COLOR_HEX[cfg.players[state.order[ti]].color] : null) || '#ffffff');
    } else if (state.phase === 'timeout') {
      msg.textContent = 'TIEMPO';
      msg.classList.add('visible', 'timeout');
    } else {
      msg.textContent = '';
      msg.classList.remove('visible');
    }

    players.forEach((el, i) => {
      const b = el.querySelector('.badge');
      const pt = el.querySelector('.ptime');
      const pos = state.order.indexOf(i);
      const posG = state.pulseOrder.indexOf(i); // numeración global (sobrevive a la reapertura)
      // segundero: el 1º muestra su tiempo desde la pregunta visible y cada
      // siguiente su +incremento respecto al anterior (dos decimales)
      if (pt) {
        if (pos >= 0 && state.times && state.times[pos] !== undefined) {
          const abs = state.times[pos];
          const fmt = (ms) => (ms / 1000).toFixed(2).replace('.', ',');
          if ((state.times[0] || 0) > 0) {
            // pruebatiempos1: hay base de pregunta → tiempo absoluto + Δ pequeño
            let html = fmt(abs) + ' s';
            if (pos > 0) {
              const d = abs - state.times[pos - 1];
              if (d > 0) html += ' <span class="ptime-d">(+' + fmt(d) + ')</span>';
            }
            pt.innerHTML = html;
          } else {
            // standby sin pregunta: times[] es la cadena de Δs → solo el Δ
            if (pos > 0) pt.textContent = abs > 0 ? '+' + fmt(abs) : '';
            else pt.textContent = '';
          }
        } else {
          pt.textContent = '';
        }
      }
      if (state.phase === 'idle' || state.phase === 'armed') {
        b.style.display = 'none'; // fuera de ronda: nunca se ve el nº de orden
        return;
      }
      if (posG === 0) b.textContent = '1º';
      else if (posG === 1) b.textContent = '2º';
      else if (posG === 2) b.textContent = '3º';
      else if (posG === 3) b.textContent = '4º';
      b.style.display = (pos >= 0 && !muerto(i)) ? 'block' : 'none';
    });

    if (cfg.timer.on && state.timerLeft > 0) {
      timerEl.textContent = state.timerLeft;
      timerEl.classList.toggle('low', state.timerLeft <= 3);
      timerEl.classList.add('visible');
    } else {
      timerEl.classList.remove('visible');
    }

    const chip = $('phase-chip');
    chip.className = 'chip';
    const map = {
      idle: ['ESPERANDO', 'chip-dim'],
      armed: ['PREGUNTA', ''],
      pressed: ['¡PULSADO!', 'chip-pressed'],
      rebounce: ['REBOTE', 'chip-bounce'],
      timeout: ['TIEMPO', 'chip-bounce'],
    };
    const [txt, cls] = map[state.phase];
    chip.textContent = txt;
    if (cls) chip.classList.add(cls);
  }

  function blinkFor(left) {
    if (left <= 2) return '0.15s';
    if (left <= 4) return '0.35s';
    return '0.7s';
  }

  function setLitBlink() {
    const players = document.querySelectorAll('#players .player');
    if (state.phase === 'pressed' && state.winner !== null && players[state.winner]) {
      players[state.winner].style.setProperty('--blink', blinkFor(state.timerLeft));
    }
  }

  // ---------- Sonidos (Web Audio sintetizados + MP3 sobrescribibles) ----------
  let audioCtx = null;
  const audioCache = {};
  let sndBust = 0; // cache-buster de MP3: cambia al subir/borrar (viaja en cfg.sndBust)
  // el navegador bloquea el audio sin un gesto previo del usuario (autoplay):
  // el proyector es pasivo, así que el primer clic/toque/tecla sobre él
  // "desbloquea" el contexto (audioUnlocked) — sin esto Chrome/Safari ignoran
  // resume() y NO suena nada (sesión 8: "ha dejado de sonar el proyector")
  let audioUnlocked = false;

  function audio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended' && audioUnlocked) audioCtx.resume();
    return audioCtx;
  }

  // primer gesto del usuario sobre la ventana: desbloquea el audio (requisito
  // de autoplay de Chrome/Safari/Edge). El proyector pide un toque inicial.
  function unlockAudioOnce() {
    audioUnlocked = true;
    try {
      const ctx = audio();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { /* sin audio */ }
  }
  // primer gesto del usuario sobre la ventana: desbloquea el audio (requisito
  // de autoplay de Chrome/Safari/Edge). Se registra en TODAS las páginas (el
  // super también proyecta desde la pestaña Proyección del index); el aviso
  // visual solo existe en proyector.html (en el index el primer clic en
  // cualquier botón/pestaña ya desbloquea en silencio).
  {
    const evs = ['pointerdown', 'keydown', 'touchstart'];
    const unlock = () => {
      unlockAudioOnce();
      const aviso = $('audio-unlock');
      if (aviso) aviso.classList.add('off');
      try { chiNote(880, 0.08, 0, 0.12); chiNote(1175, 0.12, 0.09, 0.12); } catch (e) { /* sin audio */ }
      evs.forEach((t) => window.removeEventListener(t, unlock));
    };
    evs.forEach((t) => window.addEventListener(t, unlock, { passive: true }));
  }

  function tone(f0, f1, dur, type, vol, delay) {
    if (!esProyeccion()) return; // el audio solo suena en ventanas de proyección
    const ctx = audio();
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // nota chiptune 16-bit (estilo NES): onda cuadrada + octava doblada, con
  // ataque instantáneo y decaimiento rápido — más "de consola" que tone()
  function chiNote(f, dur, delay, vol) {
    if (!esProyeccion()) return; // el audio solo suena en ventanas de proyección
    const ctx = audio();
    const t0 = ctx.currentTime + (delay || 0);
    const v = vol || 0.15;
    const notes = [[f, v], [f * 2, v * 0.4]];
    for (const [freq, gv] of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t0);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(gv, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.06);
    }
  }

  // frase chiptune: lista de frecuencias con su duración (staccato por defecto)
  function chiSeq(notes, vol) {
    let t = 0;
    for (const [f, d] of notes) {
      chiNote(f, d, t, vol);
      t += d + 0.035;
    }
  }

  // reproduce un sonido (MP3 o síntesis) o lo retransmite al proyector:
  // la pestaña AJUSTES del panel es un mando y NUNCA suena: sus sonidos (los
  // automáticos del juego y los que ejecuta el super) se envían a las ventanas
  // de proyección (por BC en local o por el ESP32); aquí solo suenan las
  // ventanas de proyección (proyector.html o la pestaña Proyección del index)
  function playFile(name, synth) {
    if (!cfg.sound.on) return;
    if (!esProyeccion()) {
      send({ t: 'sfx', name: name }); // panel → proyector
      return;
    }
    try {
      // el ?v= (cfg.sndBust) invalida el MP3 cacheado del navegador tras
      // subir/borrar uno nuevo con el mismo nombre de slot (sesión 8)
      const bust = (cfg.sndBust || sndBust || 0);
      const url = 'snd/' + name + '.mp3' + (bust ? '?v=' + bust : '');
      const el = audioCache[name] && audioCache[name].src === url
        ? audioCache[name]
        : (audioCache[name] = new Audio(url));
      el.currentTime = 0;
      const p = el.play();
      if (p && p.catch) p.catch(() => { if (synth) synth(); });
    } catch (e) {
      if (synth) synth();
    }
  }

  // el clásico cuack (doble, estilo pato) — chiptune
  function playQuack() {
    try {
      for (let i = 0; i < 2; i++) {
        const d = i * 0.21;
        chiNote(392, 0.07, d, 0.16);
        chiNote(330, 0.14, d + 0.07, 0.15);
        chiNote(262, 0.1, d + 0.2, 0.12);
      }
    } catch (e) { /* sin audio */ }
  }

  // éxito al sumar puntos: arpegio chiptune de victoria (E4 G4 C5 E5 G5)
  function playOk() {
    try {
      chiSeq([[330, 0.09], [392, 0.09], [523, 0.09], [659, 0.09], [784, 0.2], [1047, 0.3]], 0.15);
    } catch (e) { /* sin audio */ }
  }

  // fallo al restar puntos: bocina chiptune (tres bocinazos con zumbido)
  function playFail() {
    try {
      for (let i = 0; i < 3; i++) {
        const d = i * 0.34;
        chiNote(233, 0.16, d, 0.14);
        chiNote(185, 0.16, d + 0.08, 0.14);
        chiNote(117, 0.24, d + 0.16, 0.12);
      }
    } catch (e) { /* sin audio */ }
  }

  // beep al armar la pregunta: fanfarria corta
  function playArm() {
    try {
      chiNote(440, 0.08, 0, 0.14);
      chiNote(587, 0.08, 0.09, 0.14);
      chiNote(880, 0.18, 0.18, 0.15);
    } catch (e) { /* sin audio */ }
  }

  // error en pulsación inválida: zumbido descendente de NES
  function playWrong() {
    try {
      chiNote(262, 0.09, 0, 0.15);
      chiNote(208, 0.09, 0.1, 0.15);
      chiNote(156, 0.09, 0.2, 0.15);
      chiNote(117, 0.3, 0.3, 0.14);
    } catch (e) { /* sin audio */ }
  }

  // tick-tac del reloj agotándose (alterna tic agudo / tac grave)
  let tickAlt = false;
  function playTick() {
    try {
      tickAlt = !tickAlt;
      chiNote(tickAlt ? 1568 : 1047, 0.045, 0, 0.1);
    } catch (e) { /* sin audio */ }
  }

  // blip genérico de pulsación (fallback si no hay press_<napi>.mp3)
  function playDink() {
    try {
      chiNote(740, 0.06, 0, 0.14);
      chiNote(988, 0.1, 0.06, 0.12);
    } catch (e) { /* sin audio */ }
  }

  // reset de puntos: sweep descendente con octava (estilo GameBoy)
  function playReset() {
    try {
      tone(520, 60, 0.55, 'sawtooth', 0.16, 0);
      chiNote(392, 0.2, 0.1, 0.08);
    } catch (e) { /* sin audio */ }
  }

  // rearme estilo 50x15: tres notas rotas descendentes (PUM PUM PUM) chiptune
  function playRearm() {
    try {
      chiSeq([[196, 0.14], [196, 0.14], [196, 0.14], [156, 0.5]], 0.18);
    } catch (e) { /* sin audio */ }
  }

  const SFX_SYNTHS = { quack: playQuack, ok: playOk, fail: playFail, arm: playArm, wrong: playWrong, tick: playTick, reset: playReset, rearm: playRearm };

  const ANIM_SOUNDS = {
    globos: () => { // burbujas ascendentes
      chiSeq([[392, 0.08], [494, 0.08], [587, 0.08], [740, 0.08], [880, 0.12], [1175, 0.2]], 0.13);
    },
    salto: () => { // boing: sube y rebota
      chiNote(196, 0.1, 0, 0.15);
      chiNote(330, 0.12, 0.1, 0.15);
      chiNote(494, 0.08, 0.22, 0.15);
      chiNote(659, 0.06, 0.3, 0.13);
      chiNote(494, 0.14, 0.38, 0.12);
    },
    giro: () => { // arpegio circular rápido
      chiSeq([[523, 0.07], [659, 0.07], [784, 0.07], [1047, 0.07], [784, 0.07], [659, 0.07], [523, 0.07], [659, 0.1], [784, 0.2]], 0.13);
    },
    baile: () => { // ritmo dance con octava
      chiSeq([[330, 0.09], [392, 0.09], [440, 0.09], [523, 0.12], [440, 0.09], [392, 0.09], [330, 0.09], [392, 0.14], [330, 0.09], [392, 0.09], [440, 0.09], [523, 0.2]], 0.15);
    },
    barrer: () => { // whoosh con cola
      tone(600, 90, 0.5, 'sawtooth', 0.14, 0);
      chiNote(262, 0.12, 0.42, 0.07);
    },
    correr: () => { // pasos rápidos
      for (let i = 0; i < 10; i++) chiNote(i % 2 ? 147 : 131, 0.045, i * 0.07, 0.12);
    },
    despegue: () => { // rugido ascendente con chispa
      tone(70, 360, 1.35, 'sawtooth', 0.16, 0);
      chiSeq([[196, 0.08], [262, 0.08], [330, 0.08], [392, 0.08], [523, 0.1], [659, 0.12], [784, 0.2]], 0.1);
    },
    fiesta: () => { // fanfarria alegre
      chiSeq([[523, 0.07], [659, 0.07], [784, 0.07], [1047, 0.12], [784, 0.07], [1047, 0.12], [1319, 0.25]], 0.14);
    },
    teleport: () => { // zigzag teletransporte
      chiSeq([[1175, 0.06], [880, 0.06], [1175, 0.06], [880, 0.06], [1568, 0.06], [1175, 0.06], [880, 0.08], [523, 0.3]], 0.13);
    },
    nado: () => { // burbujas
      chiNote(600, 0.06, 0, 0.1);
      chiNote(800, 0.06, 0.15, 0.1);
      chiNote(1000, 0.06, 0.3, 0.1);
      chiNote(1200, 0.1, 0.45, 0.09);
    },
    equilibrio: () => { // wobble
      chiNote(294, 0.12, 0, 0.13);
      chiNote(330, 0.12, 0.14, 0.13);
      chiNote(294, 0.12, 0.28, 0.13);
      chiNote(262, 0.12, 0.42, 0.13);
      chiNote(294, 0.2, 0.56, 0.12);
    },
    acrobacia: () => { // giros ascendentes
      chiSeq([[392, 0.07], [494, 0.07], [587, 0.07], [784, 0.07], [659, 0.07], [880, 0.07], [784, 0.07], [1047, 0.2]], 0.13);
    },
    crecer: () => { // crece: slide largo
      tone(150, 900, 1.5, 'square', 0.12, 0);
      chiNote(1047, 0.3, 1.4, 0.1);
    },
    focos: () => { // encendido de focos: 4 destellos + remate
      for (let i = 0; i < 4; i++) chiNote(1319, 0.045, i * 0.16, 0.12);
      chiNote(1047, 0.1, 0.9, 0.1);
      chiSeq([[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.22], [1319, 0.34]], 0.12);
    },
  };

  // sonidos de "arranque" aleatorios al rearmar
  const STARTUP_SOUNDS = {
    rocket: () => { tone(60, 240, 1.1, 'sawtooth', 0.2, 0); tone(120, 480, 1.1, 'sawtooth', 0.12, 0.15); },
    rev: () => { tone(120, 320, 0.35, 'sawtooth', 0.18, 0); tone(150, 380, 0.4, 'sawtooth', 0.18, 0.3); tone(180, 460, 0.5, 'sawtooth', 0.18, 0.6); },
    warp: () => { tone(200, 1400, 0.5, 'sine', 0.18, 0); tone(1400, 200, 0.5, 'sine', 0.18, 0.55); },
    powerup: () => { const n = [523.25, 659.25, 783.99, 1046.5, 1318.5]; n.forEach((f, i) => tone(f, f, 0.07, 'square', 0.14, i * 0.06)); },
    spring: () => { tone(150, 700, 0.25, 'sine', 0.25, 0); tone(700, 250, 0.3, 'sine', 0.2, 0.25); },
    laser: () => { tone(900, 300, 0.25, 'square', 0.15, 0); tone(1200, 400, 0.3, 'square', 0.15, 0.2); },
  };
  const STARTUP_POOL = ['rocket', 'rev', 'warp', 'powerup', 'spring', 'laser'];
  const STARTUP_FOR_ANIM = {
    despegue: 'rocket', correr: 'rev', teleport: 'warp', crecer: 'powerup',
    salto: 'spring', giro: 'warp', nado: 'laser', acrobacia: 'warp', barrer: 'rev',
  };

  function playStartup(anim) {
    const name = STARTUP_FOR_ANIM[anim] || STARTUP_POOL[Math.floor(Math.random() * STARTUP_POOL.length)];
    playFile('startup_' + name, STARTUP_SOUNDS[name]);
  }

  function playAnimSound(anim) {
    playFile(anim, ANIM_SOUNDS[anim]);
  }

  // efecto de sonido distribuido: el panel lo envía al proyector; la
  // proyección lo reproduce localmente (playFile decide según la ventana)
  function sfx(name) {
    playFile(name, SFX_SYNTHS[name]);
  }

  // ---------- Máquina de estados ----------
  function arm() {
    if (state.phase === 'armed') return;
    stopTimer();
    state.phase = 'armed';
    state.winner = null;
    state.order = [];
    state.times = [];
    state.pulseOrder = []; // pregunta nueva: la numeración de pulsación reinicia
    pulseLocalMs = [];
    t0LocalMs = Date.now(); // base del segundero: la pregunta queda visible
    log('Pregunta armada');
    renderStage();
    send({ t: 'phase', phase: state.phase });
  }

  function press(i) {
    if (wsOk) {
      // ventana de proyección: el toque en un napi es SOLO feedback sonoro
      // local (gesto que desbloquea el audio — autoplay) — nunca registra
      // pulsación (las reales van por pulsadores físicos o el botón Puls)
      if (esProyeccion()) {
        unlockAudioOnce();
        const napi = (cfg.players[i] && cfg.players[i].napi) || 'napirojo';
        playFile('press_' + napi, playDink);
      }
      return;
    }
    pressInternal(i);
  }

  function pressInternal(i) {
    // los pulsadores viven SIEMPRE: se puede pulsar en idle (standby, sin
    // pregunta) para registrar el orden y juzgar con Verdad/Falso. En rebounce
    // (turno de otro) la pulsación se ENCOLA para cuando llegue su turno (el
    // firmware hace lo mismo con los pulsadores físicos); solo el aviso de
    // tiempo agotado rechaza.
    if (state.phase === 'timeout') {
      const el = document.querySelectorAll('#players .player')[i];
      if (el) {
        el.classList.add('flash-invalid');
        setTimeout(() => el.classList.remove('flash-invalid'), 500);
      }
      playFile('wrong', playWrong);
      log('Pulsación inválida (tiempo agotado): ' + cfg.players[i].name);
      return;
    }
    // un jugador eliminado (0 vidas en modo vidas) no participa: se ignora
    if (muerto(i)) {
      const el = document.querySelectorAll('#players .player')[i];
      if (el) {
        el.classList.add('flash-invalid');
        setTimeout(() => el.classList.remove('flash-invalid'), 500);
      }
      log('Pulsación de ' + cfg.players[i].name + ' ignorada (sin vidas: no participa)');
      return;
    }
    // quien ya ha fallado esta pregunta no vuelve a pulsar (tiene la X)
    if (faceFailPlayers.has(i)) {
      const el = document.querySelectorAll('#players .player')[i];
      if (el) {
        el.classList.add('flash-invalid');
        setTimeout(() => el.classList.remove('flash-invalid'), 500);
      }
      playFile('wrong', playWrong);
      log('Pulsación de ' + cfg.players[i].name + ' ignorada (ya ha fallado esta pregunta)');
      return;
    }
    if (state.phase === 'rebounce') {
      // el turno es de otro: si este aún no está en la cola, se añade (hasta
      // 4) para responder cuando le toque — sin tocar el turno actual
      if (state.order.length < 4 && state.order.indexOf(i) === -1) {
        state.order.push(i);
        if (state.pulseOrder.indexOf(i) === -1) state.pulseOrder.push(i);
        const nowR = Date.now();
        pulseLocalMs.push(nowR);
        state.times = pulseLocalMs.map((ms, k) => {
          // pruebatiempos1: absoluto desde la base; sin base (standby) cadena de Δs
          if (t0LocalMs) return ms - t0LocalMs;
          return k === 0 ? 0 : ms - pulseLocalMs[k - 1];
        });
        log(cfg.players[i].name + ' en cola — ' + state.order.length + 'º');
        playFile('press_' + cfg.players[i].napi, playDink);
        renderStage();
        send({ t: 'phase', phase: 'rebounce', winner: state.winner, order: state.order, times: state.times });
      }
      return;
    }
    if (state.phase === 'idle' || state.phase === 'armed') {
      state.phase = 'pressed';
      state.winner = i;
      state.order.push(i);
      if (state.pulseOrder.indexOf(i) === -1) state.pulseOrder.push(i);
      state.turn = 0;
      // segundero local (pruebatiempos1): absoluto desde t0LocalMs; si no hay
      // base (standby) se deja la cadena de Δs (times[0]=0)
      const now = Date.now();
      pulseLocalMs.push(now);
      state.times = pulseLocalMs.map((ms, k) => {
        if (t0LocalMs) return ms - t0LocalMs;
        return k === 0 ? 0 : ms - pulseLocalMs[k - 1];
      });
      log('Pulsó: ' + cfg.players[i].name);
      playFile('press_' + cfg.players[i].napi, playDink);
      if (cfg.timer.on) startTimer(cfg.timer.secs);
      renderStage();
      send({ t: 'phase', phase: state.phase, winner: i, order: state.order, times: state.times });
      return;
    }
    // phase === 'pressed': se registran los demás pulsadores en orden (hasta 4)
    if (state.order.length < 4 && state.order.indexOf(i) === -1) {
      state.order.push(i);
      if (state.pulseOrder.indexOf(i) === -1) state.pulseOrder.push(i);
      const now2 = Date.now();
      pulseLocalMs.push(now2);
      state.times = pulseLocalMs.map((ms, k) => {
        if (t0LocalMs) return ms - t0LocalMs;
        return k === 0 ? 0 : ms - pulseLocalMs[k - 1];
      });
      log('Pulsó en ' + (state.order.length) + 'º lugar: ' + cfg.players[i].name);
      renderStage();
      send({ t: 'phase', phase: state.phase, winner: state.winner, order: state.order, times: state.times });
    }
  }

  // Reset de pulsadores: vuelve los pulsadores a STANDBY sin tocar la pregunta
  // ni los puntos — limpia el orden de pulsación (badges), el turno, el
  // temporizador y los fallos (X) para que todos puedan volver a pulsar
  function resetPulsadores() {
    stopTimer();
    state.winner = null;
    state.order = [];
    state.turn = 0;
    state.times = [];
    state.pulseOrder = [];
    pulseLocalMs = [];
    if (faceFailPlayers.size > 0) {
      faceFailPlayers.clear();
      send({ t: 'facefail', player: -1 });
    }
    if (cfg.question && cfg.question.trim()) {
      // hay pregunta en pantalla: quedan armados y a la espera de pulsación
      arm();
    } else {
      state.phase = 'idle';
      t0LocalMs = 0;
      renderStage();
      send({ t: 'phase', phase: 'idle' });
    }
    log('Pulsadores en standby (listos para pulsar)');
  }
  DEB.resetPulsadores = resetPulsadores;

  // Pasa el turno al siguiente jugador (o cierra la ronda). El panel lo
  // aplica AL INSTANTE (optimista, sin esperar el eco) y envía el estado:
  // el ESP32 reafirma o corrige. El rebote local antiguo no enviaba phase y
  // el proyector se quedaba atrás en el turno (síntoma del super).
  function avanzarTurno() {
    if (!state.order.length) return;
    // modo vidas: el turno salta SOLO a los eliminados (no participan)
    let next = state.turn + 1;
    while (esModoVidas() && next < state.order.length && muerto(state.order[next])) next++;
    if (next < state.order.length) {
      state.turn = next;
      state.phase = 'rebounce';
      log('Rebote → ' + cfg.players[state.order[state.turn]].name);
      if (!wsOk) {
        if (cfg.timer.on) startTimer(cfg.timer.secs);
        playFile('quack', playQuack); // el panel lo retransmite al proyector
      }
      renderStage();
      send({ t: 'phase', phase: 'rebounce', winner: state.winner, order: state.order, turn: state.turn });
    } else {
      // ¿todos los que pulsaron han FALLADO (o están eliminados) y quedan
      // jugadores vivos sin pulsar y sin X? → la ronda NO se cierra: se reabre
      // para que puedan responder (el fallo deja fuera al que falló; el
      // acierto sí resuelve la pregunta)
      const quedan = [];
      for (let i = 0; i < cfg.numPlayers; i++) {
        if (state.order.indexOf(i) === -1 && !faceFailPlayers.has(i) && !muerto(i)) quedan.push(i);
      }
      if (quedan.length > 0 && state.order.every((j) => faceFailPlayers.has(j) || muerto(j))) {
        log('Nadie acertó: se abre la ronda para quien no ha pulsado');
        state.phase = 'armed';
        state.winner = null;
        state.order = [];
        state.turn = 0;
        state.times = [];
        pulseLocalMs = [];
        t0LocalMs = Date.now(); // nueva fase de pulsación: el segundero reinicia
        stopTimer();
        renderStage();
        send({ t: 'phase', phase: 'armed' });
        return;
      }
      log('Ronda cerrada (último turno)');
      phaseIdle();
      send({ t: 'phase', phase: 'idle' });
    }
  }

  // modo vidas: si acaban de quitar la última vida al jugador del turno actual
  // (o el único del order), su turno se salta solo / la ronda se cierra o reabre
  function reconciliarMuertos() {
    if (!esModoVidas() || !state.order.length) return;
    const actual = state.order[Math.min(state.turn, state.order.length - 1)];
    if (muerto(actual)) avanzarTurno();
  }
  DEB.avanzarTurno = avanzarTurno;

  function rebote() {
    if (state.phase !== 'pressed' && state.phase !== 'rebounce') {
      log('Rebote sin ronda activa');
      return;
    }
    // pruebabotonfalso1: el rebote manual del panel marca la X del jugador al
    // que se le pasa el turno (como el Falso, SIN el sonido de fallo y SIN
    // restar vida en modo vidas). El rebote físico (GPIO9/BOOT) llega por el
    // "xfail" del broadcast del firmware y cada ventana la añade al recibirlo.
    const saliente = state.order[Math.min(state.turn, state.order.length - 1)];
    if (saliente !== undefined && !faceFailPlayers.has(saliente) && !muerto(saliente)) {
      faceFailPlayers.add(saliente);
      log('Rebote manual: ' + cfg.players[saliente].name + ' marcado con X');
      send({ t: 'facefail', player: saliente });
    }
    avanzarTurno();
  }

  function rearm() {
    const prevPhase = state.phase;
    stopTimer();
    // cancelar un lanzamiento en curso: la ronda no debe armarse sola después
    if (questionLaunchTimer) clearTimeout(questionLaunchTimer);
    questionLaunchTimer = null;
    log('Rearme (nueva pregunta)');
    // La animación del Rearme se muestra siempre que haya algo que cerrar:
    // ronda en curso, explicación abierta, X de fallo o pregunta en pantalla
    // (la ronda se cierra sola tras el juicio del último turno → el Rearme
    // llega en idle y hasta ahora se saltaba la animación). Se captura ANTES
    // de limpiar la pregunta/explicación.
    const explEl = $('expl-overlay');
    const explOn = explEl ? explEl.classList.contains('on') : false;
    const teniaPregunta = cfg.question && cfg.question.trim() !== '';
    const cerrable = (prevPhase === 'pressed' || prevPhase === 'rebounce' || prevPhase === 'timeout') ||
      explOn || faceFailPlayers.size > 0 || teniaPregunta;
    // cierre de ronda completo: quita la pregunta de pantalla y la explicación
    cfg.question = '';
    cfg.explanation = '';
    saveCfg();
    renderQuestion();
    hideExpl();
    send({ t: 'expl-off' });
    if (cfg.anim.on && cerrable) {
      const animPlayer = state.winner !== null ? state.winner : 0;
      const anim = 'focos'; // el Rearme tiene su propia animación (focos del techo)
      if (wsOk) {
        // la animación la reproduce el cliente que proyecta
        send({ t: 'anim', player: animPlayer, anim: anim });
        phaseIdle(true);
      } else {
        // modo local: la retransmitimos; aquí solo se muestra si es proyección
        send({ t: 'anim', player: animPlayer, anim: anim });
        if (esProyeccion()) {
          runRearmAnim(animPlayer, () => phaseIdle(true), anim);
        } else {
          phaseIdle(true);
        }
      }
    } else {
      phaseIdle(true);
    }
    send({ t: 'phase', phase: 'idle' });
  }

  // cierra la ronda. clearFail=true solo cuando es un REARME manual o quitar
  // pregunta: limpia (y anuncia) el gesto de fallo; el cierre automático de
  // ronda (último turno) NO lo limpia — la X permanece hasta el rearme
  function phaseIdle(clearFail) {
    state.phase = 'idle';
    state.winner = null;
    state.order = [];
    state.turn = 0;
    state.times = [];
    state.pulseOrder = []; // ronda cerrada: la numeración de pulsación reinicia
    pulseLocalMs = [];
    t0LocalMs = 0;
    if (clearFail && faceFailPlayers.size > 0) {
      faceFailPlayers.clear();
      send({ t: 'facefail', player: -1 });
    }
    renderStage();
  }

  // Lanzar pregunta: animación de transición (si toggle ON) y luego arma la ronda.
  // La pregunta se guarda cuando el blackout ya cubre la pantalla (la anim se
  // envía primero) para que no se vea un parpadeo antes de la animación.
  // Si se lanza otra pregunta durante la transición, la nueva gana (se relanza).
  let questionLaunchTimer = null;
  function launchQuestion() {
    if (questionLaunchTimer) clearTimeout(questionLaunchTimer);
    questionLaunchTimer = null;
    stopTimer();
    // lanzar OTRA pregunta cierra la ronda anterior de forma automática (sin
    // necesitar Rearme/Quitar): se quita el orden/badges/mensajes (idle) y la
    // X de fallo — todos pueden responder la pregunta nueva. La pregunta nueva
    // se guarda bajo la animación (saveCfg a los 3 s) y al final se arma.
    if (state.phase !== 'idle' && state.phase !== 'armed') {
      phaseIdle();
      send({ t: 'phase', phase: 'idle' });
    }
    if (faceFailPlayers.size > 0) {
      faceFailPlayers.clear();
      send({ t: 'facefail', player: -1 });
    }
    const prevWinner = state.winner !== null ? state.winner : 0;
    // El armado tras LANZAR una pregunta es el único momento en que suena el
    // slot 'arm' (el MP3 de "sale la pregunta"): se envía explícito desde aquí
    // y NO al recibir cualquier phase armed (reaperturas/resets no suenan).
    // cfg.sound.q (botón "Sonido pregunta") lo silencia si el super quiere.
    const doArm = () => {
      questionLaunchTimer = null;
      arm();
      if (cfg.sound.q !== false) playFile('arm', playArm);
    };
    if (cfg.anim.on) {
      const anim = ANIMS[state.animIdx++ % ANIMS.length];
      if (wsOk) {
        send({ t: 'anim', player: prevWinner, anim: anim });
        // la pregunta se guarda a los 3 s: el blackout de la animación ya está
        // puesto y la pregunta se descubre justo al terminar (nunca antes)
        setTimeout(saveCfg, 3000);
        questionLaunchTimer = setTimeout(doArm, animTotalMs(anim) + 300); // duración real de la transición + margen
      } else {
        // modo local: la retransmitimos (para la pestaña de proyección) y la
        // mostramos aquí solo si esta ventana es de proyección; el armado se
        // programa con questionLaunchTimer (así rearm/quitar pregunta pueden
        // cancelarlo antes de que dispare)
        send({ t: 'anim', player: prevWinner, anim: anim });
        setTimeout(saveCfg, 3000);
        questionLaunchTimer = setTimeout(doArm, animTotalMs(anim) + 300);
        if (esProyeccion()) runRearmAnim(prevWinner, () => {}, anim);
      }
    } else {
      // anim OFF: la pregunta se guarda y se arma. Si el sonido de "sale la
      // pregunta" está activo, la pregunta espera a que termine su sonido
      // (slot 'arm': MP3 si hay, si no el de sistema) — el sfx se envía ya
      // para que la proyección lo reproduzca, y la pregunta se descubre al
      // terminar (dur + cola). Con el sonido desactivado sale directa.
      const sonidoQ = cfg.sound.on && cfg.sound.q !== false;
      if (sonidoQ) {
        qDurMs().then((dur) => {
          send({ t: 'sfx', name: 'arm' });
          setTimeout(saveCfg, dur + 250);
          questionLaunchTimer = setTimeout(doArm, dur + 400);
        });
      } else {
        saveCfg();
        doArm();
      }
    }
  }
  DEB.launchQuestion = launchQuestion;

  // ---------- Acierto Verdadero/Falso (panel del super) ----------
  // Verdad = +1 (aplausos + explicación); Falso = -1 (bocina). El super es el juez.
  // tamaño del texto de la explicación: ajustable y con tope razonable
  // (si no hay mucho texto no es gigante; si lo hay, baja y se puede leer)
  function fitExplSize(txt) {
    const n = Math.max(20, txt.length);
    return Math.max(20, Math.min(52, Math.round(2400 / n) * 1.6)) + 'px';
  }

  function showExpl(txt) {
    const ov = $('expl-overlay');
    if (!ov) return;
    const t = $('expl-text');
    t.textContent = txt || '';
    t.style.fontSize = fitExplSize(txt || '');
    const bo = $('blackout');
    if (bo) bo.classList.remove('on');
    ov.classList.add('on');
  }

  function hideExpl() {
    const ov = $('expl-overlay');
    if (ov) ov.classList.remove('on');
  }
  DEB.hideExpl = hideExpl;

  // secuencia del acierto: animación de aplausos → fundido → explicación centrada.
  // La reproduce la pestaña de proyección (vía {t:'anim'} y {t:'expl'});
  // en modo local (BC) también esta pestaña.
  function showAplausos(i) {
    const anim = 'aplausos';
    const txt = cfg.explanation || cfg.question || '';
    const tTotal = animTotalMs(anim) + 650;
    send({ t: 'anim', player: i, anim: anim });
    if (txt) setTimeout(() => send({ t: 'expl', text: txt }), tTotal);
    if (!wsOk && bc && esProyeccion()) {
      runRearmAnim(i, () => {}, anim);
      if (txt) setTimeout(() => showExpl(txt), tTotal);
    }
  }

  // veredicto del super: verdad=+1 (aplausos+explicación); falso=gesto de
  // fallo SIN restar puntos (el super resta a mano con −1 si hay infracción).
  // Modo vidas: el acierto NO suma (el super quita 1 vida a la víctima con −1)
  // y con cfg.livesFail (fallo=-1) el fallo SÍ resta 1 vida propia.
  function vfAnswer(i, verdad) {
    stopTimer(); // el juicio cierra la cuenta atrás del turno
    if (verdad) {
      if (!esModoVidas()) {
        cfg.players[i].points += 1;
        saveCfg();
        log(cfg.players[i].name + ': VERDADERO (+1)');
      } else {
        log(cfg.players[i].name + ': VERDADERO — elige a quién quitar 1 vida (−1)');
      }
      sfx('ok');
      showAplausos(i);
    } else {
      if (esModoVidas() && cfg.livesFail) {
        cfg.players[i].points -= 1;
        saveCfg();
        log(cfg.players[i].name + ': FALSO (−1 vida)');
        if (muerto(i)) log(cfg.players[i].name + ' ELIMINADO (0 vidas)');
      } else {
        log(cfg.players[i].name + ': FALSO (fallo)');
      }
      sfx('fail');
    }
    renderAdmin();
    renderStage();
    // breve destello del botón usado (feedback del 2º toque)
    const btn = document.querySelector('.vf-btn.' + (verdad ? 'vf-verdad' : 'vf-falso') + '[data-player="' + i + '"]');
    if (btn) {
      btn.classList.add('vf-ok');
      setTimeout(() => btn.classList.remove('vf-ok'), 900);
    }
    if (!verdad) {
      // el jugador que ha fallado muestra la X neón HASTA que se rearme o se
      // quite la pregunta (phaseIdle lo limpia); el rebote NO la quita y cada
      // jugador que falla conserva la suya
      faceFailPlayers.add(i);
      renderStage();
      send({ t: 'facefail', player: i }); // el proyector también lo muestra
    }
    avanzarTurno(); // el turno del jugador juzgado termina: rebote al siguiente (o cierre)
  }
  DEB.vfAnswer = vfAnswer;

  // doble toque en Verdad/Falso (evita falsas pulsaciones): 1er toque selecciona
  // (azul), 2º toque sobre el mismo ejecuta; 3 s sin 2º toque deselecciona
  let vfPending = { player: -1, verdad: null, timer: null };
  function clearVfPending() {
    if (vfPending.timer) clearTimeout(vfPending.timer);
    vfPending = { player: -1, verdad: null, timer: null };
  }
  function vfClick(i, verdad) {
    if (vfPending.player === i && vfPending.verdad === verdad) {
      clearVfPending();
      vfAnswer(i, verdad);
      return;
    }
    clearVfPending();
    vfPending = {
      player: i,
      verdad: verdad,
      timer: setTimeout(() => {
        vfPending = { player: -1, verdad: null, timer: null };
        updateTurnButtons();
      }, 3000),
    };
    updateTurnButtons();
  }
  DEB.vfClick = vfClick;

  // activa los botones V/F solo del jugador cuyo turno es responder
  function updateTurnButtons() {
    // si el turno cambia, una selección V/F pendiente no debe quedar armada
    if (vfPending.player >= 0) {
      const esTurnoPend = (state.phase === 'pressed' || state.phase === 'rebounce') &&
        state.order.length > 0 && state.order[state.turn] === vfPending.player;
      if (!esTurnoPend) clearVfPending();
    }
    document.querySelectorAll('.vf-btn').forEach((b) => {
      const i = parseInt(b.dataset.player, 10);
      const esTurno = (state.phase === 'pressed' || state.phase === 'rebounce') &&
        state.order.length > 0 && state.order[state.turn] === i;
      b.disabled = !esTurno;
      b.classList.toggle('on-turn', esTurno);
      b.classList.toggle('vf-sel', vfPending.player === i &&
        vfPending.verdad === (b.classList.contains('vf-verdad') ? true : false));
    });
  }

  // simular la pulsación del pulsador físico del jugador i (p. ej. si falla la placa)
  function simPress(i) {
    if (muerto(i)) {
      log('Pulsación de ' + cfg.players[i].name + ' ignorada (sin vidas: no participa)');
      return;
    }
    if (wsOk) {
      // el firmware trata 'pressed' con winner como una pulsación real (onBuzzerPress)
      send({ t: 'phase', phase: 'pressed', winner: i });
    } else {
      pressInternal(i);
    }
    log('Pulsación de ' + cfg.players[i].name);
  }
  DEB.simPress = simPress;

  // doble toque del botón "Mostrar explicación" (evita mostrarla por error):
  // 1er toque selecciona, 2º toque la muestra; 3 s sin 2º toque deselecciona
  let explPending = null;
  function explClick() {
    const btn = $('btn-expl');
    if (explPending) {
      clearTimeout(explPending);
      explPending = null;
      if (btn) btn.classList.remove('sel');
      mostrarExplicacion();
      return;
    }
    explPending = setTimeout(() => {
      explPending = null;
      if (btn) btn.classList.remove('sel');
    }, 3000);
    if (btn) btn.classList.add('sel');
  }
  DEB.explClick = explClick;

  // muestra la explicación de la pregunta en el proyector SIN animación de
  // acierto ni puntos (el super la usa cuando nadie acierta y quiere enseñar
  // la respuesta); se cierra con Rearme/Quitar pregunta o al lanzar otra
  function mostrarExplicacion() {
    const txt = cfg.explanation || cfg.question || '';
    if (!txt.trim()) {
      log('No hay explicación ni pregunta en pantalla para mostrar');
      return;
    }
    sfx('ok');
    send({ t: 'expl', text: txt });
    if (!wsOk && bc && esProyeccion()) showExpl(txt);
    log('Explicación mostrada (manual)');
  }
  DEB.mostrarExplicacion = mostrarExplicacion;

  // ---------- Transición de rearme (blackout sándwich + animación rotativa) ----------
  function spawnConfetti() {
    const box = document.querySelector('#anim-overlay .anim-box');
    if (!box) return;
    const old = box.querySelectorAll('.confetti');
    old.forEach((c) => c.remove());
    for (let i = 0; i < 14; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = (4 + Math.random() * 92) + '%';
      c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      c.style.animationDuration = (1.1 + Math.random() * 1.1) + 's';
      c.style.animationDelay = (Math.random() * 1.2) + 's';
      box.appendChild(c);
    }
  }

  let animRunning = false;

  // partículas decorativas por animación (estrellas, notas, burbujas...)
  function spawnFx(box, cls, n, colores) {
    if (!box) return;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'fx ' + cls;
      el.style.left = (6 + Math.random() * 88) + '%';
      el.style.top = (12 + Math.random() * 66) + '%';
      el.style.background = colores[i % colores.length];
      el.style.color = colores[i % colores.length];
      el.style.animationDelay = (Math.random() * 2.4) + 's';
      el.style.setProperty('--fx-d', (2 + Math.random() * 2.2) + 's');
      el.style.setProperty('--sx', Math.round(Math.random() * 120 - 60) + 'px');
      el.style.setProperty('--sy', Math.round(-60 - Math.random() * 90) + 'px');
      box.appendChild(el);
    }
  }

  // globos de verdad para la animación 'globos': suben por los LADOS del napi
  function spawnGlobos() {
    const box = document.querySelector('#anim-overlay .anim-box');
    if (!box) return;
    box.querySelectorAll('.globo').forEach((g) => g.remove());
    const colores = ['#e5484d', '#4da3ff', '#ffd75e', '#52c41a', '#ff7ae0', '#ff9d2e', '#a855f7', '#7cf7ff'];
    const laterales = [3, 10, 17, 24, 76, 83, 90, 97]; // a los lados del napi centrado
    for (let i = 0; i < 8; i++) {
      const g = document.createElement('div');
      g.className = 'globo';
      // estilos inline defensivos: si el CSS no ha llegado (caché), los globos
      // NO deben verse como barras en línea que desplazan el contenido
      g.style.position = 'absolute';
      g.style.bottom = '-180px';
      g.style.left = (laterales[i] + Math.random() * 4) + '%';
      g.style.width = (70 + Math.random() * 50) + 'px';
      g.style.height = (88 + Math.random() * 60) + 'px';
      g.style.opacity = '0';
      g.style.background = 'radial-gradient(circle at 35% 30%, ' + colores[i % colores.length] +
        ' 0%, rgba(0,0,0,.5) 135%)';
      g.style.setProperty('--dur', (3.4 + Math.random() * 1.6) + 's');
      g.style.setProperty('--sway', Math.round(Math.random() * 70 - 35) + 'px');
      g.style.animationDelay = (i * 0.28 + Math.random() * 0.35) + 's';
      box.appendChild(g);
    }
  }

  // Melodías 1-bit (onda cuadrada) por animación: pares [frecuencia, duración s].
  // La animación se adapta: dura la melodía + cola, con un mínimo de 5.4 s
  // (3 s más que la animación original de 2.4 s).
  const ANIM_TUNES = {
    globos: [[523, .18], [659, .18], [784, .18], [1047, .22], [784, .18], [1047, .3], [784, .18], [659, .18], [523, .18], [659, .18], [784, .18], [1047, .55]],
    salto: [[160, .08], [240, .08], [360, .08], [540, .1], [720, .1], [960, .12], [720, .1], [540, .1], [360, .08], [240, .08], [160, .12], [80, .2]],
    giro: [[500, .12], [600, .12], [700, .12], [800, .12], [900, .12], [1000, .12], [900, .12], [800, .12], [700, .12], [600, .12], [500, .12], [400, .2]],
    baile: [[392, .12], [392, .12], [392, .18], [311, .12], [370, .12], [370, .12], [370, .18], [311, .12], [392, .12], [392, .12], [392, .18], [311, .12], [370, .12], [370, .24], [370, .3]],
    barrer: [[700, .12], [620, .12], [540, .12], [470, .12], [400, .12], [340, .12], [290, .12], [240, .15], [200, .15], [160, .2], [130, .25], [100, .3]],
    correr: [[120, .1], [140, .1], [160, .1], [180, .1], [200, .09], [220, .09], [240, .09], [260, .09], [280, .08], [300, .08], [320, .08], [340, .08], [360, .08], [380, .08], [400, .08], [420, .12]],
    despegue: [[150, .15], [180, .15], [220, .15], [260, .15], [310, .15], [370, .15], [440, .15], [520, .15], [620, .15], [740, .15], [880, .15], [1047, .2], [200, .4]],
    fiesta: [[523, .15], [523, .15], [523, .15], [659, .25], [784, .15], [659, .25], [523, .15], [784, .3], [988, .15], [784, .15], [659, .15], [523, .15], [659, .25], [784, .4]],
    teleport: [[400, .1], [500, .1], [630, .1], [800, .1], [1000, .1], [1260, .1], [1600, .12], [1260, .1], [1000, .1], [800, .1], [630, .1], [500, .1], [400, .15], [200, .25]],
    nado: [[330, .15], [392, .15], [440, .15], [392, .15], [330, .15], [392, .15], [440, .15], [392, .15], [494, .15], [440, .15], [392, .15], [330, .2], [392, .2], [330, .3]],
    equilibrio: [[440, .3], [392, .3], [440, .3], [392, .3], [523, .3], [440, .3], [392, .3], [330, .4], [392, .3], [440, .3], [392, .35], [330, .4]],
    acrobacia: [[660, .08], [740, .08], [660, .08], [740, .08], [880, .08], [740, .08], [880, .08], [990, .08], [880, .08], [990, .08], [1100, .08], [990, .08], [1100, .12], [880, .15], [740, .15], [660, .25]],
    crecer: [[262, .2], [294, .2], [330, .2], [349, .2], [392, .2], [440, .2], [494, .2], [523, .2], [587, .2], [659, .2], [698, .2], [784, .25], [880, .3], [988, .35], [1047, .5]],
    aplausos: [[392, .12], [392, .12], [392, .12], [392, .12], [494, .12], [494, .12], [494, .12], [494, .12], [587, .12], [587, .12], [587, .12], [587, .12], [659, .2], [659, .2], [659, .3], [784, .5]],
    focos: [[880, .07], [988, .07], [1047, .07], [1175, .07], [1319, .09], [1175, .09], [1047, .09], [880, .09], [988, .1], [1109, .1], [1319, .1], [1568, .12], [1319, .14], [1047, .16], [880, .2], [659, .26], [523, .3], [659, .3], [784, .3], [880, .3], [1047, .34], [1319, .5], [1568, .6], [1047, .7], [784, .9]],
  };

  function tuneDurMs(anim) {
    const seq = ANIM_TUNES[anim];
    if (!seq) return 5400;
    let t = 0;
    for (const [, d] of seq) t += d + 0.06;
    return Math.max(5400, Math.round(t * 1000) + 400);
  }

  function playTune(anim) {
    const seq = ANIM_TUNES[anim];
    if (!seq) return;
    let t = 0;
    for (const [f, d] of seq) {
      chiNote(f, d, t, 0.13); // nota + octava: melodía chiptune
      t += d + 0.06;
    }
  }

  // duración total de la transición (blackout + melodía/animación + blackout)
  function animTotalMs(anim) {
    return 380 + animDurMs(anim) + 380;
  }
  DEB.animTotalMs = animTotalMs;

  // duración de un MP3 del slot si existe (para animaciones cuya duración
  // debe seguir al sonido subido): carga la cabecera del audio y devuelve ms
  // (0 si el slot no tiene MP3 o tarda demasiado en responder)
  function mp3DurMs(name) {
    return new Promise((res) => {
      let el;
      try {
        // ?v= con cfg.sndBust: evita medir un MP3 viejo cacheado tras subir
        const bust = (cfg.sndBust || sndBust || 0);
        const url = 'snd/' + name + '.mp3' + (bust ? '?v=' + bust : '');
        el = (audioCache[name] && audioCache[name].src === url)
          ? audioCache[name]
          : (audioCache[name] = new Audio(url));
      } catch (e) { res(0); return; }
      const done = (v) => { clearTimeout(t); res(v); };
      const t = setTimeout(() => done(0), 450);
      if (el.readyState >= 1) {
        const d = el.duration;
        done((d && isFinite(d)) ? Math.round(d * 1000) : 0);
        return;
      }
      const ok = () => {
        el.removeEventListener('loadedmetadata', ok);
        el.removeEventListener('error', bad);
        const d = el.duration;
        done((d && isFinite(d)) ? Math.round(d * 1000) : 0);
      };
      const bad = () => {
        el.removeEventListener('loadedmetadata', ok);
        el.removeEventListener('error', bad);
        done(0);
      };
      el.addEventListener('loadedmetadata', ok);
      el.addEventListener('error', bad);
      try { el.load(); } catch (e) { done(0); }
    });
  }

  // duración del sonido del slot 'arm' (el de "sale la pregunta"): el MP3 del
  // slot si existe; si no, la del sonido de sistema (playArm ~0.45 s) con
  // margen. El timeout es mayor que mp3DurMs (la pila lenta puede tardar).
  const ARM_SYS_MS = 700;
  function qDurMs() {
    return new Promise((res) => {
      const slot = 'arm';
      let el;
      try {
        const bust = (cfg.sndBust || sndBust || 0);
        const url = 'snd/' + slot + '.mp3' + (bust ? '?v=' + bust : '');
        el = (audioCache[slot] && audioCache[slot].src === url)
          ? audioCache[slot]
          : (audioCache[slot] = new Audio(url));
      } catch (e) { res(ARM_SYS_MS); return; }
      const done = (v) => { clearTimeout(t); res(v > 0 ? v : ARM_SYS_MS); };
      const t = setTimeout(() => done(0), 1500);
      if (el.readyState >= 1) { done(Math.round((el.duration || 0) * 1000)); return; }
      const ok = () => {
        el.removeEventListener('loadedmetadata', ok);
        el.removeEventListener('error', bad);
        done(Math.round((el.duration || 0) * 1000));
      };
      const bad = () => {
        el.removeEventListener('loadedmetadata', ok);
        el.removeEventListener('error', bad);
        done(0);
      };
      el.addEventListener('loadedmetadata', ok);
      el.addEventListener('error', bad);
      try { el.load(); } catch (e) { done(0); }
    });
  }

  // 'focos' (animación del Rearme): focos del techo que barren el escenario de
  // lado a lado (los extremos con más recorrido) y convergen TODOS sobre el
  // napi (clímax dorado). Los ángulos apuntan al CENTRO REAL del napi medido en
  // runtime (sesión 8: el signo previo estaba invertido y los extremos se iban
  // hacia afuera; ahora cada eje cae sobre el napi). Coreografía en tiempos
  // relativos a la duración real de la animación (melodía o MP3 del slot).
  function focosShow(t2) {
    const ov = $('anim-overlay');
    const W = ov.clientWidth || 1920;
    const H = ov.clientHeight || 1080;
    const orr = ov.getBoundingClientRect();
    const napiEl = ov.querySelector('#anim-napi');
    let ncx = orr.left + W / 2;
    let ncy = orr.top + H * 0.48;
    if (napiEl) {
      const nr = napiEl.getBoundingClientRect();
      if (nr.width > 0) {
        ncx = nr.left + nr.width / 2;
        ncy = nr.top + nr.height / 2;
      }
    }
    // origen del giro de cada foco: cuelga del techo en x=l% (centro del
    // elemento) y el transform-origin está al 3% de su altura (top -4%)
    const oy = orr.top - 0.04 * H + 0.03 * 1.08 * H;
    const conf = [7, 36, 64, 93];
    const focos = conf.map((l) => {
      const f = document.createElement('div');
      f.className = 'foco';
      f.style.left = l + '%';
      ov.appendChild(f);
      const ox = orr.left + (l / 100) * W;
      // ángulo al napi (signo: rotate(+) en pantalla lleva el haz a la
      // izquierda → los focos de la izquierda del napi usan ángulo negativo)
      const tgt = -Math.atan2(ncx - ox, ncy - oy) * 180 / Math.PI;
      return { el: f, tgt: tgt };
    });
    const P = (p) => Math.round(p * t2);
    const rot = (k, a) => { focos[k].el.style.transform = 'rotate(' + a.toFixed(1) + 'deg)'; };
    const op = (k, o) => { focos[k].el.style.opacity = String(o); };
    const N = focos.length;
    // amplitud de barrido por foco: los extremos barren casi todo el escenario
    // (lado a lado, pasando por el napi), los centrales hacen un vaivén menor
    const amp = [34, 20, 20, 34];
    const sway = (k, desde, pasos) => {
      // vaivén: barre de 'desde' cruzando el napi (tgt) hasta el lado opuesto
      // y vuelve; pasos = giros escalonados en el tiempo (CSS suaviza)
      const aMin = focos[k].tgt - amp[k];
      const aMax = focos[k].tgt + amp[k];
      const pos = [aMax, aMin, aMax, aMin];
      for (let s = 0; s < pasos && s < pos.length; s++) {
        setTimeout(() => rot(k, pos[s]), desde + P(0.055 * (s + 1)));
      }
      return desde + P(0.055 * Math.min(pasos, pos.length));
    };

    // 1) encienden apuntando a su zona (los extremos, abiertos hacia fuera;
    //    los centrales, hacia el napi) y ya arrancan el vaivén de lado a lado
    focos.forEach((f, k) => {
      const ab = (k === 0 || k === 3) ? amp[k] * 0.9 : 8;
      const dir = (k === 3) ? -1 : 1;
      rot(k, f.tgt + dir * ab);
      setTimeout(() => { focos[k].el.classList.add('on'); }, P(0.03 + k * 0.012));
    });

    // 2) barrido lado a lado: cada foco cruza el napi 2 veces (ida y vuelta),
    //    escalonado entre focos para que se vea el reflector barriendo
    for (let k = 0; k < N; k++) {
      const t0 = P(0.10 + k * 0.045);
      const dir = (k === 3) ? -1 : 1;
      const pasos = [dir * amp[k], -dir * amp[k], dir * amp[k], -dir * amp[k]];
      pasos.forEach((d, s) => {
        setTimeout(() => rot(k, focos[k].tgt + d), t0 + P(0.075 * (s + 1)));
      });
    }

    // 3) cada foco su momento brillante: barre su lado a lado con el resto
    //    bajando la luz (escalonado), y vuelve a apuntar al napi
    for (let k = 0; k < N; k++) {
      const t0 = P(0.44 + k * 0.04);
      setTimeout(() => {
        focos.forEach((j) => op(j, 0.22));
        op(k, 1);
        const dir = (k === 3) ? -1 : 1;
        rot(k, focos[k].tgt + dir * amp[k]);
        setTimeout(() => rot(k, focos[k].tgt - dir * amp[k]), P(0.06));
        setTimeout(() => rot(k, focos[k].tgt), P(0.11));
      }, t0);
    }

    // 4) convergencia al napi (escalonada) y clímax: todos lo iluminan
    const tC = P(0.64);
    focos.forEach((f, k) => setTimeout(() => rot(k, f.tgt), tC + k * 210));
    setTimeout(() => {
      focos.forEach((f, k) => op(k, 1));
      ov.classList.add('focos-hit');
    }, tC + N * 210 + 60);
  }

  function runRearmAnim(playerIdx, done, forcedAnim) {
    if (animRunning) return; // solo una animación a la vez
    animRunning = true;
    const anim = forcedAnim || ANIMS[state.animIdx++ % ANIMS.length];
    const p = cfg.players[playerIdx];
    const overlay = $('anim-overlay');
    const napi = $('anim-napi');

    // Personaje de la animación, en orden: 1) GIF subido por el usuario para
    // esta animación (anima solo; sin movimiento procedural) 2) PNG subido por
    // el usuario (con el movimiento de la animación) 3) sprite de serie
    // anim/napicambios_<anim>.png si existiera 4) napicambios (de serie)
    // 5) napi del jugador (plan B). Lo que no existe falla y encadena.
    // El ?v= usa la versión GLOBAL (cfg.imgBust: cambia al subir/quitar y viaja
    // a todas las pantallas) → el navegador reutiliza el GIF cacheado entre
    // shows y solo lo re-descarga cuando realmente cambia.
    const bustV = (cfg.imgBust || imgBust || 0);
    const bust = bustV ? '?v=' + bustV : '';
    const candidatos = [
      'anim/' + anim + '.gif',
      'anim/' + anim + '.png',
      'anim/napicambios_' + anim + '.png',
      'img/napicambios.png',
      'img/' + p.napi + '.png',
    ];
    const setGifMode = (on) => overlay.classList.toggle('anim-gif-mode', on);
    const probar = (idx) => {
      if (idx >= candidatos.length) return;
      const im = new Image();
      im.onload = () => {
        napi.src = candidatos[idx] + bust;
        setGifMode(candidatos[idx].indexOf('.gif') >= 0);
      };
      im.onerror = () => probar(idx + 1);
      im.src = candidatos[idx] + bust;
    };
    setGifMode(false);
    probar(0);

    const tag = overlay.querySelector('.anim-tag');
    tag.textContent = tagText(anim); // el super puede personalizarlo (panel Textos)

    overlay.classList.remove(
      'anim-globos', 'anim-salto', 'anim-giro', 'anim-baile', 'anim-barrer',
      'anim-correr', 'anim-despegue', 'anim-fiesta', 'anim-teleport',
      'anim-nado', 'anim-equilibrio', 'anim-acrobacia', 'anim-crecer',
      'anim-aplausos', 'anim-focos', 'focos-hit');
    overlay.classList.add('anim-' + anim);

    // cortinilla 50x15: luces girando en rueda junto al TAG si es rearm
    if (forcedAnim === 'rearm') {
      spawnPodium(overlay.querySelector('.anim-box'));
      if (cfg.sound.on) send({ t: 'sfx', name: 'rearm' }); // 3 notas al rearmar
    }
    // partículas decorativas por animación (vidilla)
    const fxbox = overlay.querySelector('.anim-box');
    if (anim === 'globos') spawnGlobos();
    else if (anim === 'fiesta') spawnConfetti();
    else if (anim === 'salto') spawnFx(fxbox, 'fx-star', 6, ['#ffd75e', '#ffffff', '#ffd75e']);
    else if (anim === 'baile') spawnFx(fxbox, 'fx-note', 7, ['#ff7ae0', '#4da3ff', '#52c41a', '#ffd75e']);
    else if (anim === 'nado') spawnFx(fxbox, 'fx-bubble', 8, ['#7cf7ff', '#4da3ff']);
    else if (anim === 'despegue') spawnFx(fxbox, 'fx-spark', 10, ['#ff9d2e', '#ff6b2e', '#ffd75e']);
    else if (anim === 'teleport') spawnFx(fxbox, 'fx-spark', 8, ['#66d9ff', '#ffffff']);
    else if (anim === 'acrobacia') spawnFx(fxbox, 'fx-hoop', 5, ['#ffd75e', '#ff7ae0']);
    else if (anim === 'giro') spawnFx(fxbox, 'fx-star', 4, ['#ffd75e', '#66d9ff']);
    else if (anim === 'barrer') spawnFx(fxbox, 'fx-spark', 6, ['#9aa3b8', '#c3c9d6']);
    else if (anim === 'equilibrio') spawnFx(fxbox, 'fx-bubble', 4, ['#ffd75e']);

    const blackout = $('blackout');
    const t1 = 380, t3 = 380;
    blackout.classList.add('on');
    // la animación 'focos' dura lo que dure su sonido: si el slot tiene MP3
    // subido, el show se alarga hasta el final del MP3 (+800 ms de cola);
    // sin MP3 manda la melodía 1-bit del sistema
    if (anim === 'focos') {
      mp3DurMs('focos').then((mp3ms) => {
        // si el super fijó segundos para focos, mandan esos; si no, el show
        // dura lo que el MP3 del slot (+cola) o la melodía de sistema
        const cfgDur = cfg.animDur && cfg.animDur['focos'] > 0;
        const t2 = cfgDur ? animDurMs('focos') : (mp3ms ? mp3ms + 800 : tuneDurMs(anim));
        playStartup(anim);
        if (mp3ms) {
          playFile('focos', () => { playAnimSound('focos'); playTune('focos'); });
        } else {
          playAnimSound(anim);
          playTune(anim);
        }
        focosShow(t2);
        setTimeout(() => {
          blackout.classList.remove('on');
          overlay.classList.add('on');
        }, t1);
        setTimeout(() => {
          blackout.classList.add('on');
        }, t1 + t2);
        setTimeout(() => {
          overlay.classList.remove('on');
          blackout.classList.remove('on');
          overlay.querySelectorAll('.foco').forEach((f) => f.remove());
          overlay.classList.remove('focos-hit');
          animRunning = false;
          done();
        }, t1 + t2 + t3);
      });
      return;
    }
    playStartup(anim);
    playAnimSound(anim);
    playTune(anim); // melodía 1-bit de la animación
    // duración visible: la que fije el super en el panel o la de la melodía
    const t2 = animDurMs(anim);
    setTimeout(() => {
      blackout.classList.remove('on');
      overlay.classList.add('on');
    }, t1);
    setTimeout(() => {
      blackout.classList.add('on');
    }, t1 + t2);
    setTimeout(() => {
      overlay.classList.remove('on');
      blackout.classList.remove('on');
      animRunning = false;
      done();
    }, t1 + t2 + t3);
  }

  // modo ensayo: probar la siguiente animación (o una concreta) en el proyector
  function testAnim(anim) {
    // el listener de click pasa el PointerEvent: solo aceptar nombres válidos
    const a = (typeof anim === 'string') ? anim : ANIMS[state.animIdx++ % ANIMS.length];
    if (wsOk) {
      send({ t: 'anim', player: 0, anim: a, test: true });
      return;
    }
    if (bc) {
      // modo local: retransmite al proyector; aquí solo se ve si es proyección
      send({ t: 'anim', player: 0, anim: a, test: true });
      if (esProyeccion()) runRearmAnim(0, () => {}, a);
      return;
    }
    log('Sin conexión con el ESP32: la animación no llega al proyector');
    playFile('wrong', playWrong);
  }

  function startTimer(secs) {
    stopTimer();
    state.timerLeft = secs;
    renderStage();
    state.timerHandle = setInterval(() => {
      state.timerLeft -= 1;
      if (state.timerLeft <= 3 && state.timerLeft > 0) playFile('tick', playTick);
      setLitBlink();
      if (state.timerLeft <= 0) {
        stopTimer();
        if (state.turn < state.order.length - 1) {
          // tiempo agotado: rebote automático al siguiente (tiempo completo)
          state.turn++;
          state.phase = 'rebounce';
          log('Rebote automático → ' + cfg.players[state.order[state.turn]].name);
          playFile('quack', playQuack);
          startTimer(cfg.timer.secs);
        } else {
          state.phase = 'timeout';
          log('Tiempo agotado (sin respuesta)');
          renderStage();
          setTimeout(() => { if (state.phase === 'timeout') phaseIdle(); }, 3000);
        }
      } else {
        renderStage();
      }
    }, 1000);
  }

  function stopTimer() {
    if (state.timerHandle) clearInterval(state.timerHandle);
    state.timerHandle = null;
    state.timerLeft = 0;
  }

  DEB.arm = arm;
  DEB.rebote = rebote;
  DEB.rearm = rearm;
  DEB.resetPoints = resetPoints;

  // ---------- Modo demo (simula el concurso en vivo) ----------
  let demoRunning = false;
  let demoTimer = null;

  function demoDelay(ms, fn) {
    if (!demoRunning) return;
    demoTimer = setTimeout(fn, ms);
  }

  function demoPickQuestion() {
    const items = document.querySelectorAll('#q-list .qitem');
    if (!items.length) return;
    const q = items[Math.floor(Math.random() * items.length)].textContent.replace(/^\d+\.\s*/, '');
    cfg.question = q;
    saveCfg();
    renderQuestion();
    document.querySelectorAll('#q-list .qitem').forEach((x) => {
      x.classList.remove('sel', 'show');
      if (x.textContent.replace(/^\d+\.\s*/, '') === q) x.classList.add('show');
    });
  }

  function demoNextRound() {
    if (!demoRunning) return;
    demoPickQuestion();
    arm();
    demoDelay(3500 + Math.random() * 2000, () => {
      if (!demoRunning) return;
      const winner = Math.floor(Math.random() * cfg.numPlayers);
      pressInternal(winner);
      demoDelay(1800 + Math.random() * 1000, () => {
        if (!demoRunning) return;
        if (Math.random() < 0.55 && state.phase === 'pressed') rebote();
        demoDelay(2000 + Math.random() * 1200, () => {
          if (!demoRunning) return;
          if (Math.random() < 0.7) {
            cfg.players[winner].points += 1;
            saveCfg();
            renderStage();
            sfx('ok');
          }
          rearm();
          demoDelay(cfg.anim.on ? 3700 : 900, demoNextRound);
        });
      });
    });
  }

  function toggleDemo() {
    demoRunning = !demoRunning;
    const btn = $('btn-demo');
    if (demoRunning) {
      btn.textContent = 'Detener demo';
      btn.classList.add('btn-danger');
      // si el temporizador está apagado, la demo lo activa (8 s) para lucir el tic-tac
      if (!cfg.timer.on) {
        cfg.timer.on = true;
        cfg.timer.secs = 8;
        saveCfg();
        log('Demo: temporizador activado (8 s) temporalmente');
      }
      log('Demo iniciada (simulando concurso)');
      demoNextRound();
    } else {
      btn.textContent = 'Iniciar demo';
      btn.classList.remove('btn-danger');
      log('Demo detenida');
      if (demoTimer) clearTimeout(demoTimer);
    }
  }

  DEB.toggleDemo = toggleDemo;

  function resetPoints() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const fecha = p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
    const hora = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    if (esModoVidas()) {
      // modo vidas: nueva partida → todos con las vidas iniciales (reviven) y
      // pulsadores en standby (limpia cola y X temporales; la X de muerte, que
      // es derivada del estado, desaparece sola al volver a vidas > 0)
      const fin = vidasIniciales();
      const lista = cfg.players.slice(0, cfg.numPlayers)
        .map((pl) => pl.name + ': ' + pl.points + ' vidas').join(', ');
      log('Partida reiniciada a las ' + hora + ' del ' + fecha + ' — vidas: ' + lista);
      cfg.players.forEach((pl) => { pl.points = fin; });
      resetPulsadores();
      saveCfg();
      renderStage();
      renderAdmin();
      log('Nueva partida: todos con ' + fin + ' vidas');
    } else {
      const lista = cfg.players.slice(0, cfg.numPlayers)
        .map((pl) => pl.name + ': ' + pl.points + 'pts').join(', ');
      log('Ronda finalizada a las ' + hora + ' del ' + fecha + ' — puntuaciones: ' + lista);
      cfg.players.forEach((pl) => { pl.points = 0; });
    }
    saveCfg();
    renderStage();
    renderAdmin();
    playFile('reset', playReset);
  }

  // ---------- Log ----------
  // el log del panel muestra los ms del navegador; las líneas del ESP32 ya
  // llevan su timestamp (HH:MM:SS.mmm o uptime) — se respetan tal cual
  function log(msg) {
    const el = $('log');
    const div = document.createElement('div');
    div.className = 'l';
    const d = new Date();
    div.textContent = d.toLocaleTimeString('es-ES') + '  ' + msg;
    el.prepend(div);
    while (el.children.length > 500) el.removeChild(el.lastChild);
  }

  // histórico persistente del ESP32: últimas 200 líneas de /log/rondas.log
  function loadLogHistory() {
    fetch('api/log')
      .then((r) => r.ok ? r.text() : Promise.reject(r.status))
      .then((txt) => {
        const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (!lines.length) {
          log('Histórico del ESP32: sin rondas registradas todavía');
          return;
        }
        log('Histórico del ESP32 (' + lines.length + ' líneas):');
        lines.slice(-40).forEach((l) => { // las 40 últimas en el panel (el resto queda en el ESP32)
          const div = document.createElement('div');
          div.className = 'l';
          div.textContent = l;
          $('log').prepend(div);
        });
      })
      .catch(() => { /* modo local: no hay histórico */ });
  }

  // ---------- PIN / sesión ----------
  let attempts = 0;
  let lockUntil = 0;

  function checkPin(pin, destino) {
    const now = Date.now();
    if (lockUntil > now) {
      const s = Math.ceil((lockUntil - now) / 1000);
      $('pin-msg').textContent = 'Espera ' + s + ' s para reintentar.';
      return false;
    }
    if (isAdmin() || pin === cfg.pin) {
      localStorage.setItem(LS_SESSION, JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600 * 1000 }));
      $('pin-msg').textContent = '';
      attempts = 0;
      destino();
      return true;
    }
    attempts++;
    if (attempts >= 5) {
      lockUntil = now + 20000;
      attempts = 0;
      $('pin-msg').textContent = 'Demasiados intentos. Espera 20 s.';
    } else {
      $('pin-msg').textContent = 'PIN incorrecto (' + (5 - attempts) + ' intentos restantes).';
    }
    return false;
  }

  function showAdmin() {
    document.body.classList.remove('locked');
    $('login').classList.add('hidden');
    $('admin').classList.remove('hidden');
    renderAdmin();
    loadBattery();
    loadWifi();
    loadSndFiles();
    loadLogHistory();
  }

  function entrarProyeccion() {
    document.body.classList.remove('locked');
    $('login').classList.add('hidden');
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'proyeccion'));
    document.querySelectorAll('.tabpage').forEach((x) => x.classList.toggle('active', x.id === 'tab-proyeccion'));
    fitStage();
  }

  function isAdmin() {
    try {
      const raw = localStorage.getItem(LS_SESSION);
      if (!raw) return false;
      const s = JSON.parse(raw);
      return !!s && typeof s.exp === 'number' && s.exp > Date.now();
    } catch (e) {
      return false;
    }
  }

  function logout() {
    localStorage.removeItem(LS_SESSION);
    document.body.classList.add('locked');
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'ajustes'));
    document.querySelectorAll('.tabpage').forEach((x) => x.classList.toggle('active', x.id === 'tab-ajustes'));
    $('admin').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('pin-input').value = '';
    $('editor-controls').classList.add('hidden');
    $('mini-stage').classList.remove('editing');
    DEB.editing = false;
    renderStage();
  }

  // ---------- Panel de ajustes ----------
  function renderAdmin() {
    $('cfg-numplayers').value = String(cfg.numPlayers);
    $('cfg-timer').checked = cfg.timer.on;
    $('cfg-timer-secs').value = cfg.timer.secs;
    $('cfg-sound').checked = cfg.sound.on;
    const ft = $('btn-face-toggle');
    if (ft) {
      ft.textContent = 'Rostro 8-bit: ' + (cfg.faceDigital ? 'ON' : 'OFF');
      ft.classList.toggle('on', !!cfg.faceDigital);
    }
    const ht = $('btn-halo-toggle');
    if (ht) {
      ht.textContent = 'Halo color: ' + (cfg.haloColor ? 'ON' : 'OFF');
      ht.classList.toggle('on', !!cfg.haloColor);
    }
    const at = $('btn-anim-toggle');
    if (at) {
      at.textContent = 'Animación al lanzar: ' + (cfg.anim.on ? 'ON' : 'OFF');
      at.classList.toggle('on', !!cfg.anim.on);
    }
    const qt = $('btn-qsnd-toggle');
    if (qt) {
      qt.textContent = 'Sonido de pregunta: ' + (cfg.sound.q !== false ? 'ON' : 'OFF');
      qt.classList.toggle('on', cfg.sound.q !== false);
    }
    // modo de juego (puntos clásico / vidas): selector + vidas iniciales + fallo=-1
    const gm = $('cfg-gamemode');
    if (gm) gm.value = esModoVidas() ? 'vidas' : 'puntos';
    const vidas = esModoVidas();
    document.querySelectorAll('.jmv').forEach((x) => { x.hidden = !vidas; });
    const ls = $('cfg-livesstart');
    if (ls) ls.value = String(vidasIniciales());
    const lf = $('cfg-livesfail');
    if (lf) lf.checked = !!cfg.livesFail;
    const jh = $('jmodes-hint');
    if (jh) {
      jh.textContent = vidas
        ? 'El acierto no suma: quita 1 vida con −1. Sin vidas = eliminado (X fija).'
        : 'Clásico: acierto = +1 punto.';
    }
    if (layout && layout.title) $('cfg-title-text').value = layout.title.text;

    const wrap = $('player-config');
    wrap.innerHTML = '';
    cfg.players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'prow';

      const name = document.createElement('input');
      name.type = 'text';
      name.value = p.name;
      name.maxLength = 20;
      name.addEventListener('input', () => { p.name = name.value; saveCfg(); renderStage(); });

      const color = document.createElement('select');
      COLORS.forEach((c) => {
        const o = document.createElement('option');
        o.value = c;
        o.textContent = c;
        if (c === p.color) o.selected = true;
        color.appendChild(o);
      });
      color.addEventListener('change', () => {
        p.color = color.value;
        saveCfg();
        renderAdmin(); // repinta el botón Puls con el nuevo color del pulsador
        renderStage(); // repinta el overlay de color del napi
      });

      const napi = document.createElement('select');
      NAPIS.forEach((n) => {
        const o = document.createElement('option');
        o.value = n;
        o.textContent = n;
        if (n === p.napi) o.selected = true;
        napi.appendChild(o);
      });
      napi.addEventListener('change', () => { p.napi = napi.value; saveCfg(); renderStage(); });

      const pts = document.createElement('span');
      pts.className = 'pts';
      pts.textContent = p.points;

      const bMinus = document.createElement('button');
      bMinus.className = 'btn';
      bMinus.textContent = '-1';
      bMinus.title = 'Quitar 1 punto' + (esModoVidas() ? ' (1 vida)' : '');
      bMinus.addEventListener('click', () => {
        const antes = p.points;
        p.points = antes - 1;
        saveCfg();
        renderStage();
        renderAdmin();
        sfx('fail');
        if (esModoVidas()) {
          if (antes > 0 && muerto(i)) log(p.name + ' ELIMINADO (0 vidas): no participa hasta recuperar');
          reconciliarMuertos(); // si era el turno actual, se salta solo
        }
      });

      const bPlus = document.createElement('button');
      bPlus.className = 'btn';
      bPlus.textContent = '+1';
      bPlus.title = 'Añadir 1 punto' + (esModoVidas() ? ' (1 vida)' : '');
      bPlus.addEventListener('click', () => {
        const antes = p.points;
        p.points = antes + 1;
        saveCfg();
        renderStage();
        renderAdmin();
        sfx('ok');
        if (esModoVidas() && antes <= 0 && p.points > 0) log(p.name + ' vuelve a participar (+1 vida)');
      });

      // Veredicto Verdadero/Falso: solo activos cuando es el turno de este jugador
      const bVerdad = document.createElement('button');
      bVerdad.className = 'vf-btn vf-verdad';
      bVerdad.dataset.player = String(i);
      bVerdad.textContent = 'Verdad';
      bVerdad.title = esModoVidas()
        ? 'Doble toque: acierto (NO suma; quita 1 vida a la víctima con −1) + aplausos'
        : 'Doble toque: +1 · aplausos + explicación';
      bVerdad.disabled = true;
      bVerdad.addEventListener('click', () => vfClick(i, true));

      const bFalso = document.createElement('button');
      bFalso.className = 'vf-btn vf-falso';
      bFalso.dataset.player = String(i);
      bFalso.textContent = 'Falso';
      bFalso.title = esModoVidas()
        ? (cfg.livesFail ? 'Doble toque: fallo (X + −1 vida)' : 'Doble toque: fallo (X; sin restar)')
        : 'Doble toque: fallo (X neón; sin restar puntos)';
      bFalso.disabled = true;
      bFalso.addEventListener('click', () => vfClick(i, false));

      // simula la pulsación del pulsador físico de este jugador (con su color)
      const bPuls = document.createElement('button');
      bPuls.className = 'btn btn-puls';
      bPuls.textContent = 'Puls';
      if (muerto(i)) bPuls.classList.add('muted');
      bPuls.title = muerto(i)
        ? 'Eliminado (0 vidas): sus pulsaciones no se tienen en cuenta'
        : 'Simular pulsación del pulsador ' + (i + 1);
      const pulsHex = PLAYER_COLOR_HEX[p.color] || '#ffffff';
      bPuls.style.borderColor = pulsHex;
      bPuls.style.color = pulsHex;
      bPuls.style.background = pulsHex + '26';
      bPuls.addEventListener('click', () => simPress(i));

      row.appendChild(name);
      row.appendChild(color);
      row.appendChild(napi);
      row.appendChild(pts);
      row.appendChild(bMinus);
      row.appendChild(bPlus);
      row.appendChild(bVerdad);
      row.appendChild(bFalso);
      row.appendChild(bPuls);
      wrap.appendChild(row);
    });
    updateTurnButtons();
  }

  // ---------- Batería de preguntas ----------
  let batteryLines = [];
  let pastedLines = [];
  let batteryApi = false; // true: hay /api/q del ESP32 (mutaciones persistentes)
  let qFilter = '';
  let editingIdx = null; // null = añadir; >=0 = editar batería; -2 = editar pegada
  let usedQuestions = [];
  try { usedQuestions = JSON.parse(localStorage.getItem('dateelbit.usedq') || '[]'); } catch (e) { usedQuestions = []; }
  const usedSet = new Set(usedQuestions);
  // última pregunta lanzada (texto): "▶ Siguiente" continúa por orden de lista
  const LS_LASTQ = 'dateelbit.lastq';
  let lastQ = '';
  try { lastQ = localStorage.getItem(LS_LASTQ) || ''; } catch (e) { lastQ = ''; }

  // una línea de batería puede ser "pregunta / explicación": se parte por la
  // PRIMERA barra con espacios alrededor (" / ") para no romper fracciones o
  // fechas sin espacios (3/4); si no hay, fallback a la primera barra simple
  function parseQ(line) {
    let i = line.indexOf(' / ');
    if (i === -1) i = line.indexOf('/');
    if (i === -1) return { q: line.trim(), exp: '' };
    // " / " apunta al espacio: la barra está en i+1
    const b = (line.charAt(i) === '/') ? i : i + 1;
    return { q: line.slice(0, i).trim(), exp: line.slice(b + 1).trim() };
  }

  function saveUsed() {
    usedQuestions = [...usedSet];
    localStorage.setItem('dateelbit.usedq', JSON.stringify(usedQuestions));
  }
  function markUsed(q) { usedSet.add(q); saveUsed(); renderQList(); }
  function unmarkUsed(q) { usedSet.delete(q); saveUsed(); }

  // mutación vía /api/q; en modo local (sin API) aplica solo en memoria
  async function qApi(op, payload) {
    if (batteryApi) {
      try {
        const r = await fetch('api/q', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ op: op }, payload)),
        });
        if (r.ok) {
          const j = await r.json();
          batteryLines = j.lines || [];
          renderQList();
          return true;
        }
      } catch (e) { /* sin red */ }
      batteryApi = false; // la API ha muerto: cae a modo local
      log('Sin /api/q (modo local): los cambios no se guardan en el ESP32');
    }
    // modo local: mutación en memoria
    const idx = payload && payload.idx !== undefined ? payload.idx : -1;
    if (op === 'add' && payload.q) {
      batteryLines.unshift(payload.q.trim()); // las nuevas van arriba
    } else if (op === 'del' && idx >= 0 && idx < batteryLines.length) {
      batteryLines.splice(idx, 1);
    } else if (op === 'edit' && idx >= 0 && idx < batteryLines.length && payload.q) {
      batteryLines[idx] = payload.q.trim();
    } else if (op === 'move' && idx >= 0 && idx < batteryLines.length) {
      const j = idx + (payload.dir || 0);
      if (j >= 0 && j < batteryLines.length) {
        const t = batteryLines[idx]; batteryLines[idx] = batteryLines[j]; batteryLines[j] = t;
      }
    } else if (op === 'clear') {
      batteryLines = [];
    } else if (op === 'replace') {
      batteryLines = (payload.lines || []).map((l) => String(l).trim()).filter((l) => l.length > 0);
    }
    renderQList();
    return true;
  }

  function renderQList() {
    const seen = new Set();
    const combined = [];
    // las líneas pegadas (recién añadidas) se muestran ARRIBA, como bloque en
    // su orden; la batería guardada queda debajo (arrastrada por las nuevas)
    pastedLines.concat(batteryLines).forEach((l) => {
      if (!seen.has(l)) { seen.add(l); combined.push(l); }
    });
    const count = $('q-count');
    if (count) {
      count.textContent = (batteryLines.length > 0)
        ? (batteryLines.length + ' en batería' + (pastedLines.length ? ' · ' + pastedLines.length + ' pegadas' : ''))
        : (pastedLines.length ? pastedLines.length + ' pegadas (sin guardar)' : 'vacía');
    }
    const list = $('q-list');
    list.innerHTML = '';
    const shown = combined.filter((line) => {
      if (!qFilter) return true;
      const p = parseQ(line);
      return (p.q + ' ' + p.exp).toLowerCase().indexOf(qFilter.toLowerCase()) !== -1;
    });
    if (!shown.length) {
      list.innerHTML = '<div class="qempty">Sin preguntas — pega texto abajo, añade una o sube un .txt.</div>';
      return;
    }
    shown.forEach((line) => {
      const p = parseQ(line);
      const q = p.q;
      const i = batteryLines.indexOf(line);
      const div = document.createElement('div');
      div.className = 'qitem';
      if (q === cfg.question) div.classList.add('show');
      if (usedSet.has(q)) div.classList.add('used');
      const num = document.createElement('span');
      num.className = 'qnum';
      num.textContent = (i >= 0 ? i + 1 : '-') + '.';
      const txt = document.createElement('span');
      txt.className = 'qtext';
      txt.textContent = q;
      txt.title = q;
      if (p.exp) {
        const ex = document.createElement('span');
        ex.className = 'qexp';
        ex.textContent = p.exp;
        ex.title = p.exp;
        txt.appendChild(ex);
      }
      const btns = document.createElement('span');
      btns.className = 'qbtns';
      const mk = (label, title, fn) => {
        const b = document.createElement('button');
        b.className = 'qbtn';
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        btns.appendChild(b);
      };
      mk('▶', 'Lanzar al proyector', () => launchQ(line, div));
      mk('✎', 'Editar', () => editQ(line, i));
      mk('↑', 'Mover arriba', () => moveQ(i, -1));
      mk('↓', 'Mover abajo', () => moveQ(i, 1));
      // ✓/↩: marca/desmarca la pregunta como usada (el ciclo ▶ la salta con ✓)
      mk(usedSet.has(q) ? '↩' : '✓', usedSet.has(q)
        ? 'Quitar la marca de usada (se podrá lanzar otra vez en esta pasada)'
        : 'Marcar como usada (la salta el ciclo ▶ Siguiente)', () => {
          if (usedSet.has(q)) { unmarkUsed(q); log('✓ quitado: ' + q.slice(0, 60)); }
          else { markUsed(q); log('Marcada como usada: ' + q.slice(0, 60)); }
          renderQList();
        });
      mk('✕', 'Borrar de la batería', () => delQ(line, i));
      div.appendChild(num);
      div.appendChild(txt);
      div.appendChild(btns);
      div.addEventListener('click', () => {
        if (div.classList.contains('show')) {
          cfg.question = '';
          cfg.explanation = '';
          saveCfg();
          renderQuestion();
          div.classList.remove('show');
          log('Pregunta quitada del proyector');
          return;
        }
        if (div.classList.contains('sel')) {
          launchQ(line, div);
        } else {
          document.querySelectorAll('#q-list .qitem').forEach((x) => x.classList.remove('sel'));
          div.classList.add('sel');
        }
      });
      list.appendChild(div);
    });
  }

  function launchQ(line, div) {
    const p = parseQ(line);
    cfg.question = p.q;
    cfg.explanation = p.exp; // listo para el uso futuro en el proyector
    hideExpl(); // lanzar una pregunta nueva cierra la pantalla de explicación
    log('Pregunta en proyector: ' + p.q + (p.exp ? ' (con explicación)' : ''));
    document.querySelectorAll('#q-list .qitem').forEach((x) => x.classList.remove('sel', 'show'));
    if (div) div.classList.add('show');
    markUsed(p.q);
    lastQ = p.q; // "▶ Siguiente" continúa desde aquí (por orden de lista)
    try { localStorage.setItem(LS_LASTQ, lastQ); } catch (e) { /* ignore */ }
    launchQuestion();
  }

  // "▶ Siguiente pregunta": lanza la primera NO usada que sigue a la última
  // lanzada en el orden de la batería. Las usadas quedan atrás (no se repiten);
  // al agotarse el orden, avisa (Limpiar usadas reinicia el ciclo desde arriba).
  function lanzarSiguiente() {
    if (!batteryLines.length) {
      log('Batería vacía: añade preguntas o sube un .txt');
      return;
    }
    let start = 0;
    if (lastQ) {
      const idx = batteryLines.findIndex((l) => parseQ(l).q === lastQ);
      if (idx >= 0) start = idx + 1;
    }
    for (let i = start; i < batteryLines.length; i++) {
      if (!usedSet.has(parseQ(batteryLines[i]).q)) {
        launchQ(batteryLines[i], null);
        log('▶ Siguiente pregunta (#' + (i + 1) + ' de ' + batteryLines.length + ')');
        return;
      }
    }
    log('Todas las preguntas usadas: pulsa "Limpiar usadas" para reiniciar el ciclo');
  }

  async function editQ(line, i) {
    const p = parseQ(line);
    const nuevo = prompt('Editar pregunta:', p.q);
    if (nuevo === null) return;
    const t = nuevo.trim();
    if (!t) return;
    const exp = prompt('Explicación (opcional, vacío para quitar):', p.exp || '');
    const linea = exp === null
      ? t
      : (exp.trim() ? t + ' / ' + exp.trim() : t);
    if (i >= 0) {
      await qApi('edit', { idx: i, q: linea });
    } else {
      // pregunta de pegado temporal: se guarda como añadida
      await qApi('add', { q: linea });
    }
    unmarkUsed(p.q);
    log('Pregunta editada');
  }

  async function moveQ(i, dir) {
    if (i < 0) { log('Solo se reordenan las preguntas de la batería'); return; }
    await qApi('move', { idx: i, dir: dir });
  }

  async function delQ(line, i) {
    const p = parseQ(line);
    if (i >= 0) {
      if (!confirm('¿Borrar la pregunta "' + p.q.slice(0, 60) + '"?')) return;
      await qApi('del', { idx: i });
      unmarkUsed(p.q);
    } else {
      pastedLines = pastedLines.filter((l) => l !== line);
      renderQList();
      log('Pregunta pegada quitada de la lista');
    }
  }

  async function editQ(line, i) {
    const p = parseQ(line);
    editingIdx = (i >= 0 ? i : -2); // -2 = línea pegada (se quita y se añade al guardar)
    $('q-add').value = p.q;
    $('q-add-exp').value = p.exp;
    $('btn-q-add').textContent = 'Guardar cambios';
    $('btn-q-edit-cancel').classList.remove('hidden');
    $('q-add').focus();
    $('q-add').scrollIntoView({ block: 'center' });
  }

  function cancelEditQ() {
    editingIdx = null;
    $('q-add').value = '';
    $('q-add-exp').value = '';
    $('btn-q-add').textContent = 'Añadir';
    $('btn-q-edit-cancel').classList.add('hidden');
  }

  async function addQ() {
    const q = $('q-add').value.trim();
    const exp = $('q-add-exp').value.trim();
    if (!q) return;
    const linea = exp ? q + ' / ' + exp : q;
    if (editingIdx === -2) {
      // línea pegada en edición: se quita de la lista y se guarda como añadida
      pastedLines = pastedLines.filter((l) => parseQ(l).q !== q);
      await qApi('add', { q: linea });
      log('Pregunta editada: ' + q);
    } else if (editingIdx !== null) {
      await qApi('edit', { idx: editingIdx, q: linea });
      log('Pregunta editada: ' + q);
    } else {
      await qApi('add', { q: linea });
      log('Pregunta añadida: ' + q);
    }
    cancelEditQ();
  }

  function loadBattery() {
    fetch('api/q')
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => {
        batteryApi = true;
        batteryLines = j.lines || [];
        renderQList();
      })
      .catch(() => {
        batteryApi = false;
        fetch('q/lista.txt')
          .then((r) => r.ok ? r.text() : Promise.reject(r.status))
          .then((txt) => {
            batteryLines = txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
            renderQList();
          })
          .catch(() => {
            batteryLines = [];
            renderQList();
          });
      });
  }

  // ---------- Textos de las animaciones (personalizables, estilo batería) ----------
  let editingTag = null; // animación en edición (null = ninguna)
  let animFiles = []; // imágenes subidas por el usuario en /anim (GIF/PNG)

  async function loadAnimFiles() {
    try {
      const r = await fetch('api/animlist');
      if (r.ok) animFiles = await r.json();
    } catch (e) {
      animFiles = [];
    }
    renderAnimTags();
  }

  function renderAnimTags() {
    const list = $('tag-list');
    if (!list) return;
    list.innerHTML = '';
    Object.keys(ANIM_TAGS).forEach((anim) => {
      const div = document.createElement('div');
      div.className = 'qitem tagitem';
      const name = document.createElement('span');
      name.className = 'tag-name';
      name.textContent = anim;
      const txt = document.createElement('span');
      txt.className = 'tag-text';
      txt.textContent = tagText(anim);
      const btns = document.createElement('span');
      btns.className = 'qbtns tag-btns';
      const ed = document.createElement('button');
      ed.className = 'qbtn';
      ed.textContent = '✎';
      ed.title = 'Editar texto de ' + anim;
      ed.addEventListener('click', (e) => { e.stopPropagation(); startEditTag(anim); });
      btns.appendChild(ed);
      // imagen de la animación: GIF (se muestra tal cual) o PNG (con movimiento)
      const subido = animFiles.find((f) => f === anim + '.gif' || f === anim + '.png');
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/gif,image/png';
      input.className = 'anim-file-input';
      input.style.display = 'none';
      input.addEventListener('change', () => subirAnimImg(anim, input));
      const bUp = document.createElement('button');
      bUp.className = 'qbtn';
      bUp.textContent = subido ? 'Cambiar imagen' : 'Subir imagen';
      bUp.title = 'Subir GIF animado o PNG para la animación ' + anim;
      bUp.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
      btns.appendChild(bUp);
      const bDel = document.createElement('button');
      bDel.className = 'qbtn btn-danger-q';
      bDel.textContent = 'Quitar imagen';
      bDel.style.display = subido ? '' : 'none';
      bDel.title = 'Volver al personaje de serie en ' + anim;
      bDel.addEventListener('click', (e) => { e.stopPropagation(); quitarAnimImg(anim); });
      btns.appendChild(bDel);
      div.appendChild(name);
      div.appendChild(txt);
      div.appendChild(input);
      div.appendChild(btns);
      // segunda línea: duración configurable + estado de la imagen subida
      const linea2 = document.createElement('span');
      linea2.className = 'tag-line2';
      const lab = document.createElement('span');
      lab.className = 'hint';
      lab.textContent = 'Duración (s):';
      const dur = document.createElement('input');
      dur.type = 'number';
      dur.className = 'dur-input';
      dur.min = '0';
      dur.max = '120';
      dur.step = '1';
      const cfgS = cfg.animDur && cfg.animDur[anim];
      dur.value = cfgS && cfgS > 0 ? String(cfgS) : '';
      dur.title = 'Segundos que dura esta animación (0 = la de sistema)';
      dur.placeholder = 'auto ≈' + Math.round(tuneDurMs(anim) / 1000) + 's';
      dur.addEventListener('change', () => {
        const v = parseInt(dur.value, 10);
        if (!cfg.animDur) cfg.animDur = {};
        if (v && v > 0) cfg.animDur[anim] = Math.min(120, v);
        else delete cfg.animDur[anim];
        saveCfg();
        log('Duración de "' + anim + '": ' + (cfg.animDur[anim] || 'auto') + ' s');
      });
      linea2.appendChild(lab);
      linea2.appendChild(dur);
      if (subido) {
        const st = document.createElement('span');
        st.className = 'tag-file';
        st.textContent = 'subida: ' + subido;
        linea2.appendChild(st);
      }
      div.appendChild(linea2);
      list.appendChild(div);
    });
  }

  // valida la imagen del usuario y la sube como <anim>.gif o <anim>.png
  async function subirAnimImg(anim, input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > 1048576) {
      log('Imagen de más de 1 MB: bloqueada (' + (file.size / 1048576).toFixed(2) + ' MB)');
      return;
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext !== 'gif' && ext !== 'png') {
      log('Solo se aceptan GIF o PNG (detectado: .' + ext + ')');
      return;
    }
    // dimensiones máximas 800x800 (se muestra a 620 px de alto)
    try {
      const dims = await new Promise((res) => {
        const u = URL.createObjectURL(file);
        const im = new Image();
        im.onload = () => { URL.revokeObjectURL(u); res({ w: im.naturalWidth, h: im.naturalHeight }); };
        im.onerror = () => { URL.revokeObjectURL(u); res(null); };
        im.src = u;
      });
      if (dims && (dims.w > 800 || dims.h > 800)) {
        log('Imagen demasiado grande: ' + dims.w + 'x' + dims.h + ' (máx 800x800 px)');
        return;
      }
    } catch (e) { /* sin validación de dimensiones */ }
    const fd = new FormData();
    fd.append('file', new File([file], anim + '.' + ext, { type: file.type }));
    try {
      const r = await fetch('/api/upload?dir=anim', { method: 'POST', body: fd });
      if (!r.ok) {
        log('Subida rechazada por el ESP32 (' + r.status + ')');
        return;
      }
      imgBust++;
      cfg.imgBust = imgBust; // versión global: viaja a todas las pantallas
      saveCfg();             // así el proyector re-descarga la imagen nueva
      log('Imagen subida para "' + anim + '": ' + anim + '.' + ext + ' (el GIF anima solo; el PNG usa el movimiento de la animación)');
      await loadAnimFiles();
      refreshFsChip();
    } catch (e) {
      log('Sin ESP32: sube con fs_tool a /anim/' + anim + '.' + ext);
    }
  }

  // borra la imagen subida de una animación (vuelve el personaje de serie)
  async function quitarAnimImg(anim) {
    const f = animFiles.find((x) => x === anim + '.gif' || x === anim + '.png');
    if (!f) return;
    try {
      const r = await fetch('/api/anmdel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f }),
      });
      if (!r.ok) {
        log('No se pudo quitar la imagen (' + r.status + ')');
        return;
      }
      imgBust++;
      cfg.imgBust = imgBust;
      saveCfg();
      log('Imagen quitada de "' + anim + '" (vuelve el de serie)');
      await loadAnimFiles();
      refreshFsChip();
    } catch (e) {
      log('Sin ESP32: borra /anim/' + f + ' con fs_tool');
    }
  }

  function startEditTag(anim) {
    editingTag = anim;
    const inp = $('tag-edit');
    inp.value = tagText(anim);
    inp.focus();
    inp.select();
    $('btn-tag-save').disabled = false;
    $('btn-tag-save').textContent = 'Guardar cambios';
    $('btn-tag-cancel').classList.remove('hidden');
    $('tag-msg').textContent = 'Editando: ' + anim;
  }

  function cancelEditTag() {
    editingTag = null;
    $('tag-edit').value = '';
    $('btn-tag-save').disabled = true;
    $('btn-tag-save').textContent = 'Guardar cambios';
    $('btn-tag-cancel').classList.add('hidden');
    $('tag-msg').textContent = '';
  }

  function saveTag() {
    if (!editingTag) return;
    const texto = $('tag-edit').value.trim();
    if (!cfg.animTags) cfg.animTags = {};
    if (texto) cfg.animTags[editingTag] = texto;
    else delete cfg.animTags[editingTag]; // vacío = vuelve al texto original
    saveCfg();
    log('Texto de animación "' + editingTag + '" actualizado');
    cancelEditTag();
    renderAnimTags();
  }

  // ---------- Redes WiFi (panel del super) ----------
  let wifiState = { creds: [], active: '', staIp: '', apIp: '' };
  let wifiLoaded = false; // la lista ha cargado: sin esto NO se puede guardar

  function grabWifiInputs() {
    const creds = [];
    document.querySelectorAll('#wifi-config .wrow').forEach((r) => {
      creds.push({
        ssid: r.querySelector('.wssid').value.trim(),
        psk: r.querySelector('.wpsk').value,
      });
    });
    wifiState.creds = creds;
  }

  function renderWifi() {
    const wrap = $('wifi-config');
    if (!wrap) return;
    grabWifiInputs();
    wrap.innerHTML = '';
    // 3 filas fijas (orden = posición); vaciar SSID+PSK quita la red
    for (let i = 0; i < 3; i++) {
      const c = wifiState.creds[i] || { ssid: '', psk: '' };
      const row = document.createElement('div');
      row.className = 'prow wrow';
      const ord = document.createElement('span');
      ord.className = 'wifi-ord';
      ord.textContent = (i + 1) + 'º';
      const ssid = document.createElement('input');
      ssid.type = 'text'; ssid.className = 'wssid'; ssid.placeholder = 'SSID'; ssid.value = c.ssid;
      const psk = document.createElement('input');
      psk.type = 'password'; psk.className = 'wpsk'; psk.placeholder = 'Contraseña'; psk.value = c.psk || '';
      row.appendChild(ord); row.appendChild(ssid); row.appendChild(psk);
      wrap.appendChild(row);
    }
    const act = $('wifi-actual');
    if (act) {
      act.textContent = wifiState.active
        ? 'Conectado a: ' + wifiState.active + ' · STA ' + wifiState.staIp + ' · AP ' + wifiState.apIp
        : 'Sin conexión STA (modo AP · ' + wifiState.apIp + ')';
    }
    const sel = $('wifi-connect-select');
    if (sel) {
      sel.innerHTML = '';
      (wifiState.creds || []).forEach((c) => {
        if (c.ssid) {
          const o = document.createElement('option');
          o.value = c.ssid;
          o.textContent = c.ssid;
          sel.appendChild(o);
        }
      });
    }
  }

  async function loadWifi() {
    wifiLoaded = false;
    const btn = $('btn-wifi-save');
    if (btn) btn.disabled = true; // evitar guardar con la lista sin cargar
    try {
      const r = await fetch('api/wifi/status');
      if (r.ok) {
        wifiState = await r.json();
        if (!wifiState.creds) wifiState.creds = [];
      }
    } catch (e) {
      wifiState = { creds: [], active: '', staIp: '', apIp: '' };
    }
    wifiLoaded = true;
    renderWifi();
    if (btn) btn.disabled = false;
  }

  async function wifiPost(url, body) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return r.ok;
    } catch (e) {
      return false;
    }
  }

  // ---------- Botonera de pruebas (sonidos y animaciones) ----------
  const SOUND_SLOTS = ['quack', 'ok', 'fail', 'arm', 'wrong', 'tick', 'reset', 'rearm'];

  // ---------- Sonidos MP3 por slot (desplegable) ----------
  const SND_LABELS = {
    quack: 'rebote', ok: 'sumar punto', fail: 'restar punto', arm: 'armar pregunta',
    wrong: 'pulsación inválida', tick: 'últimos 3 s', reset: 'reset puntos',
    rearm: 'rearme pregunta (50x15)',
  };
  let sndFiles = [];

  function slotLabel(name) {
    if (SND_LABELS[name]) return name + ' — ' + SND_LABELS[name];
    if (name.indexOf('press_') === 0) return name + ' — pulsación';
    return name + ' — animación';
  }

  function fillSndSlots() {
    const sel = $('snd-slot');
    if (!sel) return;
    sel.innerHTML = '';
    SOUND_SLOTS.concat(ANIMS, NAPIS.map((n) => 'press_' + n)).forEach((name) => {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = slotLabel(name);
      sel.appendChild(o);
    });
    sel.addEventListener('change', renderSndSlotInfo);
  }

  function renderSndSlotInfo() {
    const info = $('snd-slot-info');
    if (!info) return;
    const file = $('snd-slot').value + '.mp3';
    info.textContent = sndFiles.indexOf(file) >= 0
      ? 'Este slot usa tu MP3 (' + file + '). "Borrar MP3 seleccionado" vuelve al de sistema.'
      : 'Este slot usa el sonido de sistema. Sube un MP3 para sustituirlo.';
  }

  async function loadSndFiles() {
    try {
      const r = await fetch('api/sndlist');
      if (r.ok) sndFiles = await r.json();
    } catch (e) {
      sndFiles = [];
    }
    renderSndSlotInfo();
    refreshFsChip(); // el espacio cambia al subir/borrar MP3
  }

  // espacio ocupado/libre de la placa (chips de la barra superior)
  function refreshFsChip() {
    const usedEl = $('fs-used');
    if (!usedEl) return; // solo existe en el panel del super
    fetch('api/fs')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        const kb = (b) => Math.round((b || 0) / 1024).toLocaleString('es-ES');
        usedEl.textContent = 'Ocupado ' + kb(j.used) + ' KB';
        const freeEl = $('fs-free');
        if (freeEl) freeEl.textContent = 'Libre ' + kb(j.free) + ' KB';
      })
      .catch(() => {
        usedEl.textContent = 'Ocupado —';
        const freeEl = $('fs-free');
        if (freeEl) freeEl.textContent = 'Libre —';
      });
  }
  const SLOT_SYNTHS = {
    quack: playQuack, ok: playOk, fail: playFail, arm: playArm,
    wrong: playWrong, tick: playTick, reset: playReset,
  };

  function buildBanks() {
    const sb = $('snd-bank');
    sb.innerHTML = '';
    // el quack SALE en el banco desde 2026-09-05 (decisión del super): quiere
    // poder lanzarlo manualmente cuando desee (además de en los fallos)
    SOUND_SLOTS.concat(ANIMS, NAPIS.map((n) => 'press_' + n)).forEach((name) => {
      const b = document.createElement('button');
      b.className = 'btn btn-bank';
      b.textContent = name;
      b.title = 'Sonido: ' + name;
      b.addEventListener('click', () => {
        const synth = SLOT_SYNTHS[name] || ANIM_SOUNDS[name] ||
          (name.indexOf('press_') === 0 ? playDink : null);
        if (!wsOk && !bc) log('Sin conexión con el ESP32: el sonido no llega al proyector');
        playFile(name, synth); // el panel lo retransmite al proyector
      });
      sb.appendChild(b);
    });
    const ab = $('anim-bank');
    ab.innerHTML = '';
    ANIMS.forEach((anim) => {
      const b = document.createElement('button');
      b.className = 'btn btn-bank';
      b.textContent = anim;
      b.title = 'Animación: ' + anim;
      b.addEventListener('click', () => testAnim(anim));
      ab.appendChild(b);
    });
  }

  // ---------- WebSocket (ESP32) / demo ----------
  let ws = null;
  let wsOk = false;
  let expectHelloCfg = false; // pendiente el cfg del hello tras (re)conectar
  let localDemo = false;      // sin ESP32: sincronización local entre pestañas
  let soundMuted = false;     // modo local: el panel es mando, no suena (solo proyección)

  // ¿esta ventana es de proyección? (proyector.html o la pestaña Proyección activa)
  function esProyeccion() {
    return IS_PROYECTOR || document.getElementById('tab-proyeccion').classList.contains('active');
  }

  function updateSoundMode() {
    soundMuted = localDemo && !wsOk && !esProyeccion();
  }

  // Modo local (DEMO): las pestañas del mismo navegador se sincronizan por
  // BroadcastChannel; con WS, TODO sigue yendo por el ESP32 (el BC se ignora).
  let bc = null;
  const myId = 'p' + Math.random().toString(36).slice(2);
  function initBc() {
    if (!('BroadcastChannel' in window)) return;
    try {
      bc = new BroadcastChannel('dateelbit');
      bc.onmessage = (e) => {
        if (wsOk) return; // con ESP32, el estado real va por WS
        const m = e.data;
        if (!m || m._src === myId) return;
        if (m.t === 'hello') {
          bc.postMessage({ _src: myId, t: 'cfg', cfg });
          if (layout) bc.postMessage({ _src: myId, t: 'layout', layout });
          bc.postMessage({ _src: myId, t: 'phase', phase: state.phase, winner: state.winner, order: state.order, turn: state.turn });
          return;
        }
        applyRemote(m);
      };
    } catch (e) {
      bc = null;
    }
  }

  // Watchdog en vivo: el ESP32 emite {t:'ping'} cada 2 s; si no llega señal
  // en 5 s, el chip de la ventana de proyección pasa a SIN SEÑAL (rojo).
  let lastPingAt = 0;
  let wsReconnectTimer = null;
  function updateWatchdog() {
    const ok = wsOk && Date.now() - lastPingAt < 5000;
    updateSoundMode(); // el modo de sonido depende de localDemo/wsOk (puede cambiar al reconectar)
    // WS abierto pero muerto (p.ej. reset del ESP32 sin cierre detectado):
    // forzar el cierre para que onclose relance la reconexión automática
    if (wsOk && !ok) {
      try { ws.close(); } catch (e) { /* sin socket */ }
    }
    // modo local (sin ESP32): las pestañas se sincronizan por BroadcastChannel
    if (localDemo && !wsOk) {
      const el = document.getElementById('wd-chip');
      if (el) {
        el.textContent = 'LOCAL';
        el.classList.remove('chip-bad');
        el.classList.add('chip-ok');
      }
      const pc = document.getElementById('phase-chip');
      if (pc) {
        pc.textContent = 'LOCAL';
        pc.classList.remove('chip-bad');
        pc.classList.add('chip-ok');
      }
      return;
    }
    const el = document.getElementById('wd-chip');
    if (el) {
      if (ok) {
        el.textContent = 'EN LÍNEA';
        el.classList.remove('chip-bad');
        el.classList.add('chip-ok');
      } else {
        el.textContent = 'SIN SEÑAL';
        el.classList.remove('chip-ok');
        el.classList.add('chip-bad');
      }
    }
    // el chip ESPERANDO de la barra sirve de status de estabilidad
    const pc = document.getElementById('phase-chip');
    if (pc) {
      if (ok) {
        pc.textContent = 'ESPERANDO';
        pc.classList.remove('chip-bad');
        pc.classList.add('chip-ok');
      } else {
        pc.textContent = 'CONEXIÓN PERDIDA';
        pc.classList.remove('chip-ok');
        pc.classList.add('chip-bad');
      }
    }
  }

  function setStatus(txt, offline) {
    const el = $('conn-status');
    el.textContent = txt;
    el.classList.toggle('chip-offline', !!offline);
    el.classList.toggle('chip-dim', !offline && txt === 'DEMO');
  }

  function wsConnect() {
    // pruebas locales: ?host=<IP-de-la-placa> conecta el WS al ESP32 sin subir
    const hostParam = (new URLSearchParams(location.search)).get('host');
    const demoParam = (new URLSearchParams(location.search)).get('demo');
    const wsHost = hostParam || location.hostname;
    // Modo DEMO (simulador sin ESP32, sincroniza pestañas por BroadcastChannel):
    // - ?demo en la URL, o
    // - servido desde GitHub Pages (.github.io), o
    // - protocolo no http(s) o localhost sin ?host=
    if (demoParam !== null ||
        !/^https?:$/.test(location.protocol) ||
        (!hostParam && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) ||
        (!hostParam && /\.github\.io$/i.test(location.hostname))) {
      localDemo = true;
      setStatus('DEMO', true);
      updateWatchdog();
      return;
    }
    try {
      ws = new WebSocket('ws://' + wsHost + ':81/ws');
      ws.onopen = () => {
        wsOk = true;
        setStatus('ESP32 · ' + wsHost);
        lastPingAt = Date.now();
        updateWatchdog();
        expectHelloCfg = true;
        send({ t: 'hello', role: IS_PROYECTOR ? 'proyector' : 'panel' }); // rol: el panel recibe el Falso físico
      };
      ws.onmessage = (e) => applyRemote(JSON.parse(e.data));
      const drop = () => {
        wsOk = false;
        updateWatchdog();
        setStatus('SIN CONEXIÓN', true);
        if (!wsReconnectTimer) {
          wsReconnectTimer = setTimeout(() => { wsReconnectTimer = null; wsConnect(); }, 3000);
        }
      };
      ws.onclose = drop;
      ws.onerror = () => {
        try { ws.close(); } catch (e) { /* ya cerrado */ }
        drop();
      };
    } catch (e) {
      setStatus('DEMO');
    }
  }

  function send(obj) {
    if (ws && wsOk) {
      try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
      return;
    }
    if (bc) {
      try { bc.postMessage(Object.assign({ _src: myId }, obj)); } catch (e) { /* ignore */ }
    }
  }

  function applyRemote(m) {
    if (!m) return;
    if (m.t === 'ping') {
      lastPingAt = Date.now();
      updateWatchdog();
      return;
    }
    if (m.t === 'cfg') {
      // ignora el eco de lo que enviamos nosotros (evita pisar lo que se está escribiendo);
      // el historial cubre ecos retrasados mientras se teclea rápido
      const j = JSON.stringify(m.cfg);
      if (j !== lastSentCfgJson && cfgSentHistory.indexOf(j) === -1) {
        // tras una (re)conexión el servidor puede traer un cfg más viejo que el
        // nuestro: SOLO reenvía el cliente que ha editado en esta sesión (tiene
        // historial de envíos); un cliente recién abierto/stale aplica el del
        // servidor para no pisar cambios de otros
        const localJson = JSON.stringify(cfg);
        if (expectHelloCfg && !IS_PROYECTOR && cfgSentHistory.length > 0 && localJson !== j) {
          // si el servidor arrancó sin pregunta (boot), no reintroducir la vieja
          if (!m.cfg.question && cfg.question) cfg.question = '';
          saveCfg();
      } else {
        cfg = Object.assign({}, DEFAULT_CFG, cfg, m.cfg);
        if (typeof cfg.sndBust !== 'number') {
          cfg.sndBust = 1; // primera subida de MP3 en la era post-fix
          if (!IS_PROYECTOR && cfgSentHistory.length > 0) saveCfg();
        }
        DEB.cfg = cfg;
        localStorage.setItem(LS_CFG, JSON.stringify(cfg));
      }
      }
      expectHelloCfg = false;
      // no re-renderizar el panel: rompería el foco mientras el super escribe
      renderStage();
      renderQuestion();
      renderAnimTags();
    } else if (m.t === 'phase') {
      // dedup (pruebafixconexion1): una reentrega del mismo estado (el servidor
      // ya solo la manda al cliente que reconecta, pero por si acaso quedan
      // ecos/duplicados) no debe re-sonar ni re-renderizar
      const sig = JSON.stringify([m.phase, m.winner, m.turn, m.order || null, m.times || null]);
      if (sig === lastPhaseSig) return;
      lastPhaseSig = sig;
      // pulsación (física) de un jugador que ya ha fallado esta pregunta o que
      // está ELIMINADO (0 vidas en modo vidas): el firmware no conoce las X (viven
      // en la web; las muertes sí las filtra ya en onBuzzerPress) → se descarta
      if (m.phase === 'pressed' && m.winner !== undefined &&
          (faceFailPlayers.has(m.winner) || muerto(m.winner))) {
        log('Pulsación de ' + (cfg.players[m.winner] ? cfg.players[m.winner].name : '?') +
            ' ignorada (' + (muerto(m.winner) ? 'sin vidas: no participa' : 'ya ha fallado esta pregunta') + ')');
        if (state.phase === 'armed') send({ t: 'phase', phase: 'armed' });
        else arm();
        return;
      }
      state.phase = m.phase;
      state.winner = m.winner !== undefined ? m.winner : state.winner;
      if (m.turn !== undefined) state.turn = m.turn;
      if (m.order) state.order = m.order;
      if (m.times) state.times = m.times;
      else if (m.order) state.times = [];
      // numeración GLOBAL de pulsación de la pregunta (sobrevive a la
      // reapertura tras fallos): se acumulan los pulsadores en su orden; la
      // limpia solo idle (rearme/quitar pregunta) — NUNCA armed (la reapertura
      // también envía armed y debe mantener la cuenta para el badge 4º...)
      // pressed Y rebounce: en rebounce el firmware encola a los que pulsan
      // durante el turno de otro (sesión 8) → también acumulan número global
      if ((m.phase === 'pressed' || m.phase === 'rebounce') && m.order) {
        m.order.forEach((j) => {
          if (j >= 0 && state.pulseOrder.indexOf(j) === -1) state.pulseOrder.push(j);
        });
      } else if (m.phase === 'idle') {
        state.pulseOrder = [];
      }
      if (m.phase === 'armed' && !m.order) {
        // armar (o reabrir) siempre empieza una fase de pulsación nueva
        state.order = [];
        state.times = [];
      }
      if (m.phase === 'idle') {
        // el gesto de fallo NO se limpia con cualquier idle (p. ej. cierre
        // automático de ronda): solo con facefail:-1 (rearme/quitar pregunta)
      }
      if (m.phase !== 'pressed' && m.phase !== 'armed' && m.phase !== 'rebounce') stopTimer();
      if (m.phase === 'pressed' && cfg.timer.on && !wsOk) startTimer(cfg.timer.secs);
      if (esProyeccion() && m.phase === 'rebounce') playFile('quack', playQuack);
      if (esProyeccion() && m.phase === 'pressed' && m.winner !== undefined && cfg.players[m.winner]) {
        playFile('press_' + cfg.players[m.winner].napi, playDink);
      }
      if (m.phase === 'rebounce' && m.xfail >= 0 && !faceFailPlayers.has(m.xfail)) {
        // rebote MANUAL físico (GPIO9/tap BOOT): el saltado se marca con X en
        // todas las ventanas (sin sonido de fallo — el quack del rebote sigue)
        faceFailPlayers.add(m.xfail);
        log('Rebote físico: ' + (cfg.players[m.xfail] ? cfg.players[m.xfail].name : '?') + ' marcado con X');
      }
      if (m.phase === 'idle') scheduleAutoPreload(); // en idle: precarga si hay bust nuevo
      renderStage();
    } else if (m.t === 'timer') {
      if (m.left > 0) {
        state.timerLeft = m.left;
        if (m.left <= 3 && esProyeccion()) playFile('tick', playTick);
        setLitBlink();
        renderStage();
      }
    } else if (m.t === 'expl') {
      // overlay de explicación (acierto Verdadero/Falso): lo muestra el proyector
      if (esProyeccion()) {
        showExpl(m.text || '');
      }
    } else if (m.t === 'expl-off') {
      hideExpl();
    } else if (m.t === 'facefail') {
      // -1 = rearme/quitar pregunta (limpia todas); N = ese jugador falló (acumulativo)
      if (m.player === -1) faceFailPlayers.clear();
      else faceFailPlayers.add(m.player);
      renderStage();
    } else if (m.t === 'anim') {
      // solo la reproducen las ventanas de proyección (proyector.html o la
      // pestaña Proyección abierta); el panel del super es un mando a distancia
      hideExpl(); // una animación nueva tapa la explicación anterior
      if (esProyeccion()) {
        runRearmAnim(m.player !== undefined ? m.player : 0, () => {}, m.anim);
      }
    } else if (m.t === 'sfx') {
      // suena en las ventanas de proyección (proyector.html o la pestaña
      // Proyección del index); la pestaña Ajustes (panel) no reenvía los ecos
      if (esProyeccion()) {
        const synth = SFX_SYNTHS[m.name] || ANIM_SOUNDS[m.name] ||
          (m.name.indexOf('press_') === 0 ? playDink : null);
        playFile(m.name, synth);
      }
    } else if (m.t === 'falso-fisico') {
      // pruebabotonfalso1: doble toque en el GPIO10 → el super juzga FALSO al
      // jugador del turno (lo envía el firmware solo al panel registrado)
      if (!IS_PROYECTOR && typeof vfAnswer === 'function' &&
          m.player >= 0 && m.player < 4 && cfg.players[m.player]) {
        clearVfPending();
        log('Falso físico (doble toque GPIO10): ' + cfg.players[m.player].name);
        vfAnswer(m.player, false);
      }
    } else if (m.t === 'reset-puls') {
      // pruebabotonreset1: GPIO9 mantenido 3 s → el panel ejecuta su reset
      // (limpia orden/X/badges; armed si hay pregunta, idle si no)
      if (!IS_PROYECTOR && typeof resetPulsadores === 'function') {
        log('Reset de pulsadores físico (GPIO9 3 s)');
        resetPulsadores();
      }
    } else if (m.t === 'layout') {
      if (m.layout && layoutDefault && JSON.stringify(m.layout) !== lastSentLayoutJson) {
        layout = mergeLayout(layoutDefault, m.layout);
      }
      renderStage();
    }
  }

  // ---------- Escala del escenario ----------
  function fitStage() {
    const wrap = $('scale-wrap');
    const avail = wrap.getBoundingClientRect();
    const sMin = Math.min(avail.width / 1920, avail.height / 1080);
    const sMax = Math.max(avail.width / 1920, avail.height / 1080);
    // Apaisado casi 16:9 (p. ej. 16:10): llena TODO el espacio (aprovecha los
    // costados; el diseño tiene margen suficiente y nada se corta). Si la
    // pantalla es mucho más alta (4:3...), conserva la proporción 16:9.
    const s = (sMax / sMin) <= 1.15 ? sMax : sMin;
    $('stage').style.transform = 'scale(' + (s * 0.985) + ')';
  }

  // Adaptación automática a la pantalla: una tablet táctil con resolución de
  // escritorio (p. ej. 1920x1200) vería la maqueta 1920 "de PC" y enorme.
  // Detectamos táctil + ancho grande → viewport 1280 (equivale al zoom 50%
  // manual, pero solo). Recreamos el meta (más fiable) y reforzamos con zoom
  // CSS si el navegador ignora el viewport.
  function adaptViewport() {
    const old = document.querySelector('meta[name=viewport]');
    if (!old) return;
    const w = Math.max(window.screen.width, window.innerWidth);
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const want = (coarse && w >= 1500) ? 'width=1280, initial-scale=1' : 'width=device-width, initial-scale=1';
    if (old.getAttribute('content') !== want) {
      old.remove();
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = want;
      document.head.appendChild(meta);
    }
    if (IS_PROYECTOR || !$('log')) {
      console.info('[adapt] pantalla=' + window.screen.width + ' css=' + window.innerWidth +
        ' dpr=' + (window.devicePixelRatio || 1) + ' tactil=' + coarse + ' viewport=' + want);
      return;
    }
    log('Adaptación: pantalla ' + window.screen.width + ' · ventana ' + window.innerWidth +
      ' · táctil ' + (coarse ? 'sí' : 'no') + ' → viewport ' + want);
    // refuerzo: si el navegador ignora el viewport, reducir con zoom CSS
    requestAnimationFrame(() => {
      if (coarse && window.innerWidth > 1500) {
        document.documentElement.style.zoom = Math.max(0.5, 1280 / window.innerWidth).toFixed(3);
      } else {
        document.documentElement.style.zoom = '';
      }
    });
  }

  // ---------- Reloj y vida en espera ----------
  function tickClock() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    $('clock').textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    renderClock(); // posición/tamaño del reloj (el editor puede cambiarlos)
  }

  let idleFunTimer = null;
  function scheduleIdleFun() {
    if (idleFunTimer) clearTimeout(idleFunTimer);
    idleFunTimer = setTimeout(() => {
      if (state.phase === 'idle' || state.phase === 'armed') {
        const n = cfg.numPlayers;
        const i = Math.floor(Math.random() * n);
        const funs = ['fun-jump', 'fun-shake', 'fun-conga', 'fun-sleep'];
        const cls = funs[Math.floor(Math.random() * funs.length)];
        const el = document.querySelectorAll('#players .player')[i];
        if (el) {
          el.classList.add(cls);
          setTimeout(() => el.classList.remove(cls), 2600);
        }
      }
      scheduleIdleFun();
    }, 14000 + Math.random() * 16000);
  }

  // ---------- Inicialización ----------
  // ---------- Precarga de contenidos (pruebafixconexion2) ----------
  // Descarga al navegador (caché HTTP) lo pesado ANTES de jugar: napis, fondo,
  // MP3 de /snd y GIF/PNG de /anim con su bust. Así el primer show de cada
  // animación/sonido no pide nada al ESP32 a mitad de ronda (el servidor de una
  // sola tarea no se bloquea y las pulsaciones llegan al proyector sin cola).
  let preloading = false;
  let lastAutoPreloadKey = '';
  let preloadBtnLabel = 'Precargar';

  function preloadTargets() {
    const ib = cfg.imgBust || imgBust || 0;
    const sb = cfg.sndBust || sndBust || 0;
    const urls = ['img/fondoweb.jpg' + (ib ? '?v=' + ib : '')];
    Object.keys(NAPI_FILES).forEach((k) => urls.push('img/' + NAPI_FILES[k] + (ib ? '?v=' + ib : '')));
    return fetch('api/sndlist')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('sndlist'))))
      .then((files) => {
        (Array.isArray(files) ? files : []).forEach((f) => urls.push('snd/' + f + '?v=' + sb));
        return fetch('api/animlist');
      })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('animlist'))))
      .then((af) => {
        (Array.isArray(af) ? af : []).forEach((f) => urls.push('anim/' + f + '?v=' + ib));
        return urls;
      })
      .catch(() => urls); // sin ESP32 (modo local): solo los estáticos
  }

  async function doPreload(btn) {
    if (preloading) return;
    preloading = true;
    if (btn) { preloadBtnLabel = btn.textContent; btn.disabled = true; }
    const setL = (t) => { if (btn) btn.textContent = t; };
    try {
      const urls = await preloadTargets();
      let done = 0;
      setL('0/' + urls.length);
      for (const u of urls) {
        if (state.phase !== 'idle') { setL('parado (ronda)'); break; } // nunca en ronda
        try {
          const r = await fetch(u);
          if (r.ok) await r.arrayBuffer(); // consumir el cuerpo: puebla la caché
        } catch (e) { /* recurso con error: se sigue con el resto */ }
        done++;
        setL(done + '/' + urls.length);
      }
      if (done === urls.length) {
        lastAutoPreloadKey = (cfg.imgBust || 0) + '/' + (cfg.sndBust || 0);
        setL('OK ✓');
        setTimeout(() => { if (btn) btn.textContent = preloadBtnLabel; }, 5000);
      }
    } finally {
      preloading = false;
      if (btn) btn.disabled = false;
    }
  }

  function scheduleAutoPreload() {
    const key = (cfg.imgBust || 0) + '/' + (cfg.sndBust || 0);
    if (!esProyeccion() || preloading || key === lastAutoPreloadKey) return;
    setTimeout(() => {
      if (esProyeccion() && state.phase === 'idle' && !preloading) doPreload(null);
    }, 3000);
  }

  function init() {
    fetch('js/layout_default.json')
      .then((r) => r.json())
      .then((j) => {
        layoutDefault = j;
        layout = loadLayout();
        renderStage();
        // modo local: reintentar el hello ahora que hay layout (el primer hello
        // podía haberse respondido sin él y las otras pestañas lo descartaron)
        if (localDemo && bc) send({ t: 'hello' });
      })
      .catch((e) => {
        console.error('No se pudo cargar layout_default.json', e);
      });

    if (!IS_PROYECTOR) initPanel();

    const pb = $('btn-preload');
    if (pb) pb.addEventListener('click', () => doPreload(pb));
    if (esProyeccion()) scheduleAutoPreload(); // al abrir la ventana de proyección

    adaptViewport(); // antes de medir: el viewport decide el tamaño real
    window.addEventListener('resize', () => { fitStage(); if (DEB.fitMini) DEB.fitMini(); });
    fitStage();
    wsConnect();
    tickClock();
    setInterval(tickClock, 1000);
    setInterval(updateWatchdog, 1000);
    scheduleIdleFun();
    scheduleFaceFun();
    initBc();
    if (localDemo) send({ t: 'hello' }); // pedir el estado a otras pestañas locales
    updateSoundMode(); // el panel (no proyección) queda mudo en modo local
  }

  function initPanel() {
    // siempre bloqueado al arrancar: el PIN se valida en cada entrada
    document.body.classList.add('locked');
    // el HTML arranca con Proyección activa, que con locked quedaría oculta
    // (todo negro) → activar Ajustes donde está el login
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'ajustes'));
    document.querySelectorAll('.tabpage').forEach((x) => x.classList.toggle('active', x.id === 'tab-ajustes'));

    document.querySelectorAll('.tab').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        document.querySelectorAll('.tabpage').forEach((x) => x.classList.remove('active'));
        $('tab-' + b.dataset.tab).classList.add('active');
        // fix Ajustes (pruebafixconexion2): entrando por "Pantalla de proyección"
        // el #admin seguía oculto → al pulsar Ajustes con sesión, mostrar el panel
        if (b.dataset.tab === 'ajustes' && isAdmin() && $('admin').classList.contains('hidden')) {
          $('admin').classList.remove('hidden');
          renderAdmin();
          loadBattery();
          loadWifi();
          loadSndFiles();
          loadLogHistory();
        }
        fitStage();
        updateSoundMode(); // al pasar a la pestaña Proyección, esta ventana ya no es mudo
      });
    });

    $('btn-arm').addEventListener('click', arm);
    $('btn-rebote').addEventListener('click', rebote);
    $('btn-rearm').addEventListener('click', rearm);
    $('btn-reset-puls').addEventListener('click', resetPulsadores);
    $('btn-expl').addEventListener('click', explClick);
    $('btn-reset-pts').addEventListener('click', resetPoints);

    $('btn-jugadores-ok').addEventListener('click', () => {
      saveCfg();
      renderStage();
      const msg = $('jugadores-msg');
      msg.textContent = '✓ Actualizado (enviado a todos los clientes)';
      setTimeout(() => { msg.textContent = ''; }, 2500);
      log('Cambios de jugadores aplicados');
    });

    $('cfg-numplayers').addEventListener('change', (e) => {
      cfg.numPlayers = parseInt(e.target.value, 10);
      saveCfg();
      renderStage();
    });
    // modo de juego 2 (vidas): selector de modo + vidas iniciales + fallo=-1
    $('cfg-gamemode').addEventListener('change', (e) => {
      cfg.gameMode = e.target.value === 'vidas' ? 'vidas' : 'puntos';
      if (typeof cfg.livesStart !== 'number' || !isFinite(cfg.livesStart)) cfg.livesStart = 5;
      saveCfg();
      renderAdmin();
      renderStage();
      log('Modo de juego: ' + (esModoVidas()
        ? 'VIDAS (el acierto no suma; quita 1 vida a la víctima con −1; 0 vidas = eliminado)'
        : 'PUNTOS (clásico: acierto = +1)'));
    });
    $('cfg-livesstart').addEventListener('change', (e) => {
      const v = parseInt(e.target.value, 10);
      cfg.livesStart = isFinite(v) && v >= 1 ? Math.min(20, v) : 5;
      e.target.value = String(vidasIniciales());
      saveCfg();
      log('Vidas iniciales: ' + vidasIniciales() + ' (se aplican al pulsar Restablecer)');
    });
    $('cfg-livesfail').addEventListener('change', (e) => {
      cfg.livesFail = e.target.checked;
      saveCfg();
      log('fallo=-1 ' + (cfg.livesFail ? 'ACTIVADO: fallar la pregunta resta 1 vida' : 'desactivado: fallar solo deja la X'));
    });
    $('cfg-timer').addEventListener('change', (e) => { cfg.timer.on = e.target.checked; saveCfg(); });
    $('cfg-timer-secs').addEventListener('change', (e) => {
      cfg.timer.secs = Math.min(60, Math.max(3, parseInt(e.target.value, 10) || 10));
      saveCfg();
    });
    $('cfg-sound').addEventListener('change', (e) => { cfg.sound.on = e.target.checked; saveCfg(); });
    // toggles rápidos: animaciones al lanzar y sonido de la pregunta (slot arm)
    $('btn-anim-toggle').addEventListener('click', () => {
      cfg.anim.on = !cfg.anim.on;
      saveCfg();
      renderAdmin();
    });
    $('btn-qsnd-toggle').addEventListener('click', () => {
      cfg.sound.q = !(cfg.sound.q !== false);
      saveCfg();
      renderAdmin();
    });
    // toggles rápidos: rostro 8-bit y halo de color del pulsador
    $('btn-face-toggle').addEventListener('click', () => {
      cfg.faceDigital = !cfg.faceDigital;
      saveCfg();
      renderAdmin();
      renderStage();
    });
    $('btn-halo-toggle').addEventListener('click', () => {
      cfg.haloColor = !cfg.haloColor;
      saveCfg();
      renderAdmin();
      renderStage();
    });
    $('cfg-title-text').addEventListener('input', (e) => {
      if (layout && layout.title) { layout.title.text = e.target.value; renderTitle(); }
    });
    $('cfg-title-text').addEventListener('change', (e) => {
      if (layout && layout.title) { layout.title.text = e.target.value; DEB.saveLayout(); renderTitle(); }
    });

    // pegado directo: las líneas entran en la lista al instante
    $('q-paste').addEventListener('input', (e) => {
      pastedLines = e.target.value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      renderQList();
    });

    // añadir una pregunta suelta (pregunta + explicación opcional)
    $('q-add').addEventListener('keydown', (e) => { if (e.key === 'Enter') addQ(); });
    $('q-add-exp').addEventListener('keydown', (e) => { if (e.key === 'Enter') addQ(); });
    $('btn-q-add').addEventListener('click', addQ);
    $('btn-q-edit-cancel').addEventListener('click', cancelEditQ);

    // filtro de la lista
    $('q-filter').addEventListener('input', (e) => {
      qFilter = e.target.value;
      renderQList();
    });

    // ▶ Siguiente pregunta (ciclo en orden de la batería, saltando las usadas)
    const qNext = $('btn-q-next');
    if (qNext) qNext.addEventListener('click', lanzarSiguiente);

    // textos de las animaciones (personalizables)
    $('btn-tag-save').addEventListener('click', saveTag);
    $('btn-tag-cancel').addEventListener('click', cancelEditTag);
    $('tag-edit').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveTag();
      else if (e.key === 'Escape') cancelEditTag();
    });
    $('btn-tag-reset').addEventListener('click', () => {
      if (!confirm('¿Restaurar los textos originales de todas las animaciones?')) return;
      cfg.animTags = {};
      saveCfg();
      cancelEditTag();
      renderAnimTags();
      log('Textos de animaciones restaurados a los originales');
    });
    renderAnimTags();
    loadAnimFiles();
    refreshFsChip();
    setInterval(refreshFsChip, 5000); // el espacio de la placa se refresca en vivo

// marcas de usadas: limpiar → reinicia el ciclo (la batería vuelve a poder
// lanzarse EN ORDEN desde el principio: se olvida también la última lanzada)
$('btn-q-clearused').addEventListener('click', () => {
  usedSet.clear();
  saveUsed();
  lastQ = '';
  try { localStorage.removeItem(LS_LASTQ); } catch (e) { /* ignore */ }
  renderQList();
  log('Marcas de preguntas usadas limpiadas: el ciclo de "Siguiente" reinicia desde la primera');
});

    // vaciar batería entera
    $('btn-q-clearall').addEventListener('click', async () => {
      if (!confirm('¿Vaciar la batería de preguntas entera?')) return;
      await qApi('clear');
      log('Batería vaciada');
    });

    // guardar texto pegado: el bloque pegado entra ARRIBA en su orden y
    // arrastra a la batería guardada hacia abajo (para sustituirla del todo,
    // vaciar antes o subir un .txt)
    $('btn-q-paste').addEventListener('click', async () => {
      const txt = $('q-paste').value.trim();
      if (!txt) return;
      const bloque = pastedLines.slice(); // orden del pegado intacto
      if (!bloque.length) return;
      const aviso = 'Batería guardada: ' + bloque.length + ' nuevas arriba' +
        (batteryLines.length ? ' + ' + batteryLines.length + ' anteriores' : '');
      await qApi('replace', { lines: bloque.concat(batteryLines) });
      $('q-paste').value = '';
      pastedLines = [];
      renderQList();
      log(aviso);
    });

    // subida de batería de preguntas (.txt -> /q/lista.txt)
    $('btn-q-upload').addEventListener('click', async () => {
      const input = $('q-file');
      if (!input.files || !input.files.length) return;
      const file = input.files[0];
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await fetch('/api/upload?dir=q', { method: 'POST', body: fd });
        if (r.ok) {
          input.value = '';
          log('Batería subida: ' + file.name);
          loadBattery();
        }
      } catch (e) { /* sin red */ }
    });

    $('btn-q-clear').addEventListener('click', () => {
      if (questionLaunchTimer) clearTimeout(questionLaunchTimer);
      questionLaunchTimer = null;
      stopTimer(); // si el temporizador de respuesta corría, se para (si no,
      // al llegar a 0 saltaría un mensaje TIEMPO sin pregunta en pantalla)
      cfg.question = '';
      cfg.explanation = '';
      saveCfg();
      renderQuestion();
      hideExpl(); // quita también la pantalla de explicación (fundido suave)
      send({ t: 'expl-off' });
      phaseIdle(true); // quita el orden de pulsación (badge), mensajes y X de fallo
      send({ t: 'phase', phase: 'idle' });
      document.querySelectorAll('#q-list .qitem').forEach((x) => x.classList.remove('active'));
      log('Pregunta quitada (listo para lanzar)');
    });

    // sonidos MP3 por slot (desplegable + límite de 1 MB)
    $('btn-snd-upload').addEventListener('click', async () => {
      const input = $('snd-file');
      const msg = $('snd-msg');
      const slot = $('snd-slot').value;
      if (!input.files || !input.files.length) {
        msg.textContent = 'Selecciona un MP3.';
        return;
      }
      const f = input.files[0];
      if (f.size > 1048576) {
        msg.textContent = 'El archivo supera 1 MB: bloqueado.';
        return;
      }
      if (f.type && f.type.indexOf('audio') !== 0) {
        msg.textContent = 'El archivo no parece un audio MP3.';
        return;
      }
      const renamed = new File([f], slot + '.mp3', { type: f.type || 'audio/mpeg' });
      const fd = new FormData();
      fd.append('file', renamed);
      try {
        const r = await fetch('/api/upload?dir=snd', { method: 'POST', body: fd });
        if (r.ok) {
          msg.textContent = 'MP3 subido al slot ' + slot + '.';
          sndBust++;
          cfg.sndBust = sndBust; // invalida el MP3 viejo en TODAS las ventanas
          delete audioCache[slot];
          saveCfg();
          loadSndFiles();
        } else {
          msg.textContent = 'Error subiendo: ' + await r.text();
        }
      } catch (e) {
        msg.textContent = 'Error de red subiendo.';
      }
      input.value = '';
    });

    $('btn-snd-del-one').addEventListener('click', async () => {
      const slot = $('snd-slot').value;
      const msg = $('snd-msg');
      try {
        const r = await fetch('/api/snddel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: slot + '.mp3' }),
        });
        msg.textContent = r.ok ? 'Sonido de sistema restaurado (' + slot + ').' : 'Error al restaurar.';
        if (r.ok) {
          sndBust++;
          cfg.sndBust = sndBust;
          delete audioCache[slot];
          saveCfg();
        }
        loadSndFiles();
      } catch (e) {
        msg.textContent = 'Error de red.';
      }
    });

    $('btn-snd-del').addEventListener('click', async () => {
      const msg = $('snd-msg');
      try {
        const r = await fetch('/api/sndclear', { method: 'POST' });
        msg.textContent = r.ok ? 'Sonidos borrados.' : 'Error borrando sonidos.';
        if (r.ok) {
          sndBust++;
          cfg.sndBust = sndBust;
          Object.keys(audioCache).forEach((k) => delete audioCache[k]);
          saveCfg();
        }
        loadSndFiles();
      } catch (e) {
        msg.textContent = 'Error de red borrando sonidos.';
      }
    });

    // desplegable de slots y estado de MP3 subidos
    fillSndSlots();
    loadSndFiles();

    const tryPin = (destino) => checkPin($('pin-input').value.trim(), destino);
    $('btn-modo-super').addEventListener('click', () => tryPin(showAdmin));
    $('btn-modo-proyector').addEventListener('click', () => tryPin(entrarProyeccion));
    $('pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryPin(showAdmin); });
    // sesión vigente: sin PIN, solo elegir destino
    if (isAdmin()) {
      $('pin-input').classList.add('hidden');
      const hint = $('login').querySelector('.hint');
      if (hint) hint.textContent = 'Sesión activa (' + SESSION_HOURS + ' h). Elige destino.';
    }

    $('btn-logout').addEventListener('click', logout);
    const lcb = $('btn-log-clear');
    if (lcb) lcb.addEventListener('click', () => {
      if (!confirm('¿Vaciar el log de rondas del ESP32?')) return;
      fetch('api/log/clear', { method: 'POST' })
        .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
        .then(() => { $('log').innerHTML = ''; log('Log de rondas LIMPIADO'); loadLogHistory(); })
        .catch(() => log('No se pudo limpiar el log (¿modo local?)'));
    });

    // redes WiFi
    $('btn-wifi-save').addEventListener('click', async () => {
      grabWifiInputs();
      const msg = $('wifi-msg');
      if (!wifiLoaded) {
        msg.textContent = 'Espera a que cargue la lista de redes.';
        return;
      }
      const reds = (wifiState.creds || []).filter((c) => c.ssid.length > 0);
      if (reds.length === 0 &&
          !window.confirm('La lista está vacía: se borrarán TODAS las redes y el dispositivo quedará en modo AP. ¿Continuar?')) {
        return;
      }
      msg.textContent = 'Guardando... el dispositivo se reiniciará.';
      const ok = await wifiPost('api/wifi/save', { reds });
      msg.textContent = ok ? 'Guardado. Reiniciando...' : 'Error guardando';
    });
    $('btn-wifi-connect').addEventListener('click', async () => {
      const sel = $('wifi-connect-select');
      const msg = $('wifi-msg');
      if (!sel.value) { msg.textContent = 'No hay redes guardadas'; return; }
      const cred = (wifiState.creds || []).find((c) => c.ssid === sel.value);
      msg.textContent = 'Conectando a ' + sel.value + '...';
      const ok = await wifiPost('api/wifi/connect', { ssid: sel.value, psk: cred ? cred.psk : '' });
      msg.textContent = ok ? 'Conectando... si cambia la IP, recarga la página.' : 'Error conectando';
    });
    $('btn-wifi-connect2').addEventListener('click', async () => {
      const ssid = $('wifi-connect-ssid').value.trim();
      const msg = $('wifi-msg');
      if (!ssid) { msg.textContent = 'Escribe un SSID'; return; }
      msg.textContent = 'Conectando a ' + ssid + '...';
      const ok = await wifiPost('api/wifi/connect', { ssid: ssid, psk: $('wifi-connect-psk').value });
      msg.textContent = ok ? 'Conectando... si cambia la IP, recarga la página.' : 'Error conectando';
    });

    // subida/restauración de imágenes del layout (fondo y napis)
    $('btn-img-bg').addEventListener('click', () => {
      const f = $('img-bg').files && $('img-bg').files[0];
      uploadImg(f, 'fondoweb.jpg', 'Fondo actualizado');
    });
    $('btn-img-bg-restore').addEventListener('click', () => resetImg('fondoweb.jpg', 'Fondo restaurado'));
    buildNapiUploaders();

    buildBanks();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
