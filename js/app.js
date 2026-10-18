/* ==========================================================================
   SPOOLO · app — 取景 / 快门 / 冲印 / 影集
   ========================================================================== */
(function () {
  'use strict';

  var S = window.SPOOLO;
  var FILMS = S.FILMS;
  var Store = S.Store;
  var FRAMES_PER_ROLL = 36;
  var PREFS_KEY = 'spoolo.prefs.v1';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var fmtEv = function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1); };

  var DEMOS = [
    { src: 'assets/samples/negative-portrait.jpg', label: '窗边人像' },
    { src: 'assets/samples/negative-night.jpg', label: '雨夜街头' },
    { src: 'assets/samples/negative-coast.jpg', label: '黄昏海岸' }
  ];

  /* ---------- 状态 ---------- */
  var state = {
    filmIndex: 0,
    ev: 0,                    /* 以 1/3 档为单位 */
    facing: 'environment',
    stream: null,
    live: false,
    mirror: false,
    source: 'none',           /* camera | demo | file | none */
    demoIndex: 0,
    demoChoice: false,        /* 用户主动选了示范底片（不再自动抢镜头） */
    camErr: null,             /* 最近一次镜头启动失败的错误名 */
    busy: false,
    dirty: true,
    running: true,
    previewScale: 0.32,
    shots: [],
    urls: [],
    current: null,            /* 灯箱中的照片 */
    pendingUndo: null
  };

  var prefs = loadPrefs();
  prefs.timer = prefs.timer || 0;
  state.filmIndex = filmIndexOf(prefs.film);
  state.ev = prefs.ev || 0;

  function loadPrefs() {
    var d = { film: 'PT-400', ev: 0, grid: true, date: false, sound: true, timer: 0, roll: 1, frame: 1 };
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        for (var k in d) if (p[k] !== undefined) d[k] = p[k];
      }
    } catch (e) { /* 忽略 */ }
    return d;
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* 忽略 */ }
  }
  function filmIndexOf(code) {
    for (var i = 0; i < FILMS.length; i++) if (FILMS[i].code === code) return i;
    return 0;
  }
  function currentFilm() { return FILMS[state.filmIndex]; }

  /* ---------- 元素 ---------- */
  var el = {
    video: $('#cam'),
    preview: $('#preview'),
    still: $('#still'),
    frameBox: $('#frameBox'),
    canister: $('#canister'),
    canSwatch: $('#canSwatch'),
    canCode: $('#canCode'),
    canName: $('#canName'),
    canMeta: $('#canMeta'),
    canBars: $('#canBars'),
    rollKnob: $('#rollKnob'),
    counterDigits: $('#counterDigits'),
    rollNo: $('#rollNo'),
    roCode: $('#roCode'),
    roIso: $('#roIso'),
    roEv: $('#roEv'),
    roLeft: $('#roLeft'),
    evValue: $('#evValue'),
    timerVal: $('#timerVal'),
    notice: $('#vfNotice'),
    noticeText: $('#vfNoticeText'),
    countdown: $('#countdown'),
    lab: $('#lab'),
    scrim: $('#scrim'),
    frames: $('#frames'),
    filmList: $('#filmList'),
    demoList: $('#demoList'),
    negatives: $('#negatives'),
    albumStat: $('#albumStat'),
    lightbox: $('#lightbox'),
    lbImage: $('#lbImage'),
    lbCode: $('#lbCode'),
    lbName: $('#lbName'),
    lbMeta: $('#lbMeta'),
    processing: $('#processing'),
    procBar: $('#procBar'),
    procTitle: $('#procTitle'),
    procNote: $('#procNote'),
    toast: $('#toast'),
    toastText: $('#toastText'),
    toastUndo: $('#toastUndo'),
    fileInput: $('#fileInput'),
    peekImg: $('#peekImg'),
    peekEmpty: $('#peekEmpty'),
    shutter: $('#shutter')
  };

  /* ======================================================================
     取景
     ====================================================================== */
  var ctx = el.preview.getContext('2d', { willReadFrequently: true });
  var pw = 320, ph = 213;

  function layoutPreview() {
    var r = el.frameBox.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var target = 240000 * state.previewScale * 2;
    var scale = Math.min(1.05, Math.sqrt(target / (r.width * r.height * dpr * dpr)));
    pw = Math.max(200, Math.round(r.width * dpr * scale));
    ph = Math.max(120, Math.round(pw * r.height / r.width));  /* 跟随取景窗实际比例，竖屏不被拉伸 */
    if (el.preview.width !== pw || el.preview.height !== ph) {
      el.preview.width = pw;
      el.preview.height = ph;
    }
    state.dirty = true;
    /* 改画布尺寸会把画布清空，静态图源立刻补画一张，不等 rAF */
    if (state.source !== 'camera') drawPreview();
  }

  function activeSource() {
    if (state.source === 'camera') return el.video;
    if (state.source === 'demo' || state.source === 'file') return el.still;
    return null;
  }

  function sourceSize(src) {
    return {
      w: src.videoWidth || src.naturalWidth || src.width || 0,
      h: src.videoHeight || src.naturalHeight || src.height || 0
    };
  }

  /* 3:2 取景裁切：所见即所得 */
  function coverRect(sw, sh, outRatio) {
    var ratio = outRatio || 1.5;
    var w = sw, h = sw / ratio;
    if (h > sh) { h = sh; w = sh * ratio; }
    return { x: (sw - w) / 2, y: (sh - h) / 2, w: w, h: h };
  }

  function drawPreview(now) {
    var src = activeSource();
    if (!src) return;
    var size = sourceSize(src);
    if (!size.w || !size.h) return;
    var crop = coverRect(size.w, size.h, pw / ph);
    ctx.save();
    if (state.mirror) { ctx.translate(pw, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, pw, ph);
    ctx.restore();

    var d = ctx.getImageData(0, 0, pw, ph);
    S.render(d.data, pw, ph, currentFilm(), {
      ev: state.ev / 3, halation: false, grain: false, vignette: false, leak: false, seed: 11
    });
    ctx.putImageData(d, 0, 0);
  }

  /* 非实时源（示范底片 / 导入）：换卷或调曝光时立即重冲，不等 rAF。
     手机在省电等场景会冻结 requestAnimationFrame，仅靠 loop 会显得「不实时」 */
  function refreshPreview() {
    state.dirty = true;
    if (state.source !== 'camera') drawPreview();
  }

  var lastFrame = 0, frameTimes = [], lastAdapt = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!state.running) return;
    if (now - lastFrame < 1000 / 26) return;
    lastFrame = now;

    var liveSrc = state.source === 'camera';
    if (!liveSrc && !state.dirty) return;
    if (!liveSrc) state.dirty = false;

    var t0 = performance.now();
    drawPreview(now);
    var dt = performance.now() - t0;

    frameTimes.push(dt);
    if (frameTimes.length > 12) frameTimes.shift();
    if (liveSrc && now - lastAdapt > 900 && frameTimes.length === 12) {
      lastAdapt = now;
      var avg = frameTimes.reduce(function (a, b) { return a + b; }, 0) / frameTimes.length;
      if (avg > 26 && state.previewScale > 0.24) { state.previewScale -= 0.12; layoutPreview(); }
      else if (avg < 10 && state.previewScale < 0.9) { state.previewScale += 0.1; layoutPreview(); }
      frameTimes.length = 0;
    }
  }

  /* ---------- 镜头 ---------- */
  var camStart = null;   /* 同一时刻只允许一次镜头启动请求（手势重试与「重试」按钮可能同时触发） */

  function startCamera(facing) {
    if (camStart) return camStart;
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      /* 手机浏览器只在安全上下文（HTTPS / localhost）放行镜头 */
      useDemo(state.demoIndex, window.isSecureContext ? '浏览器不支持镜头调用' : '手机只允许 HTTPS 调用镜头');
      return Promise.resolve(false);
    }
    camStart = navigator.mediaDevices.getUserMedia({
      audio: false,
      /* 要 4:3（多数手机 CMOS 的原生比例），竖屏取景框就是它转 90°，几乎不用裁切 */
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }
    }).then(function (stream) {
      state.stream = stream;
      state.facing = facing;
      state.mirror = facing === 'user';
      state.source = 'camera';
      state.live = true;
      state.camErr = null;
      state.demoChoice = false;
      el.video.srcObject = stream;
      el.video.style.display = 'block';
      el.still.hidden = true;
      setPressed('flip', state.facing === 'user');
      hideNotice();
      layoutPreview();
      startVideo();
      /* 拿到流就是连上了。画面出得慢不能反过来判定成「未连接」 */
      return true;
    }).catch(function (err) {
      state.camErr = err && err.name ? err.name : 'UnknownError';
      var why = err && err.name === 'NotAllowedError' ? '镜头权限被拒绝'
        : err && err.name === 'NotFoundError' ? '没有找到摄像头'
        : err && err.name === 'NotReadableError' ? '镜头被其他应用占用'
        : '无法访问镜头';
      useDemo(state.demoIndex, why);
      return false;
    }).then(function (v) { camStart = null; return v; },
            function (e) { camStart = null; throw e; });
    return camStart;
  }

  /* 连上镜头后画面可能还要缓一会儿（iPhone 上尤其明显）。出画了就把提示收干净；
     迟迟不出画只给一句准确的说明，绝不退回示范底片——那正是「明明连上了却提示未连接」的来源 */
  var videoTimer = null;
  function startVideo() {
    var v = el.video;
    clearTimeout(videoTimer);
    try {
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* 自动播放被拦下也无妨 */ });
    } catch (e) { /* 个别内核对 play() 同步抛错，忽略 */ }

    var painted = function () {
      if (state.source !== 'camera') return true;
      if (v.videoWidth > 0) { clearTimeout(videoTimer); hideNotice(); return true; }
      return false;
    };
    var onReady = function () {
      if (painted()) {
        v.removeEventListener('loadedmetadata', onReady);
        v.removeEventListener('playing', onReady);
      }
    };
    v.addEventListener('loadedmetadata', onReady);
    v.addEventListener('playing', onReady);
    videoTimer = setTimeout(function () {
      if (painted()) return;
      showNotice('镜头已连接，画面还在缓冲…一直黑屏就点「重试」或切一下前后摄');
    }, 6000);
  }

  /* 手机浏览器（尤其 iOS Safari）要求摄像头调用发生在「用户手势」里，页面加载时的自动启动
     会被静默拒绝。各家的错误名还不统一（NotAllowedError / NotFoundError / SecurityError 都见
     过），所以任何失败都保留监听：用户一碰页面就立刻重试，最多补试 3 次，连上或改用示范底片
     后自动摘除 */
  function armCameraRetry() {
    if (state.demoChoice) return;
    var left = 3;
    var detach = function () {
      document.removeEventListener('pointerdown', onGesture);
      document.removeEventListener('keydown', onGesture);
    };
    var onGesture = function () {
      if (state.demoChoice || state.source === 'camera') { detach(); return; }
      if (state.busy) return;
      if (left-- <= 0) { detach(); return; }
      startCamera(state.facing).then(function (ok) { if (ok) detach(); });
    };
    document.addEventListener('pointerdown', onGesture);
    document.addEventListener('keydown', onGesture);
  }

  function stopCamera() {
    clearTimeout(videoTimer);
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { t.stop(); });
      state.stream = null;
      if (state.source === 'camera') state.source = 'none';
    }
    state.live = false;
  }

  function useDemo(index, why) {
    stopCamera();
    var d = DEMOS[index % DEMOS.length];
    state.demoIndex = index % DEMOS.length;
    state.mirror = false;
    loadSource(d.src, d.label, why || '示范底片');
  }

  function loadSource(src, label, why) {
    el.video.style.display = 'none';
    el.still.hidden = true;   /* 只当图源用，画面始终由画布输出 */
    el.still.onload = function () {
      /* 示范底片图还没下载完，镜头却已经先连上了：不能反过来把它顶掉 */
      if (state.source === 'camera') return;
      state.source = 'demo';
      state.dirty = true;
      if (!why) hideNotice();
      showNotice((why ? why + ' · ' : '') + '示范底片「' + label + '」');
      layoutPreview();
    };
    el.still.onerror = function () { state.source = 'none'; };
    el.still.src = src;
  }

  function showNotice(text) {
    el.noticeText.textContent = text;
    el.notice.hidden = false;
  }
  function hideNotice() { el.notice.hidden = true; }

  /* ======================================================================
     影调取景器变量（颗粒 / 暗角 / 漏光）
     ====================================================================== */
  function applyFilmVars(f) {
    var st = el.frameBox.style;
    st.setProperty('--vig', f.vignette.toFixed(2));
    st.setProperty('--leak', (f.leak || 0).toFixed(2));
    st.setProperty('--grain', Math.min(0.16, 0.012 + f.grain.amount * 0.85).toFixed(3));
  }

  /* ======================================================================
     胶卷切换
     ====================================================================== */
  function setFilm(index, opts) {
    var n = FILMS.length;
    var i = ((index % n) + n) % n;
    var changed = i !== state.filmIndex;
    state.filmIndex = i;
    var f = currentFilm();

    prefs.film = f.code;
    savePrefs();

    el.canCode.textContent = f.code;
    el.canName.textContent = f.name;
    el.canMeta.textContent = f.process + ' · ISO ' + f.iso;
    el.canSwatch.style.setProperty('--tone', f.tone);
    el.roCode.textContent = f.code;
    el.roIso.textContent = f.iso;
    el.rollKnob.setAttribute('aria-valuenow', i + 1);
    el.rollKnob.setAttribute('aria-valuetext', f.code + ' ' + f.name);
    el.rollKnob.style.setProperty('--rot', (i * 36) + 'deg');
    applyFilmVars(f);
    refreshPreview();

    var m = S.meters(f);
    el.canBars.innerHTML = meter('反差', m.contrast) + meter('颗粒', m.grain);

    $$('.film-card', el.filmList).forEach(function (li, idx) {
      var on = idx === i;
      li.classList.toggle('is-active', on);
      var b = $('.film-load', li);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    if (changed && !(opts && opts.silent)) {
      el.canister.classList.remove('swapping');
      void el.canister.offsetWidth;
      el.canister.classList.add('swapping');
      if (state.live || state.source !== 'none') Sound.play('tick');
    }
  }

  function meter(label, v) {
    return '<span class="meter"><b>' + label + '</b><i style="--v:' + v + '"></i></span>';
  }

  function renderFilmList() {
    var html = '';
    FILMS.forEach(function (f, i) {
      var m = S.meters(f);
      html +=
        '<li class="film-card' + (i === state.filmIndex ? ' is-active' : '') + '" data-index="' + i + '">' +
        '<button class="film-load" type="button" aria-pressed="' + (i === state.filmIndex) + '">' +
        '<span class="fc-swatch" style="--tone:' + f.tone + '"></span>' +
        '<span class="fc-head"><span class="fc-code">' + f.code + '</span><span class="fc-badge">使用中</span></span>' +
        '<span class="fc-name">' + f.name + '</span>' +
        '<span class="fc-en">' + f.en + ' · ' + f.process + ' · ISO ' + f.iso + '</span>' +
        '<span class="fc-bars">' +
        meter('反差', m.contrast) + meter('饱和', m.sat) + meter('颗粒', m.grain) + meter('光晕', m.halo) +
        '</span>' +
        '<span class="fc-note">' + f.note + '</span>' +
        '</button></li>';
    });
    el.filmList.innerHTML = html;
    $('#filmCount').textContent = FILMS.length;
  }

  /* ======================================================================
     快门
     ====================================================================== */
  function shoot() {
    if (state.busy) return;
    if (!activeSource()) {
      toast('还没有画面：先允许镜头，或导入一张底片');
      return;
    }
    if (prefs.timer > 0) runCountdown(prefs.timer, captureShot);
    else captureShot();
  }

  function runCountdown(sec, done) {
    state.busy = true;
    var n = sec;
    el.countdown.hidden = false;
    el.countdown.textContent = n;
    Sound.play('tick');
    var iv = setInterval(function () {
      n--;
      if (n <= 0) {
        clearInterval(iv);
        el.countdown.hidden = true;
        state.busy = false;
        done();
      } else {
        el.countdown.textContent = n;
        Sound.play('tick');
      }
    }, 1000);
  }

  function fireShutter() {
    el.frameBox.classList.remove('firing');
    void el.frameBox.offsetWidth;
    el.frameBox.classList.add('firing');
    Sound.play('shutter');
    setTimeout(function () { el.frameBox.classList.remove('firing'); }, 320);
  }

  function captureShot() {
    if (state.busy) return;
    state.busy = true;
    var film = currentFilm();
    var shot;

    fireShutter();
    try {
      shot = grabFrame();
    } catch (e) {
      state.busy = false;
      toast('这一帧没能拍下来，请重试');
      return;
    }

    var evStops = state.ev / 3;
    var seed = (Math.random() * 100000) | 0;

    openProcessing(film, function () {
      develop(shot.canvas, shot.W, shot.H, film, {
        ev: evStops, halation: true, grain: true, vignette: true, leak: true,
        seed: seed, dateStamp: prefs.date
      });
      return toBlob(shot.canvas, 0.92).then(function (blob) {
        return makeThumb(shot.canvas, 240).then(function (thumb) {
          var frame = {
            id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 6),
            roll: prefs.roll,
            frameNo: prefs.frame,
            code: film.code,
            name: film.name,
            en: film.en,
            iso: film.iso,
            ev: evStops,
            w: shot.W,
            h: shot.H,
            date: prefs.date,
            ts: Date.now(),
            blob: blob,
            thumb: thumb
          };
          return Store.add(frame).then(function () { return frame; });
        });
      });
    }).then(function (frame) {
      state.busy = false;
      if (!frame) return;
      toast('已冲印 ' + frame.code + ' · 第 ' + pad2(frame.frameNo) + ' 张');
      advanceFrame();
      refreshAlbum();
    }).catch(function () {
      state.busy = false;
      toast('冲印失败，请再试一次');
    });
  }

  /* 从当前源裁出与取景窗同比例的一帧 */
  function grabFrame() {
    var src = activeSource();
    var size = sourceSize(src);
    var ratio = pw / ph;   /* 取景窗实际长宽比：手机竖屏拍出来的构图与所见的完全一致 */
    var crop = coverRect(size.w, size.h, ratio);
    var W, H;
    if (ratio >= 1) {
      W = Math.min(1920, Math.round(crop.w));
      H = Math.max(1, Math.round(W / ratio));
    } else {
      H = Math.min(1920, Math.round(crop.h));
      W = Math.max(1, Math.round(H * ratio));
    }
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var cc = c.getContext('2d');
    cc.imageSmoothingQuality = 'high';
    if (state.mirror) { cc.translate(W, 0); cc.scale(-1, 1); }
    cc.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
    return { canvas: c, W: W, H: H, ctx: cc };
  }

  function develop(canvas, W, H, film, opts) {
    var cc = canvas.getContext('2d');
    var d = cc.getImageData(0, 0, W, H);
    S.render(d.data, W, H, film, opts);
    cc.putImageData(d, 0, 0);
    if (opts && opts.dateStamp) stampDate(cc, W, H);
    return canvas;
  }

  /* 日期打印：老式小型机的橙红 LED 印记 */
  function stampDate(cc, W, H) {
    var d = new Date();
    var txt = String(d.getFullYear()).slice(2) + ' ' + pad2(d.getMonth() + 1) + ' ' + pad2(d.getDate());
    var size = Math.max(14, Math.round(W * 0.03));
    cc.save();
    cc.font = '600 ' + size + 'px "IBM Plex Mono", Consolas, monospace';
    cc.textAlign = 'right';
    cc.textBaseline = 'alphabetic';
    cc.shadowColor = 'rgba(255,140,30,.95)';
    cc.shadowBlur = size * 0.8;
    cc.fillStyle = 'rgba(255,158,52,.95)';
    cc.fillText(txt, W - size * 0.8, H - size * 0.7);
    cc.restore();
  }

  function toBlob(canvas, q) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (b) { resolve(b); }, 'image/jpeg', q);
    });
  }

  function makeThumb(canvas, w) {
    var c = document.createElement('canvas');
    c.width = w;
    /* 跟随成片实际比例：竖幅底片的缩略图不能再按 3:2 横构图裁 */
    c.height = Math.max(1, Math.round(w * canvas.height / canvas.width));
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return toBlob(c, 0.72);
  }

  function advanceFrame() {
    prefs.frame += 1;
    if (prefs.frame > FRAMES_PER_ROLL) {
      rewind('本卷已拍完 · 回卷换新');
      return;
    }
    savePrefs();
    updateCounter();
  }

  function rewind(msg) {
    var knob = $('#rewind');
    knob.classList.remove('spinning');
    void knob.offsetWidth;
    knob.classList.add('spinning');
    Sound.play('rewind');
    if (msg) toast(msg);
    el.counterDigits.textContent = '--';
    setTimeout(function () {
      knob.classList.remove('spinning');
      prefs.roll += 1;
      prefs.frame = 1;
      savePrefs();
      updateCounter();
      if (msg) toast('已装上新卷 · ROLL ' + pad2(prefs.roll));
    }, 1850);
  }

  function updateCounter() {
    el.counterDigits.textContent = pad2(prefs.frame);
    el.rollNo.textContent = pad2(prefs.roll);
    el.roLeft.textContent = Math.max(0, FRAMES_PER_ROLL - prefs.frame + 1);
    var left = $$('.edge-code');
    if (left[0]) left[0].textContent = 'SPOOLO 135 · ' + currentFilm().iso + ' · ' + pad2(prefs.frame);
    if (left[1]) left[1].textContent = pad2(prefs.frame) + ' → SPOOLO ' + currentFilm().iso;
  }

  /* ======================================================================
     冲印遮罩
     ====================================================================== */
  function openProcessing(film, work) {
    var bar = el.procBar;
    var steps = $$('.proc-steps li');
    var dur = 1250, t0 = performance.now();
    var result = null, error = null, settled = false;

    el.procTitle.textContent = (film.process === 'B&W' ? '黑白显影中' : film.process + ' 冲印中');
    el.procNote.textContent = '按「' + film.code + '」的乳剂曲线还原色彩…';
    el.processing.hidden = false;
    bar.style.width = '0';
    steps.forEach(function (s) { s.className = ''; });

    var p = Promise.resolve()
      .then(work)
      .then(function (v) { result = v; settled = true; })
      .catch(function (e) { error = e; settled = true; });

    return new Promise(function (resolve, reject) {
      function tick() {
        var t = Math.min(1, (performance.now() - t0) / dur);
        bar.style.width = (t * 100) + '%';
        var si = Math.min(3, Math.floor(t * 4));
        steps.forEach(function (s, i) {
          s.className = i < si ? 'done' : i === si ? 'on' : '';
        });
        if (t < 1) { requestAnimationFrame(tick); return; }
        var wait = function () {
          if (!settled) { setTimeout(wait, 60); return; }
          steps.forEach(function (s) { s.className = 'done'; });
          el.procNote.textContent = '冲洗完成，正在挂起晾干';
          setTimeout(function () {
            el.processing.hidden = true;
            bar.style.width = '0';
            if (error) reject(error); else resolve(result);
          }, 340);
        };
        wait();
      }
      requestAnimationFrame(tick);
    });
  }

  /* ======================================================================
     影集
     ====================================================================== */
  function refreshAlbum() {
    return Store.all().then(function (rows) {
      state.shots = rows;
      renderFrames(rows);
      var badge = String(rows.length);
      $('#albumBadge').textContent = badge;
      el.negatives.hidden = rows.length > 0;
      if (!rows.length) {
        el.albumStat.textContent = '还没有冲洗出照片';
      } else {
        var rolls = 1 + Math.max.apply(null, rows.map(function (r) { return r.roll; })) - Math.min.apply(null, rows.map(function (r) { return r.roll; }));
        el.albumStat.textContent = '共 ' + rows.length + ' 张 · ' + rolls + ' 卷';
      }
      if (rows.length) {
        setPeek(rows[0]);
      } else {
        el.peekImg.hidden = true;
        el.peekEmpty.hidden = false;
      }
    });
  }

  function releaseUrls() {
    state.urls.forEach(function (u) { URL.revokeObjectURL(u); });
    state.urls = [];
  }

  function url(blob) {
    var u = URL.createObjectURL(blob);
    state.urls.push(u);
    return u;
  }

  function renderFrames(rows) {
    releaseUrls();
    var html = '';
    rows.forEach(function (r) {
      html +=
        '<li class="shot" data-id="' + r.id + '">' +
        '<button class="shot-open" type="button" aria-label="查看第 ' + pad2(r.frameNo) + ' 张，' + r.code + '">' +
        '<span class="shot-film">' +
        '<span class="shot-perf top" aria-hidden="true"></span>' +
        '<img src="' + url(r.thumb) + '" alt="" loading="lazy" style="aspect-ratio:' + r.w + '/' + r.h + '">' +
        '<span class="shot-perf bottom" aria-hidden="true"></span>' +
        '</span>' +
        '<span class="shot-meta"><b>' + pad2(r.frameNo) + '</b><span>' + r.code + '</span>' +
        '<span>ROLL ' + pad2(r.roll) + '</span></span>' +
        '</button></li>';
    });
    el.frames.innerHTML = html;
  }

  function setPeek(row) {
    el.peekImg.src = url(row.thumb);
    el.peekImg.hidden = false;
    el.peekEmpty.hidden = true;
  }

  function openLightbox(id) {
    var row = null;
    for (var i = 0; i < state.shots.length; i++) if (state.shots[i].id === id) row = state.shots[i];
    if (!row) return;
    state.current = row;
    el.lbImage.src = url(row.blob);
    el.lbCode.textContent = row.code;
    el.lbName.textContent = row.name + ' · ' + row.en;
    var d = new Date(row.ts);
    el.lbMeta.innerHTML =
      '<dt>卷 / 张</dt><dd>ROLL ' + pad2(row.roll) + ' · #' + pad2(row.frameNo) + '</dd>' +
      '<dt>乳剂</dt><dd>' + row.code + ' · ISO ' + row.iso + '</dd>' +
      '<dt>曝光补偿</dt><dd>' + fmtEv(row.ev) + ' EV</dd>' +
      '<dt>冲印时间</dt><dd>' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + '</dd>' +
      '<dt>尺寸</dt><dd>' + row.w + ' × ' + row.h + '</dd>' +
      '<dt>日期打印</dt><dd>' + (row.date ? '已开启' : '未开启') + '</dd>';
    el.lightbox.showModal();
  }

  function saveCurrent() {
    var row = state.current;
    if (!row) return;
    var a = document.createElement('a');
    a.href = url(row.blob);
    a.download = 'SPOOLO_' + row.code + '_ROLL' + pad2(row.roll) + '_' + pad2(row.frameNo) + '.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('已保存到本地：' + row.code + ' #' + pad2(row.frameNo));
  }

  function deleteCurrent() {
    var row = state.current;
    if (!row) return;
    Store.remove(row.id).then(function () {
      el.lightbox.close();
      refreshAlbum();
      toast('已删除 ' + row.code + ' #' + pad2(row.frameNo), '撤销', function () {
        Store.add(row).then(refreshAlbum);
      });
    });
  }

  /* ---------- 导入 ---------- */
  function pickFile() {
    el.fileInput.value = '';
    el.fileInput.click();
  }

  function onFile(file) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) {
      toast('请选择一张图片');
      return;
    }
    var r = new FileReader();
    r.onload = function () {
      loadSource(r.result, file.name || '本地底片', null);
      state.dirty = true;
      closeLab();
      toast('已装入本地底片 · 按下快门即可冲洗');
    };
    r.readAsDataURL(file);
  }

  /* ======================================================================
     暗房抽屉 / 标签页
     ====================================================================== */
  var isMobile = function () { return window.matchMedia('(max-width: 999px)').matches; };

  function openLab(tab) {
    if (tab) setTab(tab);
    if (!isMobile()) return;
    el.lab.classList.add('open');
    el.scrim.hidden = false;
    requestAnimationFrame(function () { el.scrim.classList.add('show'); });
    document.documentElement.style.overflow = 'hidden';
  }

  function closeLab() {
    if (!el.lab.classList.contains('open')) return;
    el.lab.classList.remove('open');
    el.scrim.classList.remove('show');
    document.documentElement.style.overflow = '';
    setTimeout(function () {
      if (!el.lab.classList.contains('open')) el.scrim.hidden = true;
    }, 340);
    refreshPreview();
  }

  function setTab(tab) {
    var films = tab !== 'album';
    $('#tabFilms').setAttribute('aria-selected', films ? 'true' : 'false');
    $('#tabAlbum').setAttribute('aria-selected', films ? 'false' : 'true');
    $('#panelFilms').hidden = !films;
    $('#panelAlbum').hidden = films;
  }

  /* ======================================================================
     Toast
     ====================================================================== */
  var toastTimer = null, toastAction = null;
  function toast(msg, actionLabel, action) {
    el.toastText.textContent = msg;
    toastAction = action || null;
    if (actionLabel && action) {
      el.toastUndo.hidden = false;
      el.toastUndo.textContent = actionLabel;
    } else {
      el.toastUndo.hidden = true;
    }
    el.toast.hidden = false;
    /* 显示与淡入分两帧：.toast 现在由 [hidden] 控制 display，先渲染出来再加 .show 才看得到过渡 */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.toast.classList.add('show'); });
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove('show');
      toastAction = null;
      setTimeout(function () { el.toast.hidden = true; }, 240);
    }, actionLabel ? 6000 : 2600);
  }

  /* ======================================================================
     声音（合成，无音频文件）
     ====================================================================== */
  var Sound = {
    ctx: null,
    noiseBuf: null,
    ensure: function () {
      if (!prefs.sound) return null;
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { this.ctx = new AC(); } catch (e) { return null; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    noise: function () {
      if (this.noiseBuf) return this.noiseBuf;
      var ctx = this.ctx, len = Math.floor(ctx.sampleRate * 1.6);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      return buf;
    },
    tone: function (at, freq, dur, gain, type, slideTo) {
      var ctx = this.ctx;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, at);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g).connect(ctx.destination);
      o.start(at);
      o.stop(at + dur + 0.02);
    },
    burst: function (at, dur, gain, freq, q) {
      var ctx = this.ctx;
      var s = ctx.createBufferSource();
      s.buffer = this.noise();
      s.playbackRate.value = 0.85;
      var f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q || 1.2;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      s.connect(f).connect(g).connect(ctx.destination);
      s.start(at);
      s.stop(at + dur + 0.02);
    },
    play: function (kind) {
      var ctx = this.ensure();
      if (!ctx) return;
      var t = ctx.currentTime + 0.01;
      if (kind === 'shutter') {
        this.burst(t, 0.09, 0.34, 2600, 1.1);
        this.burst(t + 0.052, 0.07, 0.26, 1500, 1.4);
        this.tone(t, 88, 0.17, 0.22, 'sine', 62);
        this.burst(t + 0.03, 0.05, 0.10, 5200, 0.9);
      } else if (kind === 'tick') {
        this.tone(t, 1250, 0.035, 0.055, 'square', 900);
      } else if (kind === 'rewind') {
        this.tone(t, 74, 1.5, 0.10, 'sawtooth', 58);
        this.burst(t + 0.05, 1.4, 0.07, 900, 0.7);
      }
    }
  };

  /* ======================================================================
     交互绑定
     ====================================================================== */
  function setPressed(act, on) {
    var b = $('.fn[data-act="' + act + '"]');
    if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function updateEv() {
    el.evValue.textContent = fmtEv(state.ev / 3);
    el.roEv.textContent = fmtEv(state.ev / 3);
    prefs.ev = state.ev;
    savePrefs();
    refreshPreview();
  }

  function bindControls() {
    /* 快门 */
    el.shutter.addEventListener('click', shoot);

    /* 功能键 */
    $('#fnRow').addEventListener('click', function (e) {
      var b = e.target.closest('.fn');
      if (!b) return;
      var act = b.dataset.act;
      if (act === 'flip') {
        if (state.live) {
          startCamera(state.facing === 'user' ? 'environment' : 'user');
        } else if (!state.demoChoice) {
          /* 还没真正连上镜头：先尝试连镜头，而不是继续换示范片 */
          startCamera(state.facing).then(function (ok) {
            if (!ok) toast('镜头没能启动 · 可用示范底片拍摄');
          });
        } else {
          useDemo(state.demoIndex + 1);
        }
      } else if (act === 'timer') {
        prefs.timer = prefs.timer === 0 ? 3 : prefs.timer === 3 ? 10 : 0;
        savePrefs();
        b.setAttribute('aria-pressed', prefs.timer > 0 ? 'true' : 'false');
        el.timerVal.textContent = prefs.timer === 0 ? '关' : prefs.timer + 's';
        toast(prefs.timer === 0 ? '定时关闭' : prefs.timer + ' 秒后自动按快门');
      } else if (act === 'grid') {
        prefs.grid = !prefs.grid;
        savePrefs();
        b.setAttribute('aria-pressed', prefs.grid ? 'true' : 'false');
        el.frameBox.classList.toggle('show-grid', prefs.grid);
      } else if (act === 'date') {
        prefs.date = !prefs.date;
        savePrefs();
        b.setAttribute('aria-pressed', prefs.date ? 'true' : 'false');
        toast(prefs.date ? '日期打印已开启：底片右下角会留下橙色印记' : '日期打印已关闭');
      } else if (act === 'sound') {
        prefs.sound = !prefs.sound;
        savePrefs();
        b.setAttribute('aria-pressed', prefs.sound ? 'true' : 'false');
        if (prefs.sound) Sound.play('tick');
        toast(prefs.sound ? '快门声已开启' : '快门声已关闭');
      } else if (act === 'import') {
        pickFile();
      }
    });

    /* EV 拨轮：单击 ±1/3 档，按住连发 */
    var evTimer = null;
    $$('.ev-btn').forEach(function (b) {
      var dir = Number(b.dataset.ev);
      var repeat = function () {
        state.ev = Math.max(-6, Math.min(6, state.ev + dir));
        updateEv();
        Sound.play('tick');
      };
      var startHold = function () {
        repeat();
        clearInterval(evTimer);
        evTimer = setInterval(repeat, 170);
      };
      var stopHold = function () { clearInterval(evTimer); };
      b.addEventListener('pointerdown', startHold);
      b.addEventListener('pointerup', stopHold);
      b.addEventListener('pointerleave', stopHold);
      b.addEventListener('pointercancel', stopHold);
      b.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); repeat(); }
      });
    });

    /* 胶卷旋钮 */
    var drag = null;
    var STEP = Math.PI / 5;
    el.rollKnob.addEventListener('pointerdown', function (e) {
      el.rollKnob.setPointerCapture(e.pointerId);
      drag = { a: angleOf(e), acc: 0, moved: 0, x: e.clientX, y: e.clientY };
    });
    el.rollKnob.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var a = angleOf(e);
      var d = a - drag.a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      drag.a = a;
      drag.acc += d;
      drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
      var step = Math.trunc(drag.acc / STEP);
      if (step) {
        drag.acc -= step * STEP;
        setFilm(state.filmIndex + step);
      }
    });
    var endDrag = function () {
      if (drag && drag.moved < 6) openLab('films');
      drag = null;
    };
    el.rollKnob.addEventListener('pointerup', endDrag);
    el.rollKnob.addEventListener('pointercancel', function () { drag = null; });
    el.rollKnob.addEventListener('wheel', function (e) {
      e.preventDefault();
      setFilm(state.filmIndex + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1));
    }, { passive: false });
    el.rollKnob.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowUp') { e.preventDefault(); setFilm(state.filmIndex + 1); }
      else if (k === 'ArrowLeft' || k === 'ArrowDown') { e.preventDefault(); setFilm(state.filmIndex - 1); }
      else if (k === 'Home') { e.preventDefault(); setFilm(0); }
      else if (k === 'End') { e.preventDefault(); setFilm(FILMS.length - 1); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); openLab('films'); }
    });

    el.canister.addEventListener('click', function () { openLab('films'); });

    /* 回卷 */
    $('#rewind').addEventListener('click', function () {
      rewind('手动回卷 · 计数器归零');
    });

    /* 图库 */
    el.filmList.addEventListener('click', function (e) {
      var b = e.target.closest('.film-load');
      if (!b) return;
      var li = b.closest('.film-card');
      setFilm(Number(li.dataset.index));
      closeLab();
    });

    el.frames.addEventListener('click', function (e) {
      var b = e.target.closest('.shot-open');
      if (!b) return;
      openLightbox(b.closest('.shot').dataset.id);
    });

    $('#peek').addEventListener('click', function () { openLab('album'); });
    $('#openFilms').addEventListener('click', function () { openLab('films'); });
    $('#sheetClose').addEventListener('click', closeLab);
    el.scrim.addEventListener('click', closeLab);
    $('#tabFilms').addEventListener('click', function () { setTab('films'); });
    $('#tabAlbum').addEventListener('click', function () { setTab('album'); });
    $('#albumImport').addEventListener('click', pickFile);
    el.fileInput.addEventListener('change', function () {
      if (el.fileInput.files && el.fileInput.files[0]) onFile(el.fileInput.files[0]);
    });
    $('#vfRetry').addEventListener('click', function () { startCamera(state.facing); });
    $('#vfSwap').addEventListener('click', function () {
      state.demoChoice = true;
      useDemo(state.demoIndex + 1);
    });

    /* 灯箱 */
    el.lightbox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.dataset.act;
      if (act === 'save') saveCurrent();
      else if (act === 'del') deleteCurrent();
      else if (act === 'close') el.lightbox.close();
    });

    el.toastUndo.addEventListener('click', function () {
      if (toastAction) { var fn = toastAction; toastAction = null; clearTimeout(toastTimer); el.toast.classList.remove('show'); el.toast.hidden = true; fn(); }
    });

    /* 示例底片 */
    el.demoList.addEventListener('click', function (e) {
      var b = e.target.closest('.demo-load');
      if (!b) return;
      var i = Number(b.dataset.index);
      state.demoChoice = true;
      useDemo(i);
      closeLab();
      toast('已装入示范底片「' + DEMOS[i].label + '」· 按快门冲洗');
    });

    /* 键盘快捷键 */
    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input, select, textarea')) return;
      if (el.lightbox.open) return;
      if (e.key === ' ' || e.key === 'Enter') {
        if (e.target === document.body || e.target === el.shutter) {
          e.preventDefault();
          shoot();
        }
      } else if (e.key === 'g') { $('.fn[data-act="grid"]').click(); }
      else if (e.key === 'f') { $('.fn[data-act="flip"]').click(); }
      else if (e.key === 't') { $('.fn[data-act="timer"]').click(); }
      else if (e.key === 'd') { $('.fn[data-act="date"]').click(); }
      else if (e.key === 'm') { $('.fn[data-act="sound"]').click(); }
      else if (e.key === 'Escape') { closeLab(); }
    });

    /* 尺寸变化 */
    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(layoutPreview, 180);
    });
    window.addEventListener('orientationchange', function () { setTimeout(layoutPreview, 300); });

    document.addEventListener('visibilitychange', function () {
      state.running = !document.hidden;
      if (!document.hidden) { state.dirty = true; layoutPreview(); }
    });
  }

  function angleOf(e) {
    var r = el.rollKnob.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  }

  /* ======================================================================
     启动
     ====================================================================== */
  function init() {
    renderFilmList();
    setFilm(state.filmIndex, { silent: true });
    applyDateUi();
    el.frameBox.classList.toggle('show-grid', prefs.grid);
    setPressed('grid', prefs.grid);
    setPressed('date', prefs.date);
    setPressed('sound', prefs.sound);
    setPressed('timer', prefs.timer > 0);
    el.timerVal.textContent = prefs.timer === 0 ? '关' : prefs.timer + 's';
    updateEv();
    updateCounter();

    /* 示范底片列表 */
    el.demoList.innerHTML = DEMOS.map(function (d, i) {
      return '<li><button class="demo-load" type="button" data-index="' + i + '" aria-label="使用示范底片：' + d.label + '">' +
        '<img src="' + d.src + '" alt="" loading="lazy">' +
        '<span class="demo-tag">示范底片</span><span class="demo-name">' + d.label + '</span></button></li>';
    }).join('');

    bindControls();
    refreshAlbum();
    layoutPreview();
    requestAnimationFrame(loop);

    startCamera(prefs.facing === 'user' ? 'user' : 'environment').then(function (ok) {
      if (ok) return;
      toast(window.isSecureContext
        ? '镜头没能启动 · 先用示范底片拍几张试试'
        : '手机浏览器只允许 HTTPS 调用镜头 · 先用示范底片试试');
      armCameraRetry();
    });
  }

  function applyDateUi() { /* 占位：日期打印只影响冲印时的水印 */ }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
