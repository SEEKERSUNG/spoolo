/* ==========================================================================
   SPOOLO · i18n — 简体中文 / English
   中文原文是稳定翻译 key；动态数量由完整语序的模式处理。
   ========================================================================== */
(function (global) {
  'use strict';

  var S = global.SPOOLO = global.SPOOLO || {};
  var language = 'zh-CN';
  var own = Object.prototype.hasOwnProperty;

  var en = {
    'SPOOLO · 一台网页里的胶片相机': 'SPOOLO · A Film Camera in Your Browser',
    'SPOOLO 是一台跑在浏览器里的 135 胶片相机：spektrafilm 光谱胶片与相纸模拟、机械快门手感、颗粒与光晕、暗房冲印。': 'SPOOLO is a 135 film camera in your browser: spektrafilm spectral film and paper simulation, mechanical shutter feel, grain and halation, and a darkroom.',
    '跳到相机操作区': 'Skip to camera controls',
    'SPOOLO 胶片相机机身': 'SPOOLO film camera body',
    '回卷换新卷': 'Rewind and load a new roll',
    '135 胶片相机': '135 film camera',
    '张剩余': 'left',
    '未连接镜头': 'No lens connected',
    '重试': 'Retry',
    '导入底片': 'Import',
    '正在载入': 'Loading…',
    '光谱数据载入中': 'Loading spectral data',
    '胶卷库': 'Films',
    '镜头': 'Camera',
    '定时': 'Timer',
    '闪光': 'Flash',
    '网格': 'Grid',
    '日期': 'Date',
    '快门声': 'Sound',
    '颗粒': 'Grain',
    '导入': 'Import',
    '关': 'OFF',
    '开': 'ON',
    '自': 'AUTO',
    '强': 'ON',
    '空<br>卷': 'NO<br>FILM',
    '按下快门拍摄': 'Take a photo',
    '打开影集查看上一张': 'Open album to view the latest photo',
    '选择胶卷': 'Select film',
    '正在载入光谱胶卷': 'Loading spectral films',
    '颗粒：开': 'Grain: on',
    '颗粒：关': 'Grain: off',
    '曝光补偿': 'Exposure',
    '暗房台': 'Darkroom',
    '收起': 'Close',
    '收起暗房台': 'Close darkroom',
    '胶卷库、相纸与影集': 'Film library, paper, and album',
    '暗房分类': 'Darkroom sections',
    '相纸': 'Paper',
    '影集': 'Album',
    '二十种 spektrafilm 光谱乳剂。换卷即刻生效；负片走相纸扩印，反转片直接扫描胶片。': 'Twenty spektrafilm spectral emulsions. Film changes take effect immediately; negatives are enlarged onto paper, while reversal film is scanned directly.',
    '光谱胶片模拟': 'Spectral film simulation',
    '正在载入…': 'Loading…',
    '色彩链与数据来自': 'Color pipeline and data from',
    'SPOOLO 修改（2026）': 'SPOOLO modifications (2026)',
    '八种彩色相纸。相纸决定负片扩印后的色彩与密度响应；反转片直接扫描胶片，不经过相纸。': 'Eight color papers. Paper determines the color and density response of enlarged negatives; reversal film is scanned directly without paper.',
    '数据与算法来源': 'Data and algorithm sources',
    '数据': 'Data',
    '代码': 'Code',
    '还没有冲洗出照片': 'No photos developed yet',
    '管理': 'Manage',
    '全选': 'Select all',
    '保存所选': 'Save',
    '删除所选': 'Delete',
    '没有镜头也可以玩：导入一张底片，按快门就能走完整个冲印流程。': 'No camera? Import a negative and press the shutter to complete the full development workflow.',
    '曝光': 'Expose',
    '显影': 'Develop',
    '定影': 'Fix',
    '干燥': 'Dry',
    '正在按光谱曲线还原色彩…': 'Restoring colors with spectral curves…',
    '查看照片': 'View photo',
    '关闭灯箱': 'Close lightbox',
    '暖肤人像': 'Warm Skin Portrait',
    '保存到本地': 'Save',
    '删除': 'Delete',
    '关闭': 'Close',
    '已删除': 'Deleted',
    '撤销': 'Undo',

    '正在载入相纸…': 'Loading paper…',
    '使用中': 'In use',
    '彩色相纸': 'Color paper',
    '负片相纸': 'Negative paper',
    '电影正片': 'Cinema positive',
    '正像': 'Positive',
    '负像': 'Negative',
    'D50 观察光': 'D50 viewing light',
    '换纸会重新烘焙当前胶卷的 LUT。': 'Changing paper rebakes the current film LUT.',
    '光谱 LUT 计算失败，请换一组胶卷 / 相纸重试': 'Could not calculate the spectral LUT; try another film/paper combination',
    'LUT 计算失败 · 请换一组胶卷 / 相纸重试': 'LUT calculation failed · Try another film/paper combination',
    '正在载入光谱数据…': 'Loading spectral data…',
    '光谱数据加载失败，请刷新页面重试': 'Spectral data failed to load; refresh and try again',
    '光谱数据加载失败 · 请刷新页面重试': 'Spectral data failed to load · Refresh and try again',
    '光谱数据加载失败，请检查网络后刷新': 'Spectral data failed to load; check your connection and refresh',
    '光谱数据未就绪': 'Spectral data unavailable',
    '直接扫描': 'Direct scan',
    '反转片直接扫描，不经过相纸': 'Reversal film is scanned directly without paper',
    '光晕': 'Halation',
    '正在载入光谱胶卷…': 'Loading spectral films…',
    '反转片': 'Reversal',
    '负片': 'Negative',
    '高感乳剂': 'High-speed emulsion',
    '细粒乳剂': 'Fine-grain emulsion',
    '中速乳剂': 'Medium-speed emulsion',
    '光谱显影 + 相纸扩印': 'Spectral development + paper enlargement',
    '光谱显影 + 直接扫描': 'Spectral development + direct scan',
    '光谱数据还在载入，请稍等': 'Spectral data is still loading; please wait',
    '正在回卷，等新卷上好再拍': 'Rewinding; wait for the new roll before shooting',
    '还没有画面：先允许镜头，或导入一张底片': 'No image yet: allow camera access or import a negative',
    '浏览器不支持镜头调用': 'This browser does not support camera access',
    '手机只允许 HTTPS 调用镜头': 'Mobile devices require HTTPS for camera access',
    '镜头权限被拒绝': 'Camera permission denied',
    '没有找到摄像头': 'No camera found',
    '镜头被其他应用占用': 'Camera is in use by another app',
    '无法访问镜头': 'Could not access the camera',
    '镜头连接已断开 · 点「重试」重新连接': 'Camera disconnected · Select “Retry” to reconnect',
    '镜头已连接，画面还在缓冲…一直黑屏就点「重试」或切一下前后摄': 'Camera connected; image is still buffering… If it stays black, select “Retry” or switch cameras',
    'HEIC/HEIF 照片在当前浏览器无法解码。请在相册里导出为 JPEG（iPhone 可在分享时选「兼容性最佳」，或设置 → 相机 → 格式 → 兼容性最佳），也可以重试镜头。': 'This browser cannot decode HEIC/HEIF photos. Export as JPEG from your photo library (on iPhone, choose “Most Compatible” when sharing, or Settings → Camera → Formats → Most Compatible), or retry the camera.',
    '浏览器不支持 TIFF。请先导出为 JPEG 或 PNG，也可以重试镜头。': 'This browser does not support TIFF. Export as JPEG or PNG first, or retry the camera.',
    '浏览器不支持相机 RAW。请先在相机或修图软件里导出 JPEG，也可以重试镜头。': 'This browser does not support camera RAW. Export JPEG from your camera or editor first, or retry the camera.',
    '当前浏览器不支持 JPEG XL。请导出为 JPEG 或 PNG，也可以重试镜头。': 'This browser does not support JPEG XL. Export as JPEG or PNG, or retry the camera.',
    '大小未知': 'Unknown size',
    '未知格式': 'Unknown format',
    '这张底片读不出来 · 请换 JPEG 或 PNG': 'Could not read this negative · Try JPEG or PNG',
    '这一帧没能拍下来，请重试': 'Could not capture this frame; try again',
    '存储不可用 · 这张只在本次会话': 'Storage unavailable · This photo is session-only',
    '后摄无法用屏幕补光 · 夜拍请靠近光源或用前摄': 'The rear camera cannot use screen fill light · Move closer to a light source or use the front camera at night',
    '冲印失败，请再试一次': 'Development failed; try again',
    '本卷已拍完 · 回卷换新': 'Roll finished · Rewinding to a new roll',
    '冲洗完成，正在挂起晾干': 'Development complete; hanging up to dry',
    '存储读取失败 · 刷新重试': 'Storage read failed · Refresh to retry',
    '存储读取失败，请刷新重试': 'Storage read failed; refresh and try again',
    '存储读取异常，已使用备用读取': 'Storage read issue; fallback data used',
    '取消全选': 'Deselect all',
    '完成': 'Done',
    '保存': 'Save',
    '已打开保存菜单': 'Save menu opened',
    '打包失败，请分批保存': 'Packaging failed; save in smaller batches',
    '所选底片读不出来': 'Could not read the selected negatives',
    '撤销失败，请重试': 'Undo failed; try again',
    '这张底片读不出来，请刷新影集': 'Could not read this negative; refresh the album',
    '卷 / 张': 'Roll / Frame',
    '乳剂': 'Emulsion',
    '光谱模拟': 'Spectral simulation',
    '已触发（LED）': 'Fired (LED)',
    '已触发（屏幕）': 'Fired (screen)',
    '未触发': 'Not fired',
    '冲印时间': 'Developed at',
    '尺寸': 'Dimensions',
    '日期打印': 'Date imprint',
    '已开启': 'On',
    '未开启': 'Off',
    '请长按图片保存到相册': 'Press and hold the image to save it to Photos',
    '长按图片可保存到相册': 'Press and hold the image to save it to Photos',
    '删除失败，请重试': 'Delete failed; try again',
    '请选择一张图片': 'Choose an image',
    '这张图片是空文件，或还没有从云端下载': 'This image is empty or has not been downloaded from the cloud',
    '镜头没能启动 · 可以导入一张底片来冲洗': 'Camera could not start · Import a negative to develop it',
    '存储不可用：拍摄的照片只在本次会话': 'Storage unavailable: photos are kept only for this session',
    '镜头没能启动 · 点取景窗上的「导入底片」': 'Camera could not start · Select “Import” in the viewfinder',
    '手机浏览器只允许 HTTPS 调用镜头 · 也可以导入一张底片': 'Mobile browsers require HTTPS for camera access · You can also import a negative',
    '闪光灯：关闭': 'Flash: off',
    '闪光灯：自动': 'Flash: auto',
    '闪光灯：强制': 'Flash: forced'
  };

  function photos(n) { return Number(n) === 1 ? 'photo' : 'photos'; }
  function rolls(n) { return Number(n) === 1 ? 'roll' : 'rolls'; }
  function negatives(n) { return Number(n) === 1 ? 'negative' : 'negatives'; }

  var patterns = [
    [/^已就绪 · 33³ LUT · (\d+) 卷 \/ (\d+) 种相纸$/, function (m) {
      return 'Ready · 33³ LUT · ' + m[1] + ' films / ' + m[2] + ' papers';
    }],
    [/^正在计算 (.+) × (.+) …$/, function (m) { return 'Calculating ' + m[1] + ' × ' + m[2] + ' …'; }],
    [/^共 (\d+) 张 · (\d+) 卷$/, function (m) {
      return m[1] + ' ' + photos(m[1]) + ' · ' + m[2] + ' ' + rolls(m[2]);
    }],
    [/^已选 (\d+) 张$/, function (m) { return m[1] + ' selected'; }],
    [/^(选择第|查看第) (\d+) 张，(.+)$/, function (m) {
      return (m[1] === '选择第' ? 'Select frame ' : 'View frame ') + m[2] + ', ' + m[3];
    }],
    [/^已开始保存 (\d+) 张$/, function (m) { return 'Started saving ' + m[1] + ' ' + photos(m[1]); }],
    [/^正在打包 (\d+) 张…$/, function (m) { return 'Packaging ' + m[1] + ' ' + photos(m[1]) + '…'; }],
    [/^已打包 (\d+) 张$/, function (m) { return 'Packed ' + m[1] + ' ' + photos(m[1]); }],
    [/^已准备好 (\d+) 张$/, function (m) { return m[1] + ' ' + photos(m[1]) + ' ready'; }],
    [/^正在准备 (\d+) 张…$/, function (m) { return 'Preparing ' + m[1] + ' ' + photos(m[1]) + '…'; }],
    [/^删除所选的 (\d+) 张底片？$/, function (m) {
      return 'Delete the selected ' + m[1] + ' ' + negatives(m[1]) + '?';
    }],
    [/^已删除 (\d+) 张(?: · (\d+) 张失败)?$/, function (m) {
      return 'Deleted ' + m[1] + ' ' + photos(m[1]) + (m[2] ? ' · ' + m[2] + ' failed' : '');
    }],
    [/^已删除 (.+) #(\d+)$/, function (m) { return 'Deleted ' + m[1] + ' #' + m[2]; }],
    [/^(.+) 冲印中$/, function (m) { return 'Developing · ' + m[1]; }],
    [/^按「(.+)」的光谱曲线还原色彩…$/, function (m) {
      return 'Restoring colors with the ' + m[1] + ' spectral curve…';
    }],
    [/^已保存到本地：(.+)$/, function (m) { return 'Saved locally: ' + m[1]; }],
    [/^底片读取失败（(.+) · (.+)）。请换一张 JPEG 或 PNG；如果照片在云端，请先下载到本机，也可以重试镜头。$/, function (m) {
      var type = own.call(en, m[1]) ? en[m[1]] : m[1];
      var size = own.call(en, m[2]) ? en[m[2]] : m[2];
      return 'Could not read negative (' + type + ' · ' + size + '). Choose a JPEG or PNG; if the photo is in the cloud, download it first. You can also retry the camera.';
    }]
  ];

  function t(text) {
    var raw = String(text == null ? '' : text);
    if (language !== 'en' || !raw) return raw;
    if (own.call(en, raw)) return en[raw];
    for (var i = 0; i < patterns.length; i++) {
      var match = raw.match(patterns[i][0]);
      if (match) return patterns[i][1](match);
    }
    return raw;
  }

  function each(selector, fn) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) fn(nodes[i]);
  }

  function applyStatic() {
    document.documentElement.lang = language;
    document.title = t('SPOOLO · 一台网页里的胶片相机');
    var description = document.querySelector('meta[name="description"]');
    if (description) description.content = t('SPOOLO 是一台跑在浏览器里的 135 胶片相机：spektrafilm 光谱胶片与相纸模拟、机械快门手感、颗粒与光晕、暗房冲印。');
    each('[data-i18n]', function (node) { node.textContent = t(node.getAttribute('data-i18n')); });
    each('[data-i18n-html]', function (node) { node.innerHTML = t(node.getAttribute('data-i18n-html')); });
    each('[data-i18n-aria-label]', function (node) {
      node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria-label')));
    });
    each('[data-i18n-aria-valuetext]', function (node) {
      node.setAttribute('aria-valuetext', t(node.getAttribute('data-i18n-aria-valuetext')));
    });
    each('[data-lang-switch]', function (node) {
      var english = language === 'en';
      node.textContent = english ? '简' : 'EN';
      node.lang = english ? 'zh-CN' : 'en';
      var label = english ? 'Switch to Simplified Chinese' : '切换到英文';
      node.setAttribute('aria-label', label);
      node.title = label;
    });
  }

  function setLanguage(next) {
    language = next === 'en' ? 'en' : 'zh-CN';
    applyStatic();
  }

  S.I18N = {
    t: t,
    setLanguage: setLanguage,
    getLanguage: function () { return language; }
  };
})(window);
