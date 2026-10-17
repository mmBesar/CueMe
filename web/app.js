/* CueMe web UI: one page, two roles (display / remote), same code on every
 * platform. Plain ES5 on purpose so old Android WebViews can run it. */
(function () {
  'use strict';

  var I = window.CueI18n;
  var t = I.t;
  var Engine = window.CueEngine;
  var app = document.getElementById('app');
  var LINE_H = 1.45;

  /* ------------------------------------------------------------ helpers */
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    var k;
    props = props || {};
    for (k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
      var v = props[k];
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.substr(0, 2) === 'on') n.addEventListener(k.substr(2), v);
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    if (kids) {
      if (!Array.isArray(kids)) kids = [kids];
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c === null || c === undefined || c === false) continue;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return n;
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  /* decodeURIComponent throws on a stray % : keep the text as it is then */
  function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function now() { return Date.now(); }

  function xhr(method, host, path, pin, body, cb) {
    var proto = (location.protocol === 'https:') ? 'https:' : 'http:';
    var x = new XMLHttpRequest();
    x.open(method, proto + '//' + host + path, true);
    x.setRequestHeader('x-cueme-pin', pin || '');
    if (body !== null && body !== undefined) x.setRequestHeader('content-type', 'text/plain; charset=utf-8');
    x.timeout = 8000;
    x.onload = function () { cb(x.status, x.responseText); };
    x.onerror = x.ontimeout = function () { cb(0, ''); };
    x.send(body === null || body === undefined ? null : body);
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function hexToRgb(h) {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
  }

  var KEYCODES = { 32: ' ', 38: 'ArrowUp', 40: 'ArrowDown', 37: 'ArrowLeft', 39: 'ArrowRight', 27: 'Escape',
    36: 'Home', 33: 'PageUp', 34: 'PageDown', 219: '[', 221: ']', 70: 'f', 69: 'e', 77: 'm' };
  /* old WebViews have no KeyboardEvent.key */
  function keyName(e) {
    var k = e.key || KEYCODES[e.keyCode] || '';
    // Arabic (or any non-Latin) layout: the shortcut letters follow the physical key
    if (k.length === 1 && k.charCodeAt(0) > 127 && e.code) {
      var m = /^Key([A-Z])$/.exec(e.code) || /^Digit([0-9])$/.exec(e.code);
      if (m) return m[1].toLowerCase();
    }
    return k;
  }

  function isTyping(e) {
    var n = e.target;
    var tn = n && n.tagName;
    return tn === 'INPUT' && n.type !== 'range' && n.type !== 'checkbox' && n.type !== 'color' || tn === 'TEXTAREA' || tn === 'SELECT';
  }

  /* ------------------------------------------------------------ settings */
  var SPEC = [
    { k: 'font_size', min: 16, max: 300, step: 1, unit: 'px' },
    { k: 'speed', min: 0, max: 120, step: 1, unit: '' },
    { k: 'width', min: 30, max: 100, step: 1, unit: '%' },
    { k: 'dim', min: 0, max: 90, step: 5, unit: '%' },
    { k: 'focus_pos', min: 10, max: 90, step: 1, unit: '%' },
    { k: 'countdown', min: 0, max: 10, step: 1, unit: 's' }
  ];
  var SWITCHES = ['flip_x', 'flip_y', 'bold', 'focus', 'auto_fullscreen'];
  function specFor(k) { for (var i = 0; i < SPEC.length; i++) if (SPEC[i].k === k) return SPEC[i]; return null; }

  var DEFAULTS = {
    font_size: 64, speed: 20, flip_x: false, flip_y: false, text_color: '#ffffff', bg_color: '#000000',
    width: 90, dim: 60, focus: true, focus_pos: 40, bold: false, countdown: 0, auto_fullscreen: false
  };

  /* ------------------------------------------------------------ session */
  var S = {
    settings: copy(DEFAULTS), text: '', html: '', name: '', rev: 0,
    pos: 0, playing: false, eta: null, displays: 0, remotes: 0, library: [], connected: false,
    hasNative: false, libraryPath: '', errAt: 0, errMsg: ''
  };
  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

  var link = null;
  var view = null; // current view object { onState, onPos, onCmd, onPeers, onLibrary, onStatus, destroy }

  /* ------------------------------------------------------------ websocket link */
  function Link(target, role, handlers) {
    this.target = target;
    this.role = role;
    this.h = handlers;
    this.ws = null;
    this.retry = 0;
    this.closed = false;
    this.everOpen = false;
    this.timer = null;
    this.lastRx = now();
    this.sawPing = false;
    var me = this;
    // the hub sends a heartbeat every 15 s; silence for 30 s means the connection died quietly
    // (phone Wi-Fi power saving does this): drop it and reconnect instead of sending into the void
    this.watch = setInterval(function () {
      if (me.sawPing && me.ws && me.ws.readyState === 1 && now() - me.lastRx > 30000) { try { me.ws.close(); } catch (e) {} }
    }, 5000);
    this.open();
  }
  Link.prototype.open = function () {
    var self = this;
    if (self.closed) return;
    var proto = (location.protocol === 'https:') ? 'wss:' : 'ws:';
    var ws;
    try {
      ws = new WebSocket(proto + '//' + self.target.host + '/ws?pin=' + encodeURIComponent(self.target.pin));
    } catch (e) { self.schedule(); return; }
    self.ws = ws;
    var opened = false;
    ws.onopen = function () {
      opened = true; self.everOpen = true; self.retry = 0; self.lastRx = now();
      self.send({ t: 'hello', role: self.role });
      self.h.status(true);
    };
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      self.lastRx = now();
      if (m.t === 'ping') { self.sawPing = true; return; }
      self.h.msg(m);
    };
    ws.onclose = function () {
      if (self.ws !== ws) return;
      self.h.status(false);
      if (!opened && self.retry >= 2) {
        // could be a changed PIN: check with plain HTTP
        xhr('GET', self.target.host, '/api/library', self.target.pin, null, function (code) {
          if (code === 401 && self.h.badPin) self.h.badPin();
        });
      }
      self.schedule();
    };
    ws.onerror = function () { /* onclose follows */ };
  };
  Link.prototype.schedule = function () {
    var self = this;
    if (self.closed) return;
    var wait = Math.min(5000, 400 * Math.pow(2, self.retry));
    self.retry++;
    self.timer = setTimeout(function () { self.open(); }, wait);
  };
  Link.prototype.send = function (obj) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    }
    return false;
  };
  Link.prototype.close = function () {
    this.closed = true;
    clearInterval(this.watch);
    clearTimeout(this.timer);
    if (this.ws) { try { this.ws.close(); } catch (e) {} }
  };

  /* throttled settings sender: coalesces drags into ~20 msgs/s */
  var pendingPatch = null, patchTimer = null;
  function sendSet(k, v) {
    S.settings[k] = v;
    if (!pendingPatch) pendingPatch = {};
    pendingPatch[k] = v;
    if (patchTimer) return;
    patchTimer = setTimeout(function () {
      patchTimer = null;
      var p = pendingPatch; pendingPatch = null;
      if (link && p) link.send({ t: 'set', settings: p });
    }, 50);
  }

  function adjust(k, delta) {
    var sp = specFor(k);
    if (!sp) return;
    var v = clamp((S.settings[k] || 0) + delta, sp.min, sp.max);
    sendSet(k, v);
    if (view && view.onSettings) view.onSettings([k]);
    if (view && view.panel) view.panel.refresh();
    return v;
  }

  function handleMsg(m) {
    switch (m.t) {
      case 'state':
        var htmlChanged = m.html !== S.html;
        var prev = S.settings;
        S.settings = m.settings; S.text = m.text; S.html = m.html; S.name = m.name; S.rev = m.rev;
        if (view && view.onState) view.onState(htmlChanged, prev);
        if (htmlChanged && view && view.panel) view.panel.refreshOutline();
        break;
      case 'pos':
        S.pos = m.p; S.playing = m.playing; S.eta = (m.eta === undefined ? null : m.eta);
        if (view && view.onPos) view.onPos();
        break;
      case 'cmd': if (view && view.onCmd) view.onCmd(m); break;
      case 'peers':
        S.displays = m.displays; S.remotes = m.remotes;
        if (view && view.onPeers) view.onPeers();
        break;
      case 'library':
        S.library = m.files || [];
        S.libMsgs = (S.libMsgs || 0) + 1;
        if (view && view.panel) view.panel.refreshLibrary();
        break;
      case 'rendered': if (view && view.panel) view.panel.onRendered(m.html); break;
      case 'error': S.errAt = now(); S.errMsg = m.msg || 'error'; toast(S.errMsg); break;
      default: break;
    }
  }

  /* Send the script and CHECK it arrived (the hub echoes the new text back to everyone);
     retry a couple of times, because a phone on Wi-Fi sometimes loses the first message. */
  function sendTextConfirmed(text, name, done) {
    // The hub answers every accepted text with a new state (rev changes). Send once; only if
    // nothing at all came back after 6 s, send one more time (a lost first message on flaky
    // Wi-Fi). Never resend sooner: each text message rewinds the display to the top.
    var rev0 = S.rev, tries = 0;
    function finish(ok, msg) { toast(msg); if (done) done(ok); }
    function attempt() {
      tries++;
      if (!link || !link.send({ t: 'text', text: text, name: name })) {
        if (tries < 6) { setTimeout(attempt, 1000); return; }
        finish(false, t('offline')); return;
      }
      var started = now();
      (function wait() {
        if (S.rev !== rev0 || S.text === text) { finish(true, t('sent')); return; }
        if (now() - started < 6000) { setTimeout(wait, 300); return; }
        if (tries < 2) attempt(); else finish(false, t('no_answer'));
      }());
    }
    attempt();
  }

    function hasFile(n) {
    var want = [n.toLowerCase(), (n + '.md').toLowerCase()], lib = S.library || [];
    for (var i = 0; i < lib.length; i++) if (want.indexOf(String(lib[i]).toLowerCase()) >= 0) return true;
    return false;
  }

  /* Save and say truthfully what happened: "saved to <folder>" only once the hub lists the file */
  function saveConfirmed(name, text) {
    // The hub re-announces the library after every successful save, so a NEW library message
    // that lists the file is the proof. An error message from the hub is shown as it comes.
    var tries = 0, t0 = now(), l0 = S.libMsgs || 0;
    function attempt() {
      tries++;
      if (!link || !link.send({ t: 'save', name: name, text: text })) {
        if (tries < 6) { setTimeout(attempt, 1000); return; }
        toast(t('offline')); return;
      }
      var started = now();
      (function wait() {
        if (S.errAt > t0) return; // the hub told us why (toast already shown)
        if ((S.libMsgs || 0) > l0 && hasFile(name)) { toast(t('saved') + (S.libraryPath ? ' - ' + S.libraryPath : '')); return; }
        if (now() - started < 5000) { setTimeout(wait, 300); return; }
        if (tries < 2) attempt(); else toast(t('save_fail'));
      }());
    }
    attempt();
  }

    var toastTimer = null;
  function toast(msg) {
    var n = document.getElementById('toast');
    if (!n) { n = el('div', { id: 'toast' }); document.body.appendChild(n); }
    n.textContent = msg;
    n.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.style.display = 'none'; }, 2200);
  }

  /* ------------------------------------------------------------ fullscreen / wake lock */
  var nativeFs = false;
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || (nativeFs ? document.body : null); }
  function setFsClass(on) {
    nativeFs = !!on;
    document.body.className = on ? 'fs' : '';
    if (view && view.updateChrome) view.updateChrome();
    if (view && view.relayout) setTimeout(function () { view.relayout(); }, 120);
  }
  function toggleFullscreen() {
    // 1) Android app: the Java side hides the system bars (no tap needed).
    if (window.CueNative && window.CueNative.toggleFullscreen) {
      try { setFsClass(!!window.CueNative.toggleFullscreen()); } catch (e) {}
      return;
    }
    // 2) Desktop app: the window belongs to this machine's hub, ask it (works from a remote too).
    if (S.hasNative && link) {
      xhr('POST', link.target.host, '/api/native/fullscreen', link.target.pin, '', function (code, body) {
        if (code !== 200) { S.hasNative = false; toast(t('fs_tap')); return; }
        try { setFsClass(!!JSON.parse(body).fullscreen); } catch (e) {}
      });
      return;
    }
    // 3) A plain browser only allows fullscreen right after a tap/key on that page.
    try {
      var r;
      if (fsElement()) {
        r = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        var d = document.documentElement;
        r = (d.requestFullscreen || d.webkitRequestFullscreen).call(d);
      }
      if (r && r.catch) r.catch(function () { toast(t('fs_tap')); });
    } catch (e) { toast(t('fs_tap')); }
  }
  function onFsChange() {
    document.body.className = (document.fullscreenElement || document.webkitFullscreenElement) ? 'fs' : '';
    if (view && view.updateChrome) view.updateChrome();
    if (view && view.relayout) setTimeout(function () { view.relayout(); }, 60);
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  var wakeLock = null;
  function acquireWake() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }, function () {});
      }
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && view && view.wantsWake) acquireWake();
  });
  function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }

  /* headings of the current script, from the hub's sanitised HTML (parsed inertly) */
  function headingsOf(html) {
    var out = [];
    if (!html) return out;
    try {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var hs = doc.querySelectorAll('h1,h2,h3,h4,h5,h6');
      for (var i = 0; i < hs.length; i++) out.push({ level: parseInt(hs[i].tagName.charAt(1), 10), text: hs[i].textContent });
    } catch (e) {}
    return out;
  }

  /* ------------------------------------------------------------ app helpers: quit, key help */
  function quitApp() {
    if (S.hasNative && link) {
      xhr('POST', link.target.host, '/api/native/quit', link.target.pin, '', function (code) { if (code !== 200) toast(t('quit_no')); });
    } else {
      try { window.close(); } catch (e) {}
      toast(t('quit_no'));
    }
  }

  function toggleSwitch(k) {
    sendSet(k, !S.settings[k]);
    if (view && view.onSettings) view.onSettings([k]);
    if (view && view.panel) view.panel.refresh();
  }

  var KEYHELP = [
    ['Space / K', 'k_play'], ['\u2191 \u2193', 'k_scroll'], ['\u2190 \u2192  or  , .', 'k_speed'], ['+ / -   or   Alt+\u2191\u2193', 'k_size'],
    ['[ ]', 'k_width'], ['PageUp / PageDown', 'k_heading'], ['1 - 9', 'k_nth'], ['Home / T', 'k_top'], ['End', 'k_end'], ['R', 'k_restart'],
    ['F / F11 / Alt+F', 'k_full'], ['Esc', 'k_esc'], ['C', 'k_bar'], ['M', 'k_menu'], ['O', 'k_outline'], ['E', 'k_edit'],
    ['X / Y / B / D', 'k_flags'], ['Ctrl+Q', 'k_quit'], ['? / F1', 'k_help']
  ];
  function showHelp() {
    var old = document.getElementById('help');
    if (old) { old.parentNode.removeChild(old); return; }
    var rows = el('table');
    KEYHELP.forEach(function (r) {
      rows.appendChild(el('tr', {}, [el('td', { text: r[0], dir: 'ltr' }), el('td', { text: t(r[1]) })]));
    });
    var box = el('div', { class: 'help', id: 'help', onclick: function () { showHelp(); } }, el('div', { class: 'card' }, [
      el('h2', { text: t('keys_title') }), rows,
      el('p', { class: 'muted', text: t('k_touch') }),
      el('button', { text: t('hide'), onclick: function () { showHelp(); } })
    ]));
    document.body.appendChild(box);
  }

  /* ------------------------------------------------------------ script font (per device) */
  var FONTS = {
    sans: { label: 'Noto Sans Arabic', css: '"CueMe Sans Arabic", "Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, Tahoma, Arial, sans-serif' },
    naskh: { label: 'Noto Naskh Arabic', css: '"CueMe Naskh", "Noto Naskh Arabic", "Times New Roman", serif' },
    system: { label: 'System', css: '"Noto Sans Arabic", "Noto Naskh Arabic", system-ui, -apple-system, "Segoe UI", Roboto, Tahoma, Arial, sans-serif' }
  };
  function fontKey() { var k = store.get('cueme_font'); return FONTS[k] ? k : 'sans'; }
  function fontCss() { return FONTS[fontKey()].css; }

  /* ------------------------------------------------------------ theme (Catppuccin) */
  var T0 = CueTheme;
  function loadTheme() {
    var s = safeParse(store.get('cueme_theme'));
    return T0.valid(s) ? s : T0.defaults;
  }
  function setTheme(f, ac) {
    var th = { f: f, a: ac };
    store.set('cueme_theme', JSON.stringify(th));
    T0.apply(th);
  }

  /* flavour buttons + accent swatches; `rebuild` redraws the picker so the ticks follow */
  function themePicker() {
    var box = el('div', { class: 'themebox' });
    function draw() {
      clear(box);
      var cur = T0.current();
      var fl = el('div', { class: 'row' });
      T0.flavors.forEach(function (f) {
        fl.appendChild(el('button', { class: 'fl' + (f === cur.f ? ' on' : ''), text: T0.palettes[f].name,
          onclick: function () { setTheme(f, cur.a); draw(); } }));
      });
      var sw = el('div', { class: 'swatches' });
      T0.accents.forEach(function (ac) {
        var b = el('button', { class: 'sw' + (ac === cur.a ? ' on' : ''), title: ac, 'aria-label': ac,
          onclick: function () { setTheme(cur.f, ac); draw(); } });
        b.style.background = '#' + T0.palettes[cur.f][ac];
        sw.appendChild(b);
      });
      box.appendChild(el('div', { class: 'lab muted', text: t('theme') }));
      box.appendChild(fl);
      box.appendChild(sw);
    }
    draw();
    return box;
  }

  /* ------------------------------------------------------------ control panel (shared) */
  function Panel(opts) {
    var self = this;
    self.opts = opts; // { tabs: ['controls','script','link'], onConnectTab(fn) }
    self.root = el('div', { id: 'panel' });
    self.tab = opts.tabs[0];
    self.sliders = {};
    self.switches = {};
    self.dragging = {};
    self.dirty = false;
    self.previewMode = false;
    self.previewTimer = null;
    self.build();
  }

  Panel.prototype.build = function () {
    var self = this;
    clear(self.root);
    var tabs = el('div', { class: 'tabs' });
    self.tabButtons = {};
    self.opts.tabs.forEach(function (name) {
      var b = el('button', { text: t(name), onclick: function () { self.setTab(name); } });
      self.tabButtons[name] = b;
      tabs.appendChild(b);
    });
    if (self.opts.closable) {
      tabs.appendChild(el('button', { text: '✕', 'aria-label': t('hide'), style: 'flex:0 0 56px', onclick: function () { self.opts.onClose(); } }));
    }
    self.body = el('div', { class: 'tabbody' });
    self.root.appendChild(tabs);
    self.root.appendChild(self.body);
    self.setTab(self.tab);
  };

  Panel.prototype.setTab = function (name) {
    var self = this;
    self.tab = name;
    for (var k in self.tabButtons) self.tabButtons[k].className = (k === name) ? 'on' : '';
    clear(self.body);
    self.sliders = {}; self.switches = {};
    if (name === 'controls') self.buildControls();
    else if (name === 'outline') self.buildOutline();
    else if (name === 'script') self.buildScript();
    else if (name === 'link') self.buildLink();
  };

  Panel.prototype.buildControls = function () {
    var self = this;
    SPEC.forEach(function (sp) {
      var val = el('span', { class: 'val' });
      var inp = el('input', { type: 'range', min: sp.min, max: sp.max, step: sp.step });
      var stopDrag = function () { setTimeout(function () { self.dragging[sp.k] = false; }, 400); };
      ['mousedown', 'touchstart', 'pointerdown'].forEach(function (ev) {
        inp.addEventListener(ev, function () { self.dragging[sp.k] = true; });
      });
      ['mouseup', 'touchend', 'pointerup', 'change', 'blur'].forEach(function (ev) { inp.addEventListener(ev, stopDrag); });
      inp.addEventListener('input', function () {
        var v = parseFloat(inp.value);
        self.dragging[sp.k] = true;
        val.textContent = v + sp.unit;
        sendSet(sp.k, v);
        if (view && view.onSettings) view.onSettings([sp.k]);
      });
      self.sliders[sp.k] = { inp: inp, val: val, sp: sp };
      self.body.appendChild(el('div', { class: 'ctl' }, [
        el('div', { class: 'lab' }, [el('span', { text: t(sp.k) }), val]), inp
      ]));
    });
    var sw = el('div', { class: 'switches' });
    SWITCHES.forEach(function (k) {
      var cb = el('input', { type: 'checkbox' });
      cb.addEventListener('change', function () {
        sendSet(k, cb.checked);
        if (view && view.onSettings) view.onSettings([k]);
      });
      self.switches[k] = cb;
      sw.appendChild(el('label', {}, [cb, el('span', { text: t(k) })]));
    });
    self.body.appendChild(sw);
    var colors = el('div', { class: 'row' });
    ['text_color', 'bg_color'].forEach(function (k) {
      var c = el('input', { type: 'color' });
      c.addEventListener('input', function () {
        // old WebViews show a plain text box instead of a colour picker: only send complete colours
        if (!/^#[0-9a-fA-F]{6}$/.test(c.value)) return;
        sendSet(k, c.value);
        if (view && view.onSettings) view.onSettings([k]);
      });
      self.switches[k] = c;
      colors.appendChild(el('label', { class: 'row' }, [c, el('span', { text: t(k) })]));
    });
    self.body.appendChild(colors);
    self.body.appendChild(el('div', { class: 'row' }, [
      el('button', { text: t('fullscreen'), onclick: toggleFullscreen })
    ]));
    self.body.appendChild(el('div', { class: 'row' }, [
      el('button', { text: t('theme_script'), onclick: function () {
        var sc = T0.scriptColors();
        sendSet('text_color', sc.text_color); sendSet('bg_color', sc.bg_color);
        if (view && view.onSettings) view.onSettings(['text_color', 'bg_color']);
        self.refresh();
      } })
    ]));
    self.body.appendChild(themePicker());
    var fsel = el('select', { class: 'fontsel', 'aria-label': t('font') });
    for (var fk in FONTS) fsel.appendChild(el('option', { value: fk, text: FONTS[fk].label }));
    fsel.value = fontKey();
    fsel.addEventListener('change', function () {
      store.set('cueme_font', fsel.value);
      if (view && view.applyStyle) { view.applyStyle(); view.relayout(); }
    });
    self.body.appendChild(el('div', { class: 'ctl' }, [el('div', { class: 'lab' }, el('span', { text: t('font') })), fsel]));
    self.body.appendChild(el('div', { class: 'row' }, [el('button', { text: t('keys_title'), onclick: function () { showHelp(); } })]));
    self.refresh();
  };

  Panel.prototype.refresh = function () {
    var self = this;
    if (self.tab !== 'controls') return;
    var st = S.settings, k;
    for (k in self.sliders) {
      var s = self.sliders[k];
      if (self.dragging[k]) continue;
      s.inp.value = st[k];
      s.val.textContent = st[k] + s.sp.unit;
    }
    for (k in self.switches) {
      var n = self.switches[k];
      if (n.type === 'checkbox') n.checked = !!st[k];
      else n.value = st[k];
    }
  };

  Panel.prototype.buildOutline = function () {
    var self = this;
    self.outlineBox = el('div', { class: 'outline' });
    self.body.appendChild(self.outlineBox);
    self.refreshOutline();
  };

  Panel.prototype.refreshOutline = function () {
    var self = this;
    if (self.tab !== 'outline' || !self.outlineBox) return;
    clear(self.outlineBox);
    var hs = headingsOf(S.html);
    if (!hs.length) {
      self.outlineBox.appendChild(el('p', { class: 'muted', text: t('outline_empty') }));
      return;
    }
    hs.forEach(function (h, i) {
      self.outlineBox.appendChild(el('button', {
        class: 'olink', dir: 'auto', text: h.text || '#',
        style: 'margin-inline-start:' + ((h.level - 1) * 14) + 'px; width:calc(100% - ' + ((h.level - 1) * 14) + 'px)',
        onclick: function () { if (self.opts.onGoto) self.opts.onGoto(i); }
      }));
    });
  };

  Panel.prototype.buildScript = function () {
    var self = this;
    var ta = el('textarea', { dir: 'auto', spellcheck: 'false', placeholder: '# ...' });
    self.ta = ta;
    ta.value = S.text;
    self.dirty = false;
    ta.addEventListener('input', function () {
      self.dirty = true;
      if (self.previewMode) self.schedulePreview();
    });
    self.preview = el('div', { class: 'preview md', style: 'display:none' });
    self.editBtn = el('button', { text: t('edit'), onclick: function () { self.setPreview(false); } });
    self.prevBtn = el('button', { text: t('preview'), onclick: function () { self.setPreview(true); } });
    self.nameInp = el('input', { type: 'text', dir: 'auto', placeholder: t('file_name'), value: S.name });
    self.filesBox = el('div', { class: 'files' });

    self.body.appendChild(el('div', { class: 'row' }, [self.editBtn, self.prevBtn]));
    self.body.appendChild(ta);
    self.body.appendChild(self.preview);
    self.body.appendChild(el('div', { class: 'row' }, [
      el('button', {
        class: 'primary', text: t('send'), onclick: function () {
          self.dirty = false;
          sendTextConfirmed(ta.value, self.nameInp.value.trim() || null);
        }
      })
    ]));
    self.body.appendChild(el('div', { class: 'row' }, [
      el('div', { class: 'grow' }, [self.nameInp]),
      el('button', {
        text: t('save'), onclick: function () {
          var n = self.nameInp.value.trim();
          if (!n) { self.nameInp.focus(); return; }
          saveConfirmed(n, ta.value);
        }
      })
    ]));
    self.pathNote = el('p', { class: 'muted', dir: 'ltr' });
    self.body.appendChild(self.pathNote);
    self.refreshPath();
    self.body.appendChild(el('h3', { text: t('library') }));
    self.body.appendChild(self.filesBox);
    self.setPreview(false);
    self.refreshLibrary();
  };

  Panel.prototype.refreshPath = function () {
    if (this.tab === 'script' && this.pathNote) {
      this.pathNote.textContent = S.libraryPath ? (t('saved_in') + ' ' + S.libraryPath) : '';
    }
  };

  Panel.prototype.setPreview = function (on) {
    this.previewMode = on;
    this.ta.style.display = on ? 'none' : 'block';
    this.preview.style.display = on ? 'block' : 'none';
    this.editBtn.className = on ? '' : 'primary';
    this.prevBtn.className = on ? 'primary' : '';
    if (on) this.schedulePreview(0);
  };

  Panel.prototype.schedulePreview = function (delay) {
    var self = this;
    clearTimeout(self.previewTimer);
    self.previewTimer = setTimeout(function () {
      if (link && self.ta) link.send({ t: 'render', text: self.ta.value });
    }, delay === undefined ? 250 : delay);
  };

  Panel.prototype.onRendered = function (html) {
    if (this.preview && this.previewMode) {
      this.preview.innerHTML = html; // sanitised by the Rust hub (cue-core::markdown)
    }
  };

  Panel.prototype.refreshLibrary = function () {
    var self = this;
    if (self.tab !== 'script' || !self.filesBox) return;
    clear(self.filesBox);
    if (!S.library.length) {
      self.filesBox.appendChild(el('p', { class: 'muted', text: t('empty_lib') }));
      return;
    }
    S.library.forEach(function (name) {
      self.filesBox.appendChild(el('div', { class: 'file' }, [
        el('button', {
          class: 'name', dir: 'auto', text: name, title: t('load'), onclick: function () {
            if (link) link.send({ t: 'load', name: name });
            self.nameInp.value = name;
            self.dirty = false;
          }
        }),
        el('button', {
          class: 'danger', text: '✕', 'aria-label': t('del'), onclick: function () {
            if (!window.confirm(t('confirm_del') + '\n' + name)) return;
            xhr('DELETE', link.target.host, '/api/library/' + encodeURIComponent(name), link.target.pin, null, function () {});
          }
        })
      ]));
    });
  };

  // called when the session text changes on another device
  Panel.prototype.onSessionText = function () {
    if (this.tab === 'script' && this.ta && !this.dirty) {
      this.ta.value = S.text;
      if (this.nameInp && document.activeElement !== this.nameInp) this.nameInp.value = S.name;
      if (this.previewMode) this.schedulePreview(0);
    }
  };

  Panel.prototype.buildLink = function () {
    var self = this;
    var box = el('div');
    self.body.appendChild(box);
    var own = ownTarget();
    var tg = link ? link.target : own;
    if (tg) {
      box.appendChild(el('p', { class: 'muted', text: tg.host }));
    }
    if (self.opts.showShare && own) {
      xhr('GET', own.host, '/api/connect', own.pin, null, function (code, body) {
        if (code !== 200) return;
        var info;
        try { info = JSON.parse(body); } catch (e) { return; }
        box.appendChild(el('p', { text: t('scan_other') }));
        if (info.urls && info.urls.length) {
          var qr = el('div', { class: 'qr' }, [el('img', { alt: 'QR', src: '/api/qr.svg?text=' + encodeURIComponent(info.urls[0]) })]);
          box.appendChild(qr);
          info.urls.forEach(function (u) { box.appendChild(el('div', { class: 'url', dir: 'ltr', text: u })); });
        }
        box.appendChild(el('p', {}, [el('span', { class: 'muted', text: t('pin') + ': ' }), el('b', { text: info.pin, dir: 'ltr' })]));
      });
    }
    box.appendChild(el('div', { class: 'row' }, [
      el('button', { text: t('lang'), onclick: function () { I.toggle(); location.reload(); } }),
      el('button', { text: t('back'), onclick: function () { goHome(); } })
    ]));
  };

  /* ------------------------------------------------------------ own target */
  function ownTarget() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
    var host = location.host;
    var m = /(?:^#|&)pin=([^&]+)/.exec(location.hash || '');
    if (m) {
      var pin = dec(m[1]);
      store.set('cueme_pin:' + host, pin);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    }
    var saved = store.get('cueme_pin:' + host);
    return saved ? { host: host, pin: saved } : { host: host, pin: '' };
  }

  /* ------------------------------------------------------------ screens */
  function setView(v) {
    if (view && view.destroy) view.destroy();
    view = v;
  }

  var atHome = true;
  var scannerClose = null;
  function goHome(msg) {
    atHome = true;
    if (scannerClose) scannerClose();
    stopChooserTimer();
    setView(null);
    if (link) { link.close(); link = null; }
    releaseWake();
    document.body.className = '';
    document.documentElement.dir = I.lang() === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = I.lang();
    clear(app);
    var own = ownTarget();
    var scr = el('div', { class: 'screen' });
    var card = el('div', { class: 'card' });
    scr.appendChild(card);
    card.appendChild(el('h1', { class: 'logo', text: 'CueMe' }));
    card.appendChild(el('p', { class: 'sub', text: 'Teleprompter · ملقّن نصي' }));
    if (msg) card.appendChild(el('p', { class: 'err', text: msg }));
    card.appendChild(el('button', {
      class: 'big', onclick: function () {
        if (own && own.pin) startRole(own, 'display');
        else connectForm('display', own);
      }
    }, [el('b', { text: t('display') }), el('span', { text: t('display_hint') })]));
    card.appendChild(el('button', {
      class: 'big', onclick: function () { remoteChooser(own); }
    }, [el('b', { text: t('remote') }), el('span', { text: t('remote_hint') })]));
    card.appendChild(el('div', { class: 'row' }, [
      el('button', { text: t('lang'), onclick: function () { I.toggle(); goHome(); } })
    ]));
    card.appendChild(themePicker());
    app.appendChild(scr);
  }

  /* check the address + PIN with a plain request, then start */
  function tryConnect(tg, role, onFail) {
    xhr('GET', tg.host, '/api/library', tg.pin, null, function (code) {
      if (code === 200) {
        store.set('cueme_last', JSON.stringify(tg));
        startRole(tg, role);
      } else onFail(code === 401 ? t('bad_pin') : t('offline'));
    });
  }

  function connectForm(role, own, preset, msg) {
    atHome = false;
    stopChooserTimer();
    var last = preset || safeParse(store.get('cueme_last')) || {};
    var host = el('input', { type: 'text', dir: 'ltr', placeholder: t('host'), value: last.host || (own ? own.host : ''), autocapitalize: 'off', autocorrect: 'off' });
    var pin = el('input', { type: 'text', dir: 'ltr', inputmode: 'numeric', pattern: '[0-9]*', placeholder: t('pin'), value: last.pin || '', autocapitalize: 'off', autocorrect: 'off' });
    var err = el('p', { class: 'err', text: msg || '' });
    function go() {
      var h = host.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!h) { host.focus(); return; }
      if (h.indexOf(':') < 0) h += ':7878';
      err.textContent = t('connecting');
      tryConnect({ host: h, pin: pin.value.trim() }, role, function (m) { err.textContent = m; });
    }
    pin.addEventListener('keydown', function (e) { if (e.keyCode === 13) go(); });
    clear(app);
    var buttons = [el('button', { class: 'primary', text: t('connect'), onclick: go })];
    if (role === 'remote' && canScan()) buttons.push(el('button', { text: t('scan'), onclick: function () { scanAndConnect(); } }));
    buttons.push(el('button', { text: t('back'), onclick: function () { goHome(); } }));
    app.appendChild(el('div', { class: 'screen' }, el('div', { class: 'card' }, [
      el('h1', { class: 'logo', text: t(role) }),
      el('div', { class: 'ctl' }, host), el('div', { class: 'ctl' }, pin), err,
      el('div', { class: 'row' }, buttons)
    ])));
    setTimeout(function () { try { (host.value && !pin.value ? pin : host).focus(); } catch (e) {} }, 50);
  }

  /* ------------------------------------------------------------ QR scanner (camera) */
  function canScan() {
    return !!(window.jsQR && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function decodeCanvas(canvas) {
    if (!window.jsQR) return null;
    var img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    var r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    return r ? r.data : null;
  }

  /* the code on a display holds  http://192.168.1.20:7878/#pin=123  */
  function parseScanned(text) {
    var m = /^https?:\/\/([^\/#?\s]+)[^#\s]*#pin=([^&\s]+)/i.exec(text || '');
    return m ? { host: m[1], pin: dec(m[2]) } : null;
  }

  function openScanner(onTarget) {
    var stream = null, timer = null, done = false;
    var video = el('video', { autoplay: true, muted: true, playsinline: true });
    var status = el('p', { class: 'muted', text: t('scan_hint') });
    var canvas = document.createElement('canvas');
    var box = el('div', { class: 'scan' }, [video, status, el('button', { text: t('cancel'), onclick: function () { close(); } })]);
    document.body.appendChild(box);
    scannerClose = function () { close(); };
    function close() {
      scannerClose = null;
      done = true;
      clearInterval(timer);
      if (stream) { try { stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) {} }
      if (box.parentNode) box.parentNode.removeChild(box);
    }
    function tick() {
      if (done || !video.videoWidth) return;
      var s = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * s);
      canvas.height = Math.round(video.videoHeight * s);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      var text = decodeCanvas(canvas);
      if (!text) return;
      var tg = parseScanned(text);
      if (tg) { close(); onTarget(tg); } else status.textContent = t('scan_bad');
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      if (done) { s.getTracks().forEach(function (tr) { tr.stop(); }); return; }
      stream = s;
      if ('srcObject' in video) video.srcObject = s; else video.src = URL.createObjectURL(s);
      try { var pl = video.play(); if (pl && pl.catch) pl.catch(function () {}); } catch (e) {}
      timer = setInterval(tick, 250);
    }, function () { status.textContent = t('scan_fail'); });
  }

  function scanAndConnect() {
    openScanner(function (tg) {
      tryConnect(tg, 'remote', function (m) { toast(m); });
    });
  }

  function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }

  var chooserTimer = null;
  function stopChooserTimer() { if (chooserTimer) { clearInterval(chooserTimer); chooserTimer = null; } }

  function remoteChooser(own) {
    atHome = false;
    stopChooserTimer();
    clear(app);
    var list = el('div');
    var card = el('div', { class: 'card' }, [el('h1', { class: 'logo', text: t('remote') })]);
    if (canScan()) {
      card.appendChild(el('button', { class: 'big', onclick: function () { scanAndConnect(); } }, [el('b', { text: t('scan') }), el('span', { text: t('scan_hint') })]));
    }
    if (own && own.pin) {
      card.appendChild(el('button', {
        class: 'peer', text: t('this_device') + ' - ' + own.host, onclick: function () { startRole(own, 'remote'); }
      }));
    }
    card.appendChild(el('h3', { text: t('nearby') }));
    card.appendChild(list);
    card.appendChild(el('div', { class: 'row' }, [
      el('button', { class: 'primary', text: t('connect') + ' ...', onclick: function () { connectForm('remote', own); } }),
      el('button', { text: t('back'), onclick: function () { goHome(); } })
    ]));
    app.appendChild(el('div', { class: 'screen' }, card));
    // other CueMe apps announce themselves every 2 s: keep the list fresh while this screen is open
    function refresh() {
      if (!own || !own.pin) return;
      xhr('GET', own.host, '/api/discover', own.pin, null, function (code, body) {
        if (!chooserTimer || !list.parentNode) return;
        var peers = code === 200 ? (safeParse(body) || []) : [];
        clear(list);
        if (!peers.length) { list.appendChild(el('p', { class: 'muted', text: t('none_found') })); return; }
        peers.forEach(function (p) {
          var h = p.addrs[0] + ':' + p.port;
          list.appendChild(el('button', {
            class: 'peer', dir: 'ltr', text: p.name + ' - ' + h, onclick: function () { connectForm('remote', own, { host: h, pin: '' }); }
          }));
        });
      });
    }
    chooserTimer = setInterval(refresh, 2000);
    list.appendChild(el('p', { class: 'muted', text: t('none_found') }));
    refresh();
  }

  function startRole(target, role) {
    atHome = false;
    stopChooserTimer();
    clear(app);
    if (link) link.close();
    S.text = ''; S.html = ''; S.name = ''; S.pos = 0; S.playing = false; S.eta = null; S.displays = 0; S.remotes = 0;
    S.settings = copy(DEFAULTS);
    var statusCb = function (ok) { S.connected = ok; if (view && view.onStatus) view.onStatus(ok); };
    link = new Link(target, role, {
      status: statusCb, msg: handleMsg,
      badPin: function () { goHome(t('bad_pin')); }
    });
    if (role === 'display') view = new DisplayView(target); else view = new RemoteView(target);
    // library folder (shown in the Script tab) and whether this app can control its own window
    xhr('GET', target.host, '/api/connect', target.pin, null, function (code, body) {
      if (code !== 200) return;
      var info = safeParse(body);
      if (!info) return;
      S.libraryPath = info.library || '';
      S.hasNative = !!info.native && target.host === location.host && /^(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(location.host);
      if (view && view.panel) view.panel.refreshPath();
    });
  }

  /* ------------------------------------------------------------ DISPLAY view */
  function DisplayView(target) {
    var self = this;
    self.wantsWake = true;
    self.eng = new Engine();
    self.last = 0;
    self.raf = 0;
    self.lastSent = 0;
    self.lastSentPos = -1;
    self.lastPlaying = false;
    self.wasMoving = false;
    self.jogTimer = null;
    self.counting = false;
    self.countTimer = null;
    self.destroyed = false;
    self.keys = {};

    self.stage = el('div', { id: 'stage' });
    self.flip = el('div', { id: 'flip' });
    self.content = el('div', { id: 'content', class: 'md', dir: 'auto' });
    self.fade = el('div', { id: 'fade' });
    self.cueL = el('div', { class: 'cue l' });
    self.cueR = el('div', { class: 'cue r' });
    self.count = el('div', { id: 'count' });
    self.bar = el('div', { id: 'progressbar' });
    self.hint = el('div', { id: 'hint', text: t('empty_script') });
    self.menu = el('button', { id: 'menubtn', text: '☰', 'aria-label': t('menu'), onclick: function () { self.togglePanel(); } });
    /* stand-alone controls: tap the screen to show/hide */
    self.dplay = el('button', { class: 'primary play', text: '▶', 'aria-label': t('play'), onclick: function () { self.toggle(); self.touchBar(); } });
    self.dscrub = el('input', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': t('scrub') });
    self.dscrub.addEventListener('input', function () { self.cancelCountdown(); self.eng.seekFraction(parseFloat(self.dscrub.value) / 1000); self.touchBar(); });
    var dbtn = function (txt, label, fn) { return el('button', { text: txt, title: label, 'aria-label': label, onclick: function () { fn(); self.touchBar(); } }); };
    self.dctl = el('div', { id: 'dctl' }, [
      el('div', { class: 'row' }, [
        dbtn('⏮', t('top'), function () { self.eng.target = 0; }),
        dbtn('◀◀', t('prev'), function () { self.heading(-1); }),
        self.dplay,
        dbtn('▶▶', t('next'), function () { self.heading(1); }),
        dbtn('⛶', t('fullscreen'), function () { toggleFullscreen(); })
      ]),
      el('div', { class: 'row' }, [
        dbtn('− ' + t('speed'), t('speed'), function () { adjust('speed', -1); }),
        dbtn('+ ' + t('speed'), t('speed'), function () { adjust('speed', 1); }),
        dbtn('A−', t('font_size'), function () { adjust('font_size', -2); }),
        dbtn('A+', t('font_size'), function () { adjust('font_size', 2); })
      ]),
      el('div', { class: 'row' }, [
        dbtn('\u2630 ' + t('menu'), t('menu'), function () { self.toggleBar(false); self.togglePanel(true); }),
        dbtn('? ' + t('keys_title'), t('keys_title'), function () { showHelp(); })
      ]),
      self.dscrub
    ]);
    self.dctl.addEventListener('click', function (e) { if (e.stopPropagation) e.stopPropagation(); });
    self.barTimer = null;
    self.noClickUntil = 0;
    /* tiny see-through button that brings the controls back while they are hidden */
    self.fab = el('button', { id: 'fab', text: '\u22EF', title: t('show_controls'), 'aria-label': t('show_controls'), onclick: function (e) { if (e.stopPropagation) e.stopPropagation(); self.toggleBar(true); } });
    self.flip.appendChild(self.content);
    self.stage.appendChild(self.flip);
    self.stage.appendChild(self.fade);
    self.stage.appendChild(self.cueL);
    self.stage.appendChild(self.cueR);
    self.stage.appendChild(self.count);
    self.stage.appendChild(self.bar);
    self.stage.appendChild(self.hint);
    self.stage.appendChild(self.dctl);
    self.stage.appendChild(self.fab);
    self.panel = new Panel({
      tabs: ['controls', 'outline', 'script', 'link'], closable: true, showShare: true,
      onClose: function () { self.togglePanel(false); },
      onGoto: function (i) { self.gotoHeading(i); self.togglePanel(false); }
    });
    app.appendChild(self.stage);
    app.appendChild(self.menu);
    self.updateChrome();
    app.appendChild(self.panel.root);

    self.onKeyDown = function (e) { self.keyDown(e); };
    self.onKeyUp = function (e) { self.keyUp(e); };
    self.onResize = function () { self.relayout(); };
    self.onBlur = function () { self.eng.jog = 0; };
    document.addEventListener('keydown', self.onKeyDown);
    document.addEventListener('keyup', self.onKeyUp);
    window.addEventListener('blur', self.onBlur);
    window.addEventListener('resize', self.onResize);
    self.stage.addEventListener('dblclick', function () { toggleFullscreen(); });
    self.content.addEventListener('click', function (e) {
      var n = e.target;
      while (n && n !== self.content) { if (n.tagName === 'A') { e.preventDefault(); break; } n = n.parentNode; }
    });
    self.setupDrag();
    self.stage.addEventListener('click', function () {
      if (now() < self.noClickUntil) return; // that was a drag, not a tap
      if (self.panel.root.className.indexOf('open') >= 0) self.togglePanel(false);
      else if (!self.isClean()) self.toggleBar(); // while presenting, stray taps do nothing: use the small button
    });

    self.applyStyle();
    self.relayout();
    acquireWake();
    self.loop = function (ts) { self.frame(ts); };
    self.raf = self.requestFrame(self.loop);
  }

  /* Touch / mouse drag scrolls the text, the mouse wheel glides it. While a finger is down
     the text follows it (auto-scroll waits); on release it resumes and a quick flick glides on. */
  DisplayView.prototype.setupDrag = function () {
    var self = this, st = self.stage, d = null;
    var dirSign = function () { return S.settings.flip_y ? -1 : 1; };
    var onUi = function (e) {
      var n = e.target;
      while (n && n !== st) { if (n.id === 'dctl' || n.id === 'fab' || n.id === 'menubtn') return true; n = n.parentNode; }
      return false;
    };
    var start = function (y, e) {
      if (onUi(e) || self.panel.root.className.indexOf('open') >= 0) return;
      self.eng.held = false;
      d = { y0: y, last: y, lastT: now(), v: 0, moved: false };
    };
    var move = function (y) {
      if (!d) return;
      if (!d.moved) { if (Math.abs(y - d.y0) < 8) return; d.moved = true; self.eng.held = true; self.eng.target = null; self.eng.jog = 0; self.cancelCountdown(); }
      var t1 = now(), dy = y - d.last;
      var inst = dy / Math.max(1, t1 - d.lastT) * 1000;
      d.v = d.v * 0.6 + inst * 0.4;
      d.last = y; d.lastT = t1;
      self.eng.nudge(-dy * dirSign());
      self.paint();
      self.sendPos(false);
    };
    var end = function () {
      if (!d) return;
      var was = d; d = null;
      if (!was.moved) return;
      self.eng.held = false;
      self.noClickUntil = now() + 350;
      if (Math.abs(was.v) > 400 && now() - was.lastT < 120) self.eng.glideBy(-was.v * 0.3 * dirSign()); // flick
      self.sendPos(true);
    };
    st.addEventListener('touchstart', function (e) { if (e.touches.length === 1) start(e.touches[0].clientY, e); else end(); });
    st.addEventListener('touchmove', function (e) { if (e.touches.length === 1) move(e.touches[0].clientY); });
    st.addEventListener('touchend', end);
    st.addEventListener('touchcancel', end);
    st.addEventListener('mousedown', function (e) { if (e.button === 0) start(e.clientY, e); });
    document.addEventListener('mousemove', self.onMouseMove = function (e) { if (d && (e.buttons & 1)) move(e.clientY); else if (d) end(); });
    document.addEventListener('mouseup', self.onMouseUp = end);
    window.addEventListener('blur', self.onDragBlur = function () { if (d) { d.moved = d.moved || false; if (d.moved) end(); else d = null; } });
    st.addEventListener('wheel', function (e) {
      if (self.panel.root.className.indexOf('open') >= 0) return;
      var dy = e.deltaY * (e.deltaMode === 1 ? 40 : (e.deltaMode === 2 ? self.stage.clientHeight : 1));
      if (!dy) return;
      e.preventDefault();
      self.cancelCountdown();
      self.eng.glideBy(dy * dirSign());
    });
  };

  DisplayView.prototype.requestFrame = function (fn) {
    return (window.requestAnimationFrame || function (f) { return setTimeout(function () { f(now()); }, 16); })(fn);
  };

  DisplayView.prototype.destroy = function () {
    this.destroyed = true;
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('blur', this.onDragBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('resize', this.onResize);
    clearTimeout(this.countTimer);
    clearTimeout(this.jogTimer);
    clearTimeout(this.barTimer);
    releaseWake();
  };

  /* clean = nothing but the script: fullscreen, or "hide controls" */
  DisplayView.prototype.isClean = function () { return document.body.className.indexOf('fs') >= 0; };
  DisplayView.prototype.updateChrome = function () {
    app.className = this.isClean() ? 'clean' : '';
  };
  DisplayView.prototype.toggleBar = function (on) {
    var open = this.dctl.className.indexOf('show') >= 0;
    if (on === undefined) on = !open;
    this.dctl.className = on ? 'show' : '';
    clearTimeout(this.barTimer);
    if (on) this.touchBar();
  };

  /* keep the bar up while it is being used, hide it 5 s after the last touch */
  DisplayView.prototype.touchBar = function () {
    var self = this;
    clearTimeout(self.barTimer);
    self.barTimer = setTimeout(function () { self.dctl.className = ''; }, 5000);
  };

  DisplayView.prototype.syncBar = function () {
    var playing = this.eng.playing || this.counting;
    var txt = playing ? '⏸' : '▶';
    if (this.dplay.textContent !== txt) this.dplay.textContent = txt;
    if (this.dctl.className.indexOf('show') >= 0 && document.activeElement !== this.dscrub) this.dscrub.value = Math.round(this.eng.progress() * 1000);
  };

  DisplayView.prototype.togglePanel = function (on) {
    var open = this.panel.root.className.indexOf('open') >= 0;
    if (on === undefined) on = !open;
    this.panel.root.className = on ? 'open' : '';
    if (on) { this.panel.setTab(this.panel.tab); }
  };

  DisplayView.prototype.onStatus = function (ok) {
    toast(ok ? t('connected') : t('offline'));
  };

  /* apply colours/fonts that do not change layout */
  DisplayView.prototype.applyStyle = function () {
    var s = S.settings;
    this.stage.style.background = s.bg_color;
    this.content.style.color = s.text_color;
    this.content.style.fontSize = s.font_size + 'px';
    this.content.style.fontFamily = fontCss();
    this.content.className = 'md' + (s.bold ? ' bold' : '');
    this.flip.style.transform = 'scale(' + (s.flip_x ? -1 : 1) + ',' + (s.flip_y ? -1 : 1) + ')';
    this.cueL.style.display = this.cueR.style.display = 'block';
    this.cueL.style.top = this.cueR.style.top = s.focus_pos + '%';
    var rgb = hexToRgb(s.bg_color);
    var a = s.dim / 100;
    var c1 = 'rgba(' + rgb.join(',') + ',' + a + ')';
    var c0 = 'rgba(' + rgb.join(',') + ',0)';
    var fp = s.focus_pos;
    var lo = Math.max(0, fp - 14), hi = Math.min(100, fp + 14);
    this.fade.style.background = s.focus && s.dim > 0
      ? 'linear-gradient(to bottom,' + c1 + ' 0%,' + c0 + ' ' + lo + '%,' + c0 + ' ' + hi + '%,' + c1 + ' 100%)'
      : 'none';
  };

  DisplayView.prototype.captureAnchor = function () {
    var kids = this.content.children;
    if (!kids.length) return null;
    var cueY = this.padTop + this.eng.pos;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.offsetTop + k.offsetHeight > cueY) {
        return { i: i, f: clamp((cueY - k.offsetTop) / Math.max(1, k.offsetHeight), 0, 1) };
      }
    }
    return { i: kids.length - 1, f: 1 };
  };

  DisplayView.prototype.restoreAnchor = function (a) {
    if (!a) return;
    var k = this.content.children[a.i];
    if (!k) return;
    var cueY = k.offsetTop + a.f * k.offsetHeight;
    this.eng.jump(cueY - this.padTop);
  };

  /* recompute geometry; keeps your place in the TEXT, not in pixels */
  DisplayView.prototype.relayout = function (keepAnchor) {
    var a = (keepAnchor === false) ? null : this.captureAnchor();
    var targetFrac = (this.eng.target !== null && this.eng.max > 0) ? this.eng.target / this.eng.max : null;
    var s = S.settings;
    this.applyStyle(); // font size etc. must be in place BEFORE we measure
    var H = this.stage.clientHeight || window.innerHeight;
    this.padTop = Math.round(H * s.focus_pos / 100);
    var padBottom = Math.max(0, H - this.padTop);
    this.content.style.width = s.width + '%';
    this.content.style.paddingTop = this.padTop + 'px';
    this.content.style.paddingBottom = padBottom + 'px';
    this.eng.setMax(this.content.offsetHeight - this.padTop - padBottom);
    this.eng.speed = Engine.speedToPx(s.speed, s.font_size, LINE_H);
    this.eng.jogSpeed = s.font_size * LINE_H * 8;
    this.eng.maxSeekV = H * 4;
    this.restoreAnchor(a);
    if (targetFrac !== null) this.eng.target = targetFrac * this.eng.max;
    this.paint();
  };

  DisplayView.prototype.paint = function () {
    this.content.style.transform = 'translate3d(-50%,' + (-this.eng.pos).toFixed(2) + 'px,0)';
    this.bar.style.width = (this.eng.progress() * 100).toFixed(2) + '%';
    this.syncBar();
  };

  DisplayView.prototype.onSettings = function (keys) {
    var layout = false;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === 'font_size' || keys[i] === 'width' || keys[i] === 'focus_pos' || keys[i] === 'speed') layout = true;
    }
    if (layout) this.relayout(); else this.applyStyle();
  };

  DisplayView.prototype.onState = function (htmlChanged, prev) {
    var s = S.settings;
    if (htmlChanged) {
      this.eng.pause(); this.eng.jump(0); this.eng.jog = 0;
      this.cancelCountdown();
      this.content.innerHTML = S.html; // sanitised by cue-core::markdown on the hub
      this.hint.style.display = S.html ? 'none' : 'block';
      this.relayout(false);
      this.sendPos(true);
    } else {
      var layout = !prev || prev.font_size !== s.font_size || prev.width !== s.width ||
        prev.focus_pos !== s.focus_pos || prev.speed !== s.speed;
      if (layout) this.relayout(); else this.applyStyle();
    }
    this.panel.refresh();
    this.panel.onSessionText();
  };

  DisplayView.prototype.onPos = function () { /* the display owns the position */ };
  DisplayView.prototype.onPeers = function () {};

  DisplayView.prototype.sendPos = function (force) {
    var e = this.eng;
    var t0 = now();
    if (!force && t0 - this.lastSent < 66) return;
    this.lastSent = t0;
    this.lastSentPos = e.pos;
    this.lastPlaying = e.playing || this.counting;
    var eta = e.eta();
    var m = { t: 'pos', p: e.progress(), playing: e.playing };
    if (eta !== null) m.eta = eta;
    if (link) link.send(m);
  };

  DisplayView.prototype.frame = function (ts) {
    if (this.destroyed) return;
    var dt = this.last ? (ts - this.last) / 1000 : 0;
    this.last = ts;
    var wasPlaying = this.eng.playing;
    var moved = this.eng.step(dt);
    if (moved) this.paint();
    if (moved) { this.sendPos(false); this.wasMoving = true; }
    else if (this.wasMoving) { this.wasMoving = false; this.sendPos(true); }
    if (wasPlaying && !this.eng.playing) this.sendPos(true); // reached the end
    this.raf = this.requestFrame(this.loop);
  };

  DisplayView.prototype.cancelCountdown = function () {
    this.counting = false;
    clearTimeout(this.countTimer);
    this.count.style.display = 'none';
  };

  DisplayView.prototype.play = function () {
    var self = this, e = self.eng;
    if (e.playing || self.counting) return;
    if (e.max <= 0) return;
    if (e.pos >= e.max - 1) e.jump(0);
    var n = Math.round(S.settings.countdown);
    if (S.settings.auto_fullscreen && !fsElement()) toggleFullscreen();
    if (n > 0) {
      self.counting = true;
      var tick = function () {
        if (!self.counting) return;
        if (n <= 0) { self.cancelCountdown(); e.play(); self.sendPos(true); return; }
        self.count.textContent = String(n);
        self.count.style.display = 'flex';
        n--;
        self.countTimer = setTimeout(tick, 1000);
      };
      tick();
    } else {
      e.play();
      self.sendPos(true);
    }
    self.syncBar();
  };

  DisplayView.prototype.pause = function () {
    this.cancelCountdown();
    this.eng.pause();
    this.sendPos(true);
    this.syncBar();
  };

  DisplayView.prototype.toggle = function () {
    if (this.eng.playing || this.counting) this.pause(); else this.play();
    this.syncBar();
  };

  DisplayView.prototype.heading = function (dir) {
    var kids = this.content.children, cueY = this.padTop + this.eng.pos, i, best = null;
    var isH = function (n) { return /^H[1-6]$/.test(n.tagName); };
    if (dir > 0) {
      for (i = 0; i < kids.length; i++) if (isH(kids[i]) && kids[i].offsetTop > cueY + 4) { best = kids[i]; break; }
    } else {
      for (i = kids.length - 1; i >= 0; i--) if (isH(kids[i]) && kids[i].offsetTop < cueY - 4) { best = kids[i]; break; }
    }
    if (best) this.eng.target = clamp(best.offsetTop - this.padTop, 0, this.eng.max);
    else if (dir < 0) this.eng.target = 0; // before the first heading: back to the top
    // after the last heading: stay put (a stray tap must not jump to the end of a live read)
  };

  /* top of an element inside #content, whatever it is nested in */
  function offsetIn(node, root) {
    var y = 0;
    while (node && node !== root) { y += node.offsetTop; node = node.offsetParent; }
    return y;
  }

  DisplayView.prototype.gotoHeading = function (i) {
    var hs = this.content.querySelectorAll('h1,h2,h3,h4,h5,h6');
    var h = hs[i];
    if (!h) return;
    this.cancelCountdown();
    this.eng.jog = 0;
    this.eng.target = clamp(offsetIn(h, this.content) - this.padTop, 0, this.eng.max);
  };

  DisplayView.prototype.onCmd = function (m) {
    var e = this.eng, self = this;
    switch (m.cmd) {
      case 'play': this.play(); break;
      case 'pause': this.pause(); break;
      case 'toggle': this.toggle(); break;
      case 'seek': this.cancelCountdown(); e.seekFraction(m.p); break;
      case 'jog':
        e.jog = m.v;
        clearTimeout(this.jogTimer);
        if (m.v !== 0) this.jogTimer = setTimeout(function () { e.jog = 0; }, 450); // remote vanished: stop
        break;
      case 'heading': this.heading(m.dir); break;
      case 'goto_heading': this.gotoHeading(m.index); break;
      case 'top': e.target = 0; break;
      case 'fullscreen': toggleFullscreen(); break;
      default: break;
    }
    void self;
  };

  DisplayView.prototype.openTab = function (tab) {
    this.toggleBar(false);
    this.togglePanel(true);
    this.panel.setTab(tab);
  };

  DisplayView.prototype.keyDown = function (e) {
    var k = keyName(e), alt = e.altKey, ctrl = e.ctrlKey || e.metaKey, handled = true;
    if (k === 'Escape') {
      if (document.getElementById('help')) showHelp();
      else if (this.panel.root.className.indexOf('open') >= 0) this.togglePanel(false);
      else if (this.dctl.className.indexOf('show') >= 0) this.toggleBar(false);
      else if (fsElement()) toggleFullscreen();
      else handled = false;
      if (handled) e.preventDefault();
      return;
    }
    if (ctrl && !isTyping(e) && (k === 'q' || k === 'Q')) { e.preventDefault(); quitApp(); return; }
    if (isTyping(e) || ctrl) return;
    if (document.getElementById('help')) { if (k === '?' || k === 'F1') { showHelp(); e.preventDefault(); } return; }
    var nth = /^[1-9]$/.test(k) ? parseInt(k, 10) - 1 : -1;
    if (k === ' ' || k === 'Spacebar' || ((k === 'k' || k === 'K') && !alt)) this.toggle();
    else if (k === 'ArrowUp' && !alt) { this.eng.target = null; this.eng.jog = -0.35; }
    else if (k === 'ArrowDown' && !alt) { this.eng.target = null; this.eng.jog = 0.35; }
    else if ((k === 'ArrowUp' && alt) || k === '+' || k === '=') adjust('font_size', 2);
    else if ((k === 'ArrowDown' && alt) || k === '-' || k === '_') adjust('font_size', -2);
    else if ((k === 'ArrowRight' && !alt) || k === '.' || k === '>') adjust('speed', 1);
    else if ((k === 'ArrowLeft' && !alt) || k === ',' || k === '<') adjust('speed', -1);
    else if (k === '[') adjust('width', -2);
    else if (k === ']') adjust('width', 2);
    else if (k === 'F11' || k === 'f' || k === 'F') toggleFullscreen();
    else if (k === 'e' || k === 'E') this.openTab('script');
    else if (k === 'o' || k === 'O') this.openTab('outline');
    else if (k === 'm' || k === 'M') { this.toggleBar(false); this.togglePanel(); }
    else if (k === 'c' || k === 'C') this.toggleBar();
    else if (k === 'Home' || k === 't' || k === 'T') this.eng.target = 0;
    else if (k === 'End') this.eng.target = this.eng.max;
    else if (k === 'r' || k === 'R') { this.pause(); this.eng.target = 0; }
    else if (k === 'PageDown') this.heading(1);
    else if (k === 'PageUp') this.heading(-1);
    else if (nth >= 0) this.gotoHeading(nth);
    else if (k === 'x' || k === 'X') toggleSwitch('flip_x');
    else if (k === 'y' || k === 'Y') toggleSwitch('flip_y');
    else if (k === 'b' || k === 'B') toggleSwitch('bold');
    else if (k === 'd' || k === 'D') toggleSwitch('focus');
    else if (k === '?' || k === 'F1') showHelp();
    else handled = false;
    if (handled) e.preventDefault();
  };

  DisplayView.prototype.keyUp = function (e) {
    var kk = keyName(e); if (kk === 'ArrowUp' || kk === 'ArrowDown') this.eng.jog = 0;
  };

  /* ------------------------------------------------------------ REMOTE view */
  function RemoteView(target) {
    var self = this;
    self.target = target;
    self.scrubbing = false;
    self.scrubHold = 0;
    self.jogTimer = null;
    self.lastSeek = 0;
    self.seekTimer = null;

    self.dot = el('span', { class: 'dot' });
    self.info = el('span', { class: 'grow muted' });
    self.playBtn = el('button', { id: 'playbtn', class: 'primary', text: '▶', 'aria-label': t('play'), onclick: function () { sendCmd({ cmd: 'toggle' }); } });
    self.scrub = el('input', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': t('scrub') });
    self.jog = el('input', { type: 'range', min: -100, max: 100, step: 1, value: 0, 'aria-label': t('jog') });
    self.eta = el('span', { class: 'eta' });

    self.panel = new Panel({
      tabs: ['controls', 'outline', 'script', 'link'], showShare: false,
      onGoto: function (i) { sendCmd({ cmd: 'goto_heading', index: i }); }
    });
    self.panel.root.className = 'full';

    var top = el('div', { id: 'rtop' }, [
      el('button', { text: '←', 'aria-label': t('back'), style: 'min-width:48px', onclick: function () { goHome(); } }),
      self.dot, self.info
    ]);
    var transport = el('div', { id: 'transport' }, [
      el('div', { class: 'row' }, [
        el('button', { text: '⏮', title: t('top'), 'aria-label': t('top'), onclick: function () { sendCmd({ cmd: 'top' }); } }),
        el('button', { text: '◀◀', title: t('prev'), 'aria-label': t('prev'), onclick: function () { sendCmd({ cmd: 'heading', dir: -1 }); } }),
        self.playBtn,
        el('button', { text: '▶▶', title: t('next'), 'aria-label': t('next'), onclick: function () { sendCmd({ cmd: 'heading', dir: 1 }); } }),
        el('button', { text: '\u26F6', title: t('fullscreen'), 'aria-label': t('fullscreen'), onclick: function () { sendCmd({ cmd: 'fullscreen' }); } })
      ]),
      el('div', { class: 'ctl' }, [el('div', { class: 'lab' }, el('span', { text: t('jog') })), self.jog]),
      el('div', { class: 'scrub-line' }, [el('div', { class: 'grow' }, self.scrub), self.eta])
    ]);
    self.root = el('div', { id: 'remote' }, [top, transport, self.panel.root]);
    app.appendChild(self.root);

    /* scrubbing: send eased seek targets while dragging, ~25/s */
    var scrubStart = function () { self.scrubbing = true; };
    var scrubEnd = function () { self.scrubHold = now() + 500; self.scrubbing = false; };
    ['mousedown', 'touchstart', 'pointerdown'].forEach(function (ev) { self.scrub.addEventListener(ev, scrubStart); });
    ['mouseup', 'touchend', 'pointerup', 'change'].forEach(function (ev) { self.scrub.addEventListener(ev, scrubEnd); });
    self.scrub.addEventListener('input', function () {
      self.scrubbing = true;
      var send = function () { self.lastSeek = now(); sendCmd({ cmd: 'seek', p: parseFloat(self.scrub.value) / 1000 }); };
      if (now() - self.lastSeek >= 40) { clearTimeout(self.seekTimer); send(); }
      else { clearTimeout(self.seekTimer); self.seekTimer = setTimeout(send, 40); }
    });

    /* jog: spring-loaded slider, resends while held, zero on release */
    var jogEnd = function () {
      self.jog.value = 0;
      clearInterval(self.jogTimer); self.jogTimer = null;
      sendCmd({ cmd: 'jog', v: 0 }); sendCmd({ cmd: 'jog', v: 0 });
    };
    self.jog.addEventListener('input', function () {
      var send = function () { sendCmd({ cmd: 'jog', v: parseFloat(self.jog.value) / 100 }); };
      send();
      if (!self.jogTimer) self.jogTimer = setInterval(send, 100);
    });
    ['mouseup', 'touchend', 'touchcancel', 'pointerup', 'pointercancel', 'blur', 'change'].forEach(function (ev) { self.jog.addEventListener(ev, jogEnd); });

    self.onKeyDown = function (e) { self.keyDown(e); };
    self.onKeyUp = function (e) { self.keyUp(e); };
    self.onBlur = function () {
      if (self.keyJogTimer) { clearInterval(self.keyJogTimer); self.keyJogTimer = null; sendCmd({ cmd: 'jog', v: 0 }); }
    };
    document.addEventListener('keydown', self.onKeyDown);
    document.addEventListener('keyup', self.onKeyUp);
    window.addEventListener('blur', self.onBlur);
    self.panel.setTab('controls');
    self.onPeers();
    self.onPos();
  }

  function sendCmd(c) { if (link) link.send({ t: 'cmd', cmd: c.cmd, p: c.p, v: c.v, dir: c.dir, index: c.index }); }
  // JSON.stringify drops undefined fields, so unused ones vanish on the wire.

  RemoteView.prototype.destroy = function () {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    clearInterval(this.jogTimer);
    clearInterval(this.keyJogTimer);
    this.keyJogTimer = null;
    sendCmd({ cmd: 'jog', v: 0 });
  };

  RemoteView.prototype.onStatus = function (ok) {
    this.dot.className = 'dot ' + (ok ? 'on' : 'err');
    this.onPeers();
  };

  RemoteView.prototype.onPeers = function () {
    var txt = this.target.host;
    if (!S.connected) txt += ' · ' + t('offline');
    else if (!S.displays) txt += ' · ' + t('no_display');
    else txt += ' · ' + S.displays + ' ' + t('displays') + ', ' + S.remotes + ' ' + t('remotes');
    this.info.textContent = txt;
  };

  RemoteView.prototype.onPos = function () {
    this.playBtn.textContent = S.playing ? '⏸' : '▶';
    this.playBtn.setAttribute('aria-label', S.playing ? t('pause') : t('play'));
    if (!this.scrubbing && now() > this.scrubHold) this.scrub.value = Math.round(S.pos * 1000);
    this.eta.textContent = (S.playing && S.eta !== null) ? fmtTime(S.eta) + ' ' + t('left') : '';
  };

  RemoteView.prototype.onState = function (htmlChanged) {
    this.panel.refresh();
    this.panel.onSessionText();
    if (htmlChanged) { this.scrub.value = 0; }
  };

  RemoteView.prototype.onSettings = function () {};
  RemoteView.prototype.relayout = function () {};

  RemoteView.prototype.keyDown = function (e) {
    var k = keyName(e), alt = e.altKey, ctrl = e.ctrlKey || e.metaKey, handled = true;
    if (k === 'Escape') {
      if (document.getElementById('help')) { showHelp(); e.preventDefault(); }
      return;
    }
    if (ctrl && !isTyping(e) && (k === 'q' || k === 'Q')) { e.preventDefault(); quitApp(); return; }
    if (isTyping(e) || ctrl) return;
    if (document.getElementById('help')) { if (k === '?' || k === 'F1') { showHelp(); e.preventDefault(); } return; }
    var nth = /^[1-9]$/.test(k) ? parseInt(k, 10) - 1 : -1;
    if (k === ' ' || k === 'Spacebar' || ((k === 'k' || k === 'K') && !alt)) { if (!e.repeat) sendCmd({ cmd: 'toggle' }); }
    else if (k === 'ArrowUp' && !alt) { if (!e.repeat) sendCmd({ cmd: 'jog', v: -0.35 }); this.keyJog(-0.35); }
    else if (k === 'ArrowDown' && !alt) { if (!e.repeat) sendCmd({ cmd: 'jog', v: 0.35 }); this.keyJog(0.35); }
    else if ((k === 'ArrowUp' && alt) || k === '+' || k === '=') adjust('font_size', 2);
    else if ((k === 'ArrowDown' && alt) || k === '-' || k === '_') adjust('font_size', -2);
    else if ((k === 'ArrowRight' && !alt) || k === '.' || k === '>') adjust('speed', 1);
    else if ((k === 'ArrowLeft' && !alt) || k === ',' || k === '<') adjust('speed', -1);
    else if (k === '[') adjust('width', -2);
    else if (k === ']') adjust('width', 2);
    else if ((k === 'f' || k === 'F') && alt) toggleFullscreen();          // this window
    else if (k === 'F11') toggleFullscreen();                              // this window
    else if (k === 'f' || k === 'F') sendCmd({ cmd: 'fullscreen' });       // the display
    else if (k === 'e' || k === 'E') this.panel.setTab('script');
    else if (k === 'o' || k === 'O') this.panel.setTab('outline');
    else if (k === 'Home' || k === 't' || k === 'T') sendCmd({ cmd: 'top' });
    else if (k === 'End') sendCmd({ cmd: 'seek', p: 1 });
    else if (k === 'r' || k === 'R') { sendCmd({ cmd: 'pause' }); sendCmd({ cmd: 'top' }); }
    else if (k === 'PageDown') sendCmd({ cmd: 'heading', dir: 1 });
    else if (k === 'PageUp') sendCmd({ cmd: 'heading', dir: -1 });
    else if (nth >= 0) sendCmd({ cmd: 'goto_heading', index: nth });
    else if (k === 'x' || k === 'X') toggleSwitch('flip_x');
    else if (k === 'y' || k === 'Y') toggleSwitch('flip_y');
    else if (k === 'b' || k === 'B') toggleSwitch('bold');
    else if (k === 'd' || k === 'D') toggleSwitch('focus');
    else if (k === '?' || k === 'F1') showHelp();
    else handled = false;
    if (handled) e.preventDefault();
  };

  RemoteView.prototype.keyJog = function (v) {
    var self = this;
    if (self.keyJogTimer) return;
    self.keyJogTimer = setInterval(function () { sendCmd({ cmd: 'jog', v: v }); }, 100);
  };

  RemoteView.prototype.keyUp = function (e) {
    var kk = keyName(e);
    if (kk === 'ArrowUp' || kk === 'ArrowDown') {
      clearInterval(this.keyJogTimer); this.keyJogTimer = null;
      sendCmd({ cmd: 'jog', v: 0 }); sendCmd({ cmd: 'jog', v: 0 });
    }
  };

  /* expose a tiny surface for tests */
  window.__cueme = {
    state: S, setFs: setFsClass, setTheme: setTheme, loadTheme: loadTheme, adjust: adjust, goHome: goHome, canBack: function () { return !atHome; },
    decodeCanvas: decodeCanvas, parseScanned: parseScanned, canScan: canScan
  };

  /* ------------------------------------------------------------ boot */
  T0.apply(loadTheme());
  document.documentElement.dir = I.lang() === 'ar' ? 'rtl' : 'ltr';
  goHome();
})();
