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

  /* ---------- 状态 ---------- */
  var state = {
    filmIndex: 0,
    ev: 0,                    /* 以 1/3 档为单位 */
    facing: 'environment',
    stream: null,
    live: false,
    mirror: false,
    source: 'none',           /* camera | file | none */
    sourceLock: false,        /* 用户已选好导入底片，晚到的镜头请求不再顶掉它 */
    busy: false,
    rewinding: false,         /* 回卷动画期间不接受新的快门 */
    dirty: true,
    running: true,
    previewPixels: 180000,
    shots: [],
    urls: [],
    current: null             /* 灯箱中的照片 */
  };

  var prefs = loadPrefs();
  state.filmIndex = filmIndexOf(prefs.film);
  state.ev = prefs.ev;

  function clampInt(v, min, max, dflt) {
    v = Math.round(Number(v));
    if (!isFinite(v)) return dflt;
    return Math.min(max, Math.max(min, v));
  }

  /* 本地存的偏好可能是旧版本/手工改过的脏值，读进来先收敛到可用范围 */
  function normalizePrefs(p) {
    if (typeof p.film !== 'string' || !p.film) p.film = 'PT-400';
    p.ev = clampInt(p.ev, -6, 6, 0);
    p.roll = clampInt(p.roll, 1, 9999, 1);

    var frame = Math.round(Number(p.frame));
    if (!isFinite(frame) || frame < 1) frame = 1;
    if (frame > FRAMES_PER_ROLL) {
      /* 旧数据停在“本卷已满但没来得及回卷”的状态：顺延到新卷 */
      p.roll = Math.min(9999, p.roll + 1);
      frame = 1;
    }
    p.frame = frame;

    p.timer = Number(p.timer) === 3 || Number(p.timer) === 10 ? Number(p.timer) : 0;
    p.flash = [0, 1, 2].indexOf(Number(p.flash)) >= 0 ? Number(p.flash) : 0;
    p.grid = !!p.grid;
    p.date = !!p.date;
    p.sound = !!p.sound;
    return p;
  }

  function loadPrefs() {
    var d = { film: 'PT-400', ev: 0, grid: true, date: false, sound: true, timer: 0, flash: 0, roll: 1, frame: 1 };
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        for (var k in d) if (p[k] !== undefined) d[k] = p[k];
      }
    } catch (e) { /* 忽略 */ }
    return normalizePrefs(d);
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
    evWheel: $('#evWheel'),
    evDrum: $('#evDrum'),
    timerVal: $('#timerVal'),
    flashVal: $('#flashVal'),
    flashFx: $('#flashFx'),
    notice: $('#vfNotice'),
    noticeText: $('#vfNoticeText'),
    countdown: $('#countdown'),
    lab: $('#lab'),
    scrim: $('#scrim'),
    frames: $('#frames'),
    filmList: $('#filmList'),
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
  ctx.imageSmoothingQuality = 'high';
  var pw = 320, ph = 213;

  function layoutPreview() {
    var r = el.frameBox.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    /* 直接按像素预算控制预览分辨率：手机端每帧只处理约 9 万像素 */
    var target = state.previewPixels;
    var scale = Math.min(2, Math.sqrt(target / (r.width * r.height * dpr * dpr)));
    pw = Math.max(160, Math.round(r.width * dpr * scale));
    ph = Math.max(100, Math.round(pw * r.height / r.width));  /* 跟随取景窗实际比例，竖屏不被拉伸 */
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
    if (state.source === 'file') return el.still;
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

  /* 非实时源（导入的底片）：换卷或调曝光时立即重冲，不等 rAF。
     手机在省电等场景会冻结 requestAnimationFrame，仅靠 loop 会显得「不实时」 */
  function refreshPreview() {
    state.dirty = true;
    if (state.source !== 'camera') drawPreview();
  }

  var lastFrame = 0, frameTimes = [], lastAdapt = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!state.running) return;
    if (now - lastFrame < 1000 / 30) return;
    lastFrame = now;

    var liveSrc = state.source === 'camera';
    if (!liveSrc && !state.dirty) return;
    if (!liveSrc) state.dirty = false;

    var t0 = performance.now();
    drawPreview(now);
    var dt = performance.now() - t0;

    frameTimes.push(dt);
    if (frameTimes.length > 10) frameTimes.shift();
    if (liveSrc && now - lastAdapt > 700 && frameTimes.length === 10) {
      lastAdapt = now;
      var avg = frameTimes.reduce(function (a, b) { return a + b; }, 0) / frameTimes.length;
      if (avg > 22 && state.previewPixels > 120000) {
        state.previewPixels = Math.max(120000, state.previewPixels - 18000);
        layoutPreview();
      } else if (avg < 9 && state.previewPixels < 300000) {
        state.previewPixels = Math.min(300000, state.previewPixels + 18000);
        layoutPreview();
      }
      frameTimes.length = 0;
    }
  }

  /* ---------- 镜头 ---------- */
  var camStart = null;    /* 同一时刻只允许一次镜头启动请求（手势重试与「重试」按钮可能同时触发） */
  var camRetryOff = null; /* 已挂上的「碰一下页面就重试」监听；导入底片时立即摘掉 */

  function stopStream(stream) {
    if (!stream) return;
    var tracks = stream.getTracks ? stream.getTracks() : [];
    tracks.forEach(function (t) { t.stop(); });
  }

  function startCamera(facing) {
    if (camStart) return camStart;
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      /* 手机浏览器只在安全上下文（HTTPS / localhost）放行镜头 */
      failCamera(window.isSecureContext ? '浏览器不支持镜头调用' : '手机只允许 HTTPS 调用镜头');
      return Promise.resolve(false);
    }
    camStart = navigator.mediaDevices.getUserMedia({
      audio: false,
      /* 要 4:3（多数手机 CMOS 的原生比例），竖屏取景框就是它转 90°，几乎不用裁切 */
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }
    }).then(function (stream) {
      /* 等到结果时用户已经导入了底片：这条流不能再顶掉他选好的画面 */
      if (state.sourceLock) {
        stopStream(stream);
        return false;
      }
      state.stream = stream;
      state.facing = facing;
      state.mirror = facing === 'user';
      state.source = 'camera';
      state.live = true;
      el.video.srcObject = stream;
      el.video.style.display = 'block';
      el.still.hidden = true;
      setPressed('flip', state.facing === 'user');
      bindTrackEnded(stream);
      hideNotice();
      layoutPreview();
      startVideo();
      /* 拿到流就是连上了。画面出得慢不能反过来判定成「未连接」 */
      return true;
    }).catch(function (err) {
      var why = err && err.name === 'NotAllowedError' ? '镜头权限被拒绝'
        : err && err.name === 'NotFoundError' ? '没有找到摄像头'
        : err && err.name === 'NotReadableError' ? '镜头被其他应用占用'
        : '无法访问镜头';
      if (!state.sourceLock) failCamera(why);
      return false;
    }).then(function (v) { camStart = null; return v; },
            function (e) { camStart = null; throw e; });
    return camStart;
  }

  /* 轨道被系统掐断（切走、权限回收、硬件异常）时给明确提示 */
  var trackEnded = null;
  function bindTrackEnded(stream) {
    unbindTrackEnded();
    trackEnded = function () {
      trackEnded = null;
      if (state.source !== 'camera') return;
      state.stream = null;
      state.live = false;
      state.source = 'none';
      el.video.srcObject = null;
      showNotice('镜头连接已断开 · 点「重试」重新连接', 'empty');
    };
    var tracks = stream.getVideoTracks ? stream.getVideoTracks() : [];
    tracks.forEach(function (t) { t.addEventListener('ended', trackEnded); });
  }
  function unbindTrackEnded() {
    if (!trackEnded) return;
    if (state.stream && state.stream.getVideoTracks) {
      state.stream.getVideoTracks().forEach(function (t) {
        t.removeEventListener('ended', trackEnded);
      });
    }
    trackEnded = null;
  }

  /* 连上镜头后画面可能还要缓一会儿（iPhone 上尤其明显）。出画了就把提示收干净；
     迟迟不出画只给一句准确的说明，不再反过来报「未连接」——那正是误报的来源 */
  var videoTimer = null, videoReady = null;
  function startVideo() {
    var v = el.video;
    clearTimeout(videoTimer);
    if (videoReady) {
      v.removeEventListener('loadedmetadata', videoReady);
      v.removeEventListener('playing', videoReady);
      videoReady = null;
    }
    resumeVideo();

    var painted = function () {
      if (state.source !== 'camera') return true;
      if (v.videoWidth > 0) { clearTimeout(videoTimer); hideNotice(); return true; }
      return false;
    };
    var onReady = function () {
      if (!painted()) return;
      v.removeEventListener('loadedmetadata', onReady);
      v.removeEventListener('playing', onReady);
      if (videoReady === onReady) videoReady = null;
    };
    videoReady = onReady;
    v.addEventListener('loadedmetadata', onReady);
    v.addEventListener('playing', onReady);
    videoTimer = setTimeout(function () {
      if (painted()) return;
      showNotice('镜头已连接，画面还在缓冲…一直黑屏就点「重试」或切一下前后摄', 'info');
    }, 6000);
  }

  /* 切后台/来电后视频可能被系统暂停：回前台再播一次，不重复挂提示定时器 */
  function resumeVideo() {
    if (state.source !== 'camera' || !state.stream) return;
    var v = el.video;
    try {
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* 自动播放被拦下也无妨 */ });
    } catch (e) { /* 个别内核对 play() 同步抛错，忽略 */ }
  }

  /* 手机浏览器（尤其 iOS Safari）要求摄像头调用发生在「用户手势」里，页面加载时的自动启动
     会被静默拒绝。各家的错误名还不统一（NotAllowedError / NotFoundError / SecurityError 都见
     过），所以任何失败都保留监听：用户一碰页面就立刻重试，最多补试 3 次；一旦连上镜头、或
     用户自己导入了底片，就摘掉监听——绝不顶掉他已经选好的画面 */
  function armCameraRetry() {
    disarmCameraRetry();
    var left = 3;
    var detach = function () {
      document.removeEventListener('pointerdown', onGesture);
      document.removeEventListener('keydown', onGesture);
      if (camRetryOff === detach) camRetryOff = null;
    };
    var onGesture = function () {
      if (state.source === 'camera' || state.source === 'file' || state.sourceLock) { detach(); return; }
      if (state.busy) return;
      if (left-- <= 0) { detach(); return; }
      startCamera(state.facing).then(function (ok) { if (ok) detach(); });
    };
    camRetryOff = detach;
    document.addEventListener('pointerdown', onGesture);
    document.addEventListener('keydown', onGesture);
  }

  function disarmCameraRetry() {
    if (camRetryOff) camRetryOff();
  }

  function stopCamera() {
    clearTimeout(videoTimer);
    if (videoReady) {
      el.video.removeEventListener('loadedmetadata', videoReady);
      el.video.removeEventListener('playing', videoReady);
      videoReady = null;
    }
    if (state.stream) {
      unbindTrackEnded();
      stopStream(state.stream);
      state.stream = null;
      if (state.source === 'camera') state.source = 'none';
    }
    state.live = false;
  }

  /* 镜头打不开时：取景窗上写明原因，并给出「重试 / 导入底片」两个出口。
     已经在冲洗导入的底片时不打扰 */
  function failCamera(why) {
    if (!activeSource()) showNotice(why, 'empty');
  }

  /* 把一张图片装进取景窗当底片用（画面始终由画布输出）。
     一旦导入就锁住图源并摘掉镜头重试，晚到的 getUserMedia 结果会被丢弃 */
  function loadSource(src) {
    disarmCameraRetry();
    state.sourceLock = true;
    stopCamera();
    state.mirror = false;
    el.video.style.display = 'none';
    el.still.hidden = true;
    el.still.onload = function () {
      /* 用户自己已经切回镜头时，不要用图片顶掉镜头画面 */
      if (state.source === 'camera') return;
      state.source = 'file';
      state.dirty = true;
      hideNotice();
      layoutPreview();
    };
    el.still.onerror = function () {
      state.source = 'none';
      state.sourceLock = false;
      showNotice('底片读取失败 · 可以换一张图片，或重试镜头', 'empty');
      toast('这张底片读不出来，请换一张图片');
    };
    el.still.src = src;
  }

  function showNotice(text, kind) {
    el.noticeText.textContent = text;
    el.notice.dataset.kind = kind || 'info';
    el.notice.hidden = false;
  }
  function hideNotice() {
    el.notice.hidden = true;
    delete el.notice.dataset.kind;
  }

  /* ======================================================================
     影调取景器变量（暗角 / 漏光）
     颗粒不参与取景：只在成片冲印时由像素管线加入
     ====================================================================== */
  function applyFilmVars(f) {
    var st = el.frameBox.style;
    st.setProperty('--vig', f.vignette.toFixed(2));
    st.setProperty('--leak', (f.leak || 0).toFixed(2));
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
    el.rollKnob.style.setProperty('--rot', (i * 360 / n) + 'deg');
    applyFilmVars(f);
    updateEdgeCode();
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
    /* 胶卷总数即旋钮量程：以后再加乳剂也不用改 HTML */
    el.rollKnob.setAttribute('aria-valuemax', FILMS.length);
  }

  /* ======================================================================
     快门
     ====================================================================== */
  var countdownTimer = null;

  function shoot() {
    if (state.busy) return;
    if (state.rewinding) { toast('正在回卷，等新卷上好再拍'); return; }
    if (!activeSource()) {
      toast('还没有画面：先允许镜头，或导入一张底片');
      return;
    }
    if (prefs.timer > 0) runCountdown(prefs.timer, captureShot);
    else captureShot();
  }

  /* 回卷、打开灯箱等用户操作会取消还没触发的定时拍摄 */
  function cancelCountdown() {
    if (countdownTimer === null) return false;
    clearInterval(countdownTimer);
    countdownTimer = null;
    el.countdown.hidden = true;
    state.busy = false;
    return true;
  }

  function runCountdown(sec, done) {
    cancelCountdown();
    state.busy = true;
    var n = sec;
    el.countdown.hidden = false;
    el.countdown.textContent = n;
    Sound.play('tick');
    countdownTimer = setInterval(function () {
      n--;
      if (n <= 0) {
        cancelCountdown();
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

  function fireFlash() {
    el.flashFx.classList.remove('firing');
    void el.flashFx.offsetWidth;
    el.flashFx.classList.add('firing');
    setTimeout(function () { el.flashFx.classList.remove('firing'); }, 260);
  }

  /* 自动闪光：从当前取景画面抽样估亮度 */
  function sceneLuma() {
    try {
      var d = ctx.getImageData(0, 0, pw, ph).data;
      var sum = 0, n = 0;
      for (var i = 0; i < d.length; i += 64) {
        sum += d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
        n++;
      }
      return n ? sum / n / 255 : 0.5;
    } catch (e) {
      return 0.5;
    }
  }

  function flashShouldFire() {
    if (prefs.flash === 2) return true;
    if (prefs.flash !== 1) return false;
    return sceneLuma() < 0.42;
  }

  /* 只有部分浏览器（多为 Android Chrome）开放 torch；iOS Safari 不支持 */
  function torchTrack() {
    if (!state.stream) return null;
    var tracks = state.stream.getVideoTracks ? state.stream.getVideoTracks() : [];
    var track = tracks && tracks[0];
    if (!track || !track.getCapabilities) return null;
    try {
      var caps = track.getCapabilities();
      return caps && caps.torch ? track : null;
    } catch (e) {
      return null;
    }
  }

  function setTorch(track, on) {
    if (!track || !track.applyConstraints) return Promise.resolve(false);
    return track.applyConstraints({ advanced: [{ torch: !!on }] })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  function captureShot() {
    if (state.busy) return;
    if (state.rewinding) { toast('正在回卷，等新卷上好再拍'); return; }
    state.busy = true;
    var film = currentFilm();
    var flash = flashShouldFire();

    if (!flash) { takeShot(film, ''); return; }

    var track = torchTrack();
    if (track) {
      setTorch(track, true).then(function (ok) {
        if (ok) {
          /* 给 LED 一点时间把画面照亮 */
          setTimeout(function () { takeShot(film, 'torch', track); }, 180);
        } else {
          fireFlash();
          setTimeout(function () { takeShot(film, 'screen'); }, 120);
        }
      });
      return;
    }

    /* 没有硬件 torch：整屏闪白补光 */
    fireFlash();
    setTimeout(function () { takeShot(film, 'screen'); }, 120);
  }

  function takeShot(film, flashKind, torch) {
    var shot;
    fireShutter();
    try {
      shot = grabFrame();
    } catch (e) {
      if (torch) setTorch(torch, false);
      state.busy = false;
      toast('这一帧没能拍下来，请重试');
      return;
    }
    if (torch) setTorch(torch, false);

    var evStops = state.ev / 3;
    var seed = (Math.random() * 100000) | 0;
    /* 硬件 LED 已经补过光，成片里只留一点暖调；屏幕补光保留完整模拟 */
    var flashAmt = flashKind === 'torch' ? 0.35 : flashKind === 'screen' ? 1 : 0;

    openProcessing(film, function () {
      develop(shot.canvas, shot.W, shot.H, film, {
        ev: evStops, halation: true, grain: true, vignette: true, leak: true,
        seed: seed, dateStamp: prefs.date, flash: flashAmt
      });
      return toBlob(shot.canvas, 0.92).then(function (blob) {
        if (!blob) throw new Error('jpeg-encode-failed');
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
            flash: flashKind ? 1 : 0,
            flashKind: flashKind,
            w: shot.W,
            h: shot.H,
            date: prefs.date,
            ts: Date.now(),
            blob: blob,
            thumb: thumb || blob
          };
          return Store.add(frame).then(function () {
            frame.persisted = Store.lastAddPersisted !== false;
            return frame;
          });
        });
      });
    }).then(function (frame) {
      state.busy = false;
      if (!frame) return;
      toast('已冲印 ' + frame.code + ' · 第 ' + pad2(frame.frameNo) + ' 张' +
        (frame.persisted === false ? ' · 存储不可用，仅本次会话' : ''));
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
    if (state.rewinding) return;
    cancelCountdown();
    state.rewinding = true;
    el.shutter.disabled = true;
    /* 先落盘新卷：1.85s 动画期间关页/刷新也不会重复上一张的编号 */
    prefs.roll += 1;
    prefs.frame = 1;
    savePrefs();
    var knob = $('#rewind');
    knob.classList.remove('spinning');
    void knob.offsetWidth;
    knob.classList.add('spinning');
    Sound.play('rewind');
    if (msg) toast(msg);
    el.counterDigits.textContent = '--';
    setTimeout(function () {
      knob.classList.remove('spinning');
      updateCounter();
      state.rewinding = false;
      el.shutter.disabled = false;
      if (msg) toast('已装上新卷 · ROLL ' + pad2(prefs.roll));
    }, 1850);
  }

  /* 齿孔边码跟着当前胶卷与张数走：换卷时也要立刻刷新，不能等下一张 */
  function updateEdgeCode() {
    var left = $$('.edge-code');
    var iso = currentFilm().iso;
    if (left[0]) left[0].textContent = 'SPOOLO 135 · ' + iso + ' · ' + pad2(prefs.frame);
    if (left[1]) left[1].textContent = pad2(prefs.frame) + ' → SPOOLO ' + iso;
  }

  function updateCounter() {
    el.counterDigits.textContent = pad2(prefs.frame);
    el.rollNo.textContent = pad2(prefs.roll);
    el.roLeft.textContent = Math.max(0, FRAMES_PER_ROLL - prefs.frame + 1);
    updateEdgeCode();
  }

  /* ======================================================================
     冲印遮罩
     ====================================================================== */
  function openProcessing(film, work) {
    var bar = el.procBar;
    var steps = $$('.proc-steps li');
    var dur = 800, t0 = performance.now();
    var result = null, error = null, settled = false;

    el.procTitle.textContent = (film.process === 'B&W' ? '黑白显影中' : film.process + ' 冲印中');
    el.procNote.textContent = '按「' + film.code + '」的乳剂曲线还原色彩…';
    el.processing.hidden = false;
    bar.style.width = '0';
    steps.forEach(function (s) { s.className = ''; });

    /* 先让遮罩画出来，再开始重活，避免首帧就卡住 */
    setTimeout(function () {
      Promise.resolve()
        .then(work)
        .then(function (v) { result = v; settled = true; })
        .catch(function (e) { error = e; settled = true; });
    }, 40);

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
          }, 160);
        };
        wait();
      }
      requestAnimationFrame(tick);
    });
  }

  /* ======================================================================
     影集
     ====================================================================== */
  function paintAlbum(rows) {
    state.shots = rows;
    renderFrames(rows);
    $('#albumBadge').textContent = String(rows.length);
    el.negatives.hidden = rows.length > 0;
    if (!rows.length) {
      el.albumStat.textContent = '还没有冲洗出照片';
    } else {
      /* 按实际出现过的卷号统计：手动回卷后卷号可能不连续，不能再用 max−min+1 */
      var rolls = 0, seenRolls = {};
      rows.forEach(function (r) {
        if (!seenRolls[r.roll]) { seenRolls[r.roll] = 1; rolls += 1; }
      });
      el.albumStat.textContent = '共 ' + rows.length + ' 张 · ' + rolls + ' 卷';
    }
    if (rows.length) {
      setPeek(rows[0]);
    } else {
      el.peekImg.hidden = true;
      el.peekEmpty.hidden = false;
    }
  }

  function refreshAlbum() {
    return Store.all().then(paintAlbum);
  }

  /* 复制成独立的 Blob：撤销时写回副本，不再碰已经被删除的 IndexedDB Blob */
  function copyBlob(blob) {
    if (!blob) return Promise.resolve(null);
    if (blob.arrayBuffer) {
      return blob.arrayBuffer().then(function (buf) {
        return new Blob([buf], { type: blob.type || 'image/jpeg' });
      });
    }
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () { resolve(new Blob([r.result], { type: blob.type || 'image/jpeg' })); };
      r.onerror = function () { resolve(blob); };
      r.readAsArrayBuffer(blob);
    });
  }

  function copyFrame(row) {
    return Promise.all([copyBlob(row.blob), copyBlob(row.thumb)]).then(function (blobs) {
      var out = {};
      for (var k in row) out[k] = row[k];
      out.blob = blobs[0] || row.blob;
      out.thumb = blobs[1] || row.thumb;
      return out;
    });
  }

  function releaseUrls() {
    state.urls.forEach(function (u) { URL.revokeObjectURL(u); });
    state.urls = [];
  }

  function url(blob) {
    if (!blob) return '';
    var u = URL.createObjectURL(blob);
    state.urls.push(u);
    return u;
  }

  function renderFrames(rows) {
    releaseUrls();
    var html = '';
    rows.forEach(function (r) {
      var thumb = url(r.thumb);
      var ratio = r.w && r.h ? r.w + '/' + r.h : '3/2';
      html +=
        '<li class="shot" data-id="' + r.id + '">' +
        '<button class="shot-open" type="button" aria-label="查看第 ' + pad2(r.frameNo || 1) + ' 张，' + r.code + '">' +
        '<span class="shot-film">' +
        '<span class="shot-perf top" aria-hidden="true"></span>' +
        (thumb ? '<img src="' + thumb + '" alt="" loading="lazy" style="aspect-ratio:' + ratio + '">' : '') +
        '<span class="shot-perf bottom" aria-hidden="true"></span>' +
        '</span>' +
        '<span class="shot-meta"><b>' + pad2(r.frameNo || 1) + '</b><span>' + r.code + '</span>' +
        '<span>ROLL ' + pad2(r.roll || 1) + '</span></span>' +
        '</button></li>';
    });
    el.frames.innerHTML = html;
  }

  function setPeek(row) {
    if (!row || !row.thumb) {
      el.peekImg.hidden = true;
      el.peekEmpty.hidden = false;
      return;
    }
    el.peekImg.src = url(row.thumb);
    el.peekImg.hidden = false;
    el.peekEmpty.hidden = true;
  }

  var lbToken = 0;
  function openLightbox(id) {
    if (el.lightbox.open) return;
    var found = null;
    for (var i = 0; i < state.shots.length; i++) if (state.shots[i].id === id) found = state.shots[i];
    if (!found) return;
    cancelCountdown();
    /* 列表里只有缩略图，原图在打开灯箱时再按 id 取 */
    var token = ++lbToken;
    Store.get(id).then(function (row) {
      if (token !== lbToken || el.lightbox.open) return;
      if (!row || !row.blob) { toast('这张底片读不出来，请刷新影集'); return; }
      state.current = row;
      el.lbImage.src = url(row.blob);
      el.lbCode.textContent = row.code;
      el.lbName.textContent = row.name + (row.en ? ' · ' + row.en : '');
      var d = new Date(row.ts || Date.now());
      var evText = typeof row.ev === 'number' ? fmtEv(row.ev) : '0.0';
      el.lbMeta.innerHTML =
        '<dt>卷 / 张</dt><dd>ROLL ' + pad2(row.roll || 1) + ' · #' + pad2(row.frameNo || 1) + '</dd>' +
        '<dt>乳剂</dt><dd>' + row.code + ' · ISO ' + row.iso + '</dd>' +
        '<dt>曝光补偿</dt><dd>' + evText + ' EV</dd>' +
        '<dt>闪光</dt><dd>' + (row.flash ? (row.flashKind === 'torch' ? '已触发（LED）' : '已触发（屏幕）') : '未触发') + '</dd>' +
        '<dt>冲印时间</dt><dd>' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
        ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + '</dd>' +
        '<dt>尺寸</dt><dd>' + row.w + ' × ' + row.h + '</dd>' +
        '<dt>日期打印</dt><dd>' + (row.date ? '已开启' : '未开启') + '</dd>';
      el.lightbox.showModal();
    }).catch(function () {
      toast('这张底片读不出来，请刷新影集');
    });
  }

  function saveCurrent() {
    var row = state.current;
    if (!row || !row.blob) { toast('这张底片读不出来，请刷新影集'); return; }
    var name = 'SPOOLO_' + row.code + '_ROLL' + pad2(row.roll) + '_' + pad2(row.frameNo) + '.jpg';
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    /* iOS Safari 的 blob 下载经常卡在最后；优先走系统分享 / 存储菜单 */
    if (isIOS) {
      var file = null;
      try { file = new File([row.blob], name, { type: 'image/jpeg' }); } catch (e) { /* 老浏览器 */ }
      var canShare = false;
      try {
        canShare = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
      } catch (e) { canShare = false; }

      if (canShare) {
        navigator.share({ files: [file], title: 'SPOOLO ' + row.code }).then(function () {
          toast('已打开保存菜单');
        }).catch(function (err) {
          if (err && err.name === 'AbortError') return;
          toast('请长按图片保存到相册');
        });
        return;
      }
      /* 不支持文件分享的 Safari：直接打开原图，让用户长按保存 */
      window.open(url(row.blob), '_blank');
      toast('长按图片可保存到相册');
      return;
    }

    var href = url(row.blob);
    var a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    /* 不要立刻移除，避免个别浏览器把下载中断 */
    setTimeout(function () { a.remove(); }, 1500);
    toast('已保存到本地：' + row.code + ' #' + pad2(row.frameNo));
  }

  function deleteCurrent() {
    var row = state.current;
    if (!row) return;
    el.lightbox.close();

    paintAlbum(state.shots.filter(function (r) { return r.id !== row.id; }));

    /* 先复制独立 Blob，再立即从 IndexedDB 删除：
       关掉页面也不会留下「待删除」记录；撤销时写回副本 */
    var undoCopy = copyFrame(row).then(function (copy) {
      return Store.remove(row.id).then(function () { return copy; });
    });
    undoCopy.catch(function () {
      var rows = state.shots.slice();
      rows.push(row);
      rows.sort(function (a, b) { return b.ts - a.ts; });
      paintAlbum(rows);
    });

    toast('已删除 ' + row.code + ' #' + pad2(row.frameNo), '撤销', function () {
      undoCopy.then(function (copy) {
        return Store.add(copy);
      }).then(refreshAlbum).catch(function () {
        toast('撤销失败，请重试');
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
      if (!r.result) { toast('这张图片读不出来，请换一张'); return; }
      loadSource(r.result);
      closeLab();
      toast('已装入「' + (file.name || '本地底片') + '」· 按下快门即可冲洗');
    };
    r.onerror = function () { toast('这张图片读不出来，请换一张'); };
    try {
      r.readAsDataURL(file);
    } catch (e) {
      toast('这张图片读不出来，请换一张');
    }
  }

  /* ======================================================================
     暗房抽屉 / 标签页
     ====================================================================== */
  var isMobile = function () { return window.matchMedia('(max-width: 999px)').matches; };
  var labReturnFocus = null;

  /* 抽屉打开时把机身与跳转链接设为 inert：键盘/读屏都不会跑到背景 */
  function setLabInert(on) {
    var cam = $('.camera');
    if (cam) cam.inert = !!on;
    var skip = $('.skip');
    if (skip) skip.inert = !!on;
  }

  function labFocusables() {
    return $$('#lab button, #lab a[href], #lab [tabindex="0"]').filter(function (n) {
      return !n.disabled && n.getClientRects().length > 0;
    });
  }

  /* 断点切回桌面时收起移动端抽屉，恢复页面滚动（否则 overflow:hidden 会一直留着） */
  function syncViewportMode() {
    if (isMobile()) return;
    if (el.lab.classList.contains('open')) {
      closeLab();
    } else if (document.documentElement.style.overflow === 'hidden') {
      document.documentElement.style.overflow = '';
    }
  }

  function openLab(tab) {
    if (tab) setTab(tab);
    if (!isMobile()) return;
    var wasOpen = el.lab.classList.contains('open');
    if (!wasOpen) labReturnFocus = document.activeElement;
    el.lab.classList.add('open');
    el.scrim.hidden = false;
    requestAnimationFrame(function () { el.scrim.classList.add('show'); });
    document.documentElement.style.overflow = 'hidden';
    var target = tab === 'album' ? $('#tabAlbum') : $('#tabFilms');
    if (target) {
      /* 抽屉有滑入过渡，未完成前 focus 会被拒绝；反复尝试直到焦点进入抽屉 */
      var tries = 0;
      (function focusTarget() {
        if (!el.lab.classList.contains('open')) return;
        try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
        if (el.lab.contains(document.activeElement) || ++tries > 25) return;
        setTimeout(focusTarget, 40);
      })();
    }
    if (!wasOpen) setLabInert(true);
  }

  function closeLab() {
    if (!el.lab.classList.contains('open')) { setLabInert(false); return; }
    el.lab.classList.remove('open');
    el.scrim.classList.remove('show');
    document.documentElement.style.overflow = '';
    setLabInert(false);
    var target = labReturnFocus;
    labReturnFocus = null;
    if (target && target.focus) {
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
    setTimeout(function () {
      if (!el.lab.classList.contains('open')) el.scrim.hidden = true;
    }, 340);
    refreshPreview();
  }

  function setTab(tab) {
    var films = tab !== 'album';
    $('#tabFilms').setAttribute('aria-selected', films ? 'true' : 'false');
    $('#tabAlbum').setAttribute('aria-selected', films ? 'false' : 'true');
    $('#tabFilms').tabIndex = films ? 0 : -1;
    $('#tabAlbum').tabIndex = films ? -1 : 0;
    $('#panelFilms').hidden = !films;
    $('#panelAlbum').hidden = films;
  }

  /* ======================================================================
     Toast
     ====================================================================== */
  var toastTimer = null, toastHideTimer = null, toastAction = null;
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
    clearTimeout(toastHideTimer);
    toastHideTimer = null;
    toastTimer = setTimeout(function () {
      el.toast.classList.remove('show');
      toastAction = null;
      toastHideTimer = setTimeout(function () {
        el.toast.hidden = true;
        toastHideTimer = null;
      }, 240);
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

  var FLASH_CHARS = ['关', '自', '强'];
  function updateFlashUi() {
    setPressed('flash', prefs.flash > 0);
    el.flashVal.textContent = FLASH_CHARS[prefs.flash] || '关';
    var b = $('.fn[data-act="flash"]');
    if (b) b.setAttribute('aria-label', '闪光灯：' + ['关闭', '自动', '强制'][prefs.flash]);
  }

  function syncEvWheel() {
    /* 每 1/3 档让滚轮纹理移动 3px；负号让向上拨动时纹理向上走 */
    el.evDrum.style.setProperty('--ev-spin', (-state.ev * 3).toFixed(0));
    el.evWheel.setAttribute('aria-valuenow', (state.ev / 3).toFixed(2));
    el.evWheel.setAttribute('aria-valuetext', fmtEv(state.ev / 3) + ' EV');
  }

  function updateEv() {
    el.evValue.textContent = fmtEv(state.ev / 3);
    el.roEv.textContent = fmtEv(state.ev / 3);
    syncEvWheel();
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
        /* 用户主动要镜头：解除导入锁定，这次的 getUserMedia 结果可以生效 */
        state.sourceLock = false;
        if (state.live) startCamera(state.facing === 'user' ? 'environment' : 'user');
        else startCamera(state.facing).then(function (ok) {
          if (!ok) toast('镜头没能启动 · 可以导入一张底片来冲洗');
        });
      } else if (act === 'timer') {
        prefs.timer = prefs.timer === 0 ? 3 : prefs.timer === 3 ? 10 : 0;
        savePrefs();
        b.setAttribute('aria-pressed', prefs.timer > 0 ? 'true' : 'false');
        el.timerVal.textContent = prefs.timer === 0 ? '关' : prefs.timer + 's';
        toast(prefs.timer === 0 ? '定时关闭' : prefs.timer + ' 秒后自动按快门');
      } else if (act === 'flash') {
        prefs.flash = (prefs.flash + 1) % 3;
        savePrefs();
        updateFlashUi();
        var flashMsg = ['闪光灯已关闭', '闪光灯：自动（暗光时触发）', '闪光灯：强制开启'][prefs.flash];
        if (prefs.flash > 0 && !torchTrack()) flashMsg += ' · 屏幕补光';
        toast(flashMsg);
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

    /* EV 垂直滚轮：上下拖动 / 鼠标滚轮持续拨动，按 1/3 档吸附 */
    var evDragging = false;
    var evStartY = 0;
    var evStartEv = 0;
    var evLastTick = 0;
    var evTick = function () {
      var now = performance.now();
      if (now - evLastTick > 55) { evLastTick = now; Sound.play('tick'); }
    };
    var setEv = function (v) {
      v = Math.max(-6, Math.min(6, v));
      if (v === state.ev) return;
      state.ev = v;
      updateEv();
      evTick();
    };
    el.evWheel.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      evDragging = true;
      evStartY = e.clientY;
      evStartEv = state.ev;
      el.evWheel.classList.add('is-dragging');
      if (el.evWheel.setPointerCapture) el.evWheel.setPointerCapture(e.pointerId);
      el.evWheel.focus({ preventScroll: true });
    });
    el.evWheel.addEventListener('pointermove', function (e) {
      if (!evDragging) return;
      var steps = Math.round((evStartY - e.clientY) / 12);
      setEv(evStartEv + steps);
    });
    var endEvDrag = function () {
      evDragging = false;
      el.evWheel.classList.remove('is-dragging');
    };
    el.evWheel.addEventListener('pointerup', endEvDrag);
    el.evWheel.addEventListener('pointercancel', endEvDrag);
    el.evWheel.addEventListener('lostpointercapture', endEvDrag);
    el.evWheel.addEventListener('wheel', function (e) {
      e.preventDefault();
      setEv(state.ev + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
    el.evWheel.addEventListener('keydown', function (e) {
      var k = e.key, v = state.ev;
      if (k === 'ArrowUp' || k === 'ArrowRight') v += 1;
      else if (k === 'ArrowDown' || k === 'ArrowLeft') v -= 1;
      else if (k === 'PageUp') v += 3;
      else if (k === 'PageDown') v -= 3;
      else if (k === 'Home') v = -6;
      else if (k === 'End') v = 6;
      else return;
      e.preventDefault();
      setEv(v);
    });

    /* 胶卷旋钮 */
    var drag = null;
    /* 每档角度必须跟视觉刻度一致：n 卷时每档 360/n 度 */
    var STEP = Math.PI * 2 / FILMS.length;
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

    /* 标签页键盘：左右 / Home / End 切换，焦点跟随（ARIA tabs 模式） */
    $('.lab-tabs').addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
      e.preventDefault();
      var tabs = [$('#tabFilms'), $('#tabAlbum')];
      var cur = document.activeElement === tabs[1] ? 1 : 0;
      var next = k === 'Home' ? 0 : k === 'End' ? 1 : cur === 0 ? 1 : 0;
      setTab(next === 0 ? 'films' : 'album');
      tabs[next].focus();
    });
    $('#albumImport').addEventListener('click', pickFile);
    el.fileInput.addEventListener('change', function () {
      if (el.fileInput.files && el.fileInput.files[0]) onFile(el.fileInput.files[0]);
    });
    $('#vfRetry').addEventListener('click', function () {
      state.sourceLock = false;
      startCamera(state.facing);
    });
    $('#vfImport').addEventListener('click', pickFile);

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
      if (toastAction) {
        var fn = toastAction;
        toastAction = null;
        clearTimeout(toastTimer);
        clearTimeout(toastHideTimer);
        toastHideTimer = null;
        el.toast.classList.remove('show');
        el.toast.hidden = true;
        fn();
      }
    });

    /* 移动端抽屉打开时：Tab 焦点在抽屉内循环，配合背景 inert 不逃逸 */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      if (!isMobile() || !el.lab.classList.contains('open')) return;
      var nodes = labFocusables();
      if (!nodes.length) return;
      var first = nodes[0], last = nodes[nodes.length - 1], a = document.activeElement;
      if (e.shiftKey) {
        if (a === first || !el.lab.contains(a)) {
          e.preventDefault();
          last.focus();
        }
      } else if (a === last || !el.lab.contains(a)) {
        e.preventDefault();
        first.focus();
      }
    });

    /* 键盘快捷键：带修饰键的组合留给浏览器，长按不重复触发 */
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;
      if (e.target && e.target.matches && e.target.matches('input, select, textarea')) return;
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
      rt = setTimeout(function () {
        syncViewportMode();
        layoutPreview();
      }, 180);
    });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () {
        syncViewportMode();
        layoutPreview();
      }, 300);
    });

    document.addEventListener('visibilitychange', function () {
      state.running = !document.hidden;
      if (!document.hidden) {
        state.dirty = true;
        layoutPreview();
        resumeVideo();
      }
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
    el.frameBox.classList.toggle('show-grid', prefs.grid);
    setPressed('grid', prefs.grid);
    setPressed('date', prefs.date);
    setPressed('sound', prefs.sound);
    setPressed('timer', prefs.timer > 0);
    updateFlashUi();
    el.timerVal.textContent = prefs.timer === 0 ? '关' : prefs.timer + 's';
    updateEv();
    updateCounter();
    setTab('films');

    bindControls();
    refreshAlbum();
    layoutPreview();
    requestAnimationFrame(loop);

    startCamera(prefs.facing === 'user' ? 'user' : 'environment').then(function (ok) {
      if (ok) return;
      /* 用户已经在导入底片（或已有画面）时不弹失败提示，也不再挂重试 */
      if (state.source !== 'none' || state.sourceLock) return;
      toast(window.isSecureContext
        ? '镜头没能启动 · 点取景窗上的「导入底片」'
        : '手机浏览器只允许 HTTPS 调用镜头 · 也可以导入一张底片');
      armCameraRetry();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
