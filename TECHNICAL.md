# SPOOLO 技术文档

> 适用版本：**v1.15.0**
> 面向：准备接手维护、调整色彩、增加乳剂或排查移动端问题的开发者。
> 建议阅读顺序：`README.md` → 本文第 1～3 节 → `js/films.js` → `js/gpu-develop.js` → `js/app.js` 的冲印部分。

SPOOLO 是一台纯静态的网页 135 胶片相机。没有构建步骤、没有运行时依赖，所有效果都在浏览器里现场计算。这个文档的目标是让你在改一行颜色参数之前，知道它会经过哪些像素、哪些着色器、哪些存储路径。

---

## 0. 一页地图

### 0.1 文件职责

| 文件 | 职责 |
| --- | --- |
| `index.html` | 机身 DOM、胶卷仓、控制台、暗房/影集、灯箱、冲印遮罩、Toast |
| `css/base.css` | 设计令牌、布局、机身/取景器、响应式断点、取景器 CSS 覆盖层 |
| `css/ui.css` | 旋钮、功能键、快门、胶卷卡、影集、批量条、抽屉、灯箱、Toast 等组件 |
| `js/films.js` | 27 种乳剂预设、LUT/曲线、CPU 像素管线、颗粒/光晕/bloom/暗角/漏光/闪光算法 |
| `js/gpu-develop.js` | 成片 WebGL 管线：色彩 → 亮部遮罩 → 光晕/宽 bloom 两级模糊 → 合成 |
| `js/store.js` | IndexedDB 影集存储（失败降级到内存） |
| `js/zip.js` | 桌面批量保存用的 store-only ZIP（CRC32，不压缩 JPEG） |
| `js/app.js` | 取景、快门、定时、闪光、冲印调度、影集/灯箱/批量、交互与无障碍 |
| `TECHNICAL.md` | 本文 |
| `README.md` | 用户功能、乳剂列表、运行方式、版本记录 |

脚本加载顺序是固定的（见 `index.html` 底部）：

```
films.js → store.js → gpu-develop.js → zip.js → app.js
```

`films.js` 和 `gpu-develop.js` 只向 `window.SPOOLO` 挂纯函数/工厂，不碰 DOM 结构；`app.js` 是唯一的应用编排层，所有 UI 状态都在它的 IIFE 内部，外部只能通过 DOM 和 `window.SPOOLO` 的公共接口观察。

### 0.2 一张图看完数据流

```
摄像头 <video> ──┐
导入的 <img>  ──┴─→ 取景预览 (WebGL 色彩 / Canvas2D 兜底 + CSS 暗角/漏光)
                         │
                         │ 按下快门（或定时结束）
                         ▼
                 grabFrame()：按取景框比例裁切、缩放、镜像
                         │
                         ▼
                 develop()：GPU 管线 → 失败回退 CPU 管线
                         │
                         ├─ stampDate()：Canvas2D 日期水印
                         ├─ toBlob(0.92)：成片 JPEG
                         ├─ scaledThumb()：720px 缩略图（直接缩放成片）
                         └─ Store.add()：IndexedDB（失败进内存）
                                     │
                                     ▼
                              影集 / 灯箱 / 保存 / 分享 / ZIP
```

### 0.3 设计约束

- **纯静态**：`python -m http.server` 或 GitHub Pages 即可；不要引入打包器、框架或后端。
- **无第三方运行时依赖**：字体是唯一的外部资源，且失败时必须有回退字体。
- **色彩是显示参考（display-referred）**：所有像素按 sRGB 8-bit 直接计算，不做线性化、ICC 或色域转换；这是为了让 27 种“胶片感”参数可手调、可预期，而不是做色彩管理。改管线前先接受这个前提。
- **移动优先**：主要使用场景是手机竖屏；桌面是第二布局。
- **iOS Safari 是特殊环境**：摄像头、闪光灯、分享、WebGL 上下文、IndexedDB Blob 都有各自的坑，代码里保留了多条兜底路径。

### 0.4 我想改 X，先看哪里

| 想改的东西 | 入口 |
| --- | --- |
| 某一卷的颜色 | `FILMS` 里的参数 + `buildLUT()` / `curve()`；预览用的是同一套 LUT |
| 新增一卷 | 第 4.14 节；不需要改 HTML 里的数量 |
| 颗粒 | `film.grain` + `films.js` 的 `render()` 第二遍 + `gpu-develop.js` 的 `COMP_FS` / `getNoise()` |
| 光晕 | `film.halation` + 半分辨率遮罩/模糊（4.5） |
| 取景清晰度/帧率 | `app.js` 的 `layoutPreview()` / `loop()` / `GL_FS` |
| 成片分辨率/构图 | `grabFrame()` |
| 缩略图 | `THUMB_W` / `scaledThumb()` / 第 5.4 节的旧图迁移 |
| 保存、分享、ZIP | `saveCurrent()` / `batchSave()` / `tryShare()` / `zip.js` |
| 删除、撤销、影集 | `js/store.js` + `deleteCurrent()` / `batchDelete()` |
| iPhone 取景卡死 | `wakePreview()` / `loop()` / `ensureCameraLive()` / 第 6.5 节 |
| 版本与发布 | 第 8 节；同时改顶盖、页脚、README、`?v=` |

---

## 1. 总体架构

### 1.1 三层结构

**第一层：色彩引擎（`films.js`）**

- `SPOOLO.FILMS`：27 个乳剂对象。
- `SPOOLO.buildLUT(film, ev)`：按乳剂和 EV 生成 256 级 LUT。
- `SPOOLO.render(data, w, h, film, opts)`：CPU 版完整像素管线，原地修改 RGBA `Uint8ClampedArray`。
- `SPOOLO.meters(film)`：把乳剂参数映射成 UI 上的 1–5 格指标，仅用于展示。

**第二层：GPU 加速（`gpu-develop.js`）**

- `SPOOLO.GLDevelop()`：创建一个离屏 WebGL 上下文，返回 `{ canvas, render(srcCanvas, w, h, film, opts) }`。
- 只负责成片；预览有另一套更轻的 WebGL 着色器，直接写在 `app.js` 里。
- `render()` 用布尔值报告成功/失败，不抛异常给上层；`app.js` 在失败时自动回退 CPU。

**第三层：应用编排（`app.js`）**

- 摄像头/导入源、预览循环、按下快门、定时、闪光、回卷、编号。
- 冲印遮罩、JPEG 编码、缩略图、IndexedDB 写入、影集/灯箱/批量管理。
- 抽屉、焦点陷阱、键盘快捷键、Toast、iOS 恢复逻辑。
- 所有状态集中在 IIFE 内的 `state` 和 `prefs`。

### 1.2 全局命名空间

```js
window.SPOOLO = {
  FILMS, meters, render, buildLUT,   // films.js
  GLDevelop,                          // gpu-develop.js
  Store,                              // store.js
  zipFiles                            // zip.js
};
```

`app.js` 不向 `window.SPOOLO` 暴露内部状态。调试时可以在 DevTools 里直接调用：

```js
SPOOLO.FILMS.length
SPOOLO.buildLUT(SPOOLO.FILMS[0], 0)
SPOOLO.Store.all()
SPOOLO.render(pixels, w, h, SPOOLO.FILMS[6], { ev: 0, grain: true, seed: 1 })
```

### 1.3 启动顺序

`app.js` 的 `init()` 做这些事：

1. `renderFilmList()`：生成 27 张乳剂卡，写入旋钮的 `aria-valuemax`。
2. `setFilm(prefs.film, { silent: true })`：恢复上次乳剂、写 LUT、更新预览。
3. 恢复网格/日期/声音/定时/闪光/EV/卷号/张号。
4. `bindControls()`：所有事件。
5. `refreshAlbum()`：异步读取 IndexedDB。
6. `layoutPreview()`：量取景框、设画布尺寸。
7. `requestAnimationFrame(loop)`：30fps 预览循环。
8. `startCamera('environment')`：请求摄像头；失败时挂“碰一下页面就重试”的监听。

字体加载完成后和 `window.load` 时会再次 `layoutPreview()`，避免首屏布局未稳定时把画布比例量错。

---

## 2. 状态、偏好与编号

### 2.1 `state` 关键字段

| 字段 | 含义 |
| --- | --- |
| `filmIndex` / `ev` | 当前乳剂下标；EV 以 **1/3 档** 为单位，范围 −6…+6 |
| `facing` | `environment` / `user` |
| `stream` / `live` | 当前 MediaStream 与视频是否已连接 |
| `mirror` | 前摄时预览与成片是否镜像 |
| `source` | `camera` / `file` / `none` |
| `sourceLock` | 用户已导入底片，晚到的 `getUserMedia` 结果不再覆盖它 |
| `cameraLost` | 轨道曾被系统掐断，回到相机时自动重连一次 |
| `busy` | 快门/定时/冲印占用中，阻止重入 |
| `rewinding` | 回卷动画中，快门禁用 |
| `dirty` | 非摄像头源（导入图）是否需要重画 |
| `running` | 预览循环是否处于页面可见状态 |
| `previewPixels` | Canvas2D 兜底预览的像素预算（120k–300k，自适应） |
| `shots` | 影集元数据列表（带缩略图，不带原图 Blob） |
| `current` | 灯箱里当前照片的完整行 |
| `managing` / `selected` | 批量管理模式与选中集合 |

### 2.2 `prefs` 持久化

`localStorage` 键：`spoolo.prefs.v1`

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `film` | `PT-400` | 乳剂代号 |
| `ev` | `0` | 1/3 档单位 |
| `roll` | `1` | 卷号，1–9999 |
| `frame` | `1` | 当前张号；>36 会被规范到下一卷 |
| `timer` | `0` | 0 / 3 / 10 秒 |
| `flash` | `0` | 0 关 / 1 自动 / 2 强制 |
| `grid` | `true` | 构图网格 |
| `date` | `false` | 日期打印 |
| `sound` | `true` | 合成快门声 |

`normalizePrefs()` 会收敛旧版本脏值。摄像头朝向不持久化，启动固定后摄。

### 2.3 编号与回卷

- 一卷固定 36 张（`FRAMES_PER_ROLL`）。
- `captureShot()` 在**按下快门的一刻**快照：乳剂、卷号、张号、日期开关、EV。之后换卷或改设置不会改写这一格。
- `takeShot()` 在 `grabFrame()` 成功后立即 `advanceFrame(capture)` 并 `savePrefs()`，因此即使在冲印动画中刷新/关页，下一次也不会重复使用同一个 `ROLL/#`。
- `advanceFrame()` 只有在 `prefs` 仍等于快照时才自增；如果期间用户已经手动回卷，这一格归旧卷，不会把新卷的 `#01` 顶掉。
- 第 36 张拍完自动 `rewind()`；回卷先写盘（`roll+1, frame=1`），再做 1.85s 的旋钮动画。
- 冲印/编号与真实相机一样：抓帧成功即消耗一格；如果后续 JPEG 编码失败，这一格不会退回。

---

## 3. 取景、拍摄与冲印调度

### 3.1 摄像头

`startCamera(facing)` 请求：

```js
{ audio: false,
  video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } } }
```

- 同一时刻只允许一个请求（`camStart`），避免“手势重试”和“重试按钮”并发。
- 请求返回时如果 `sourceLock` 为真（用户已导入底片），直接丢弃这条流。
- 失败时按 `NotAllowedError/NotFoundError/NotReadableError` 给出中文原因；不安全的 HTTP 环境会提示必须 HTTPS。
- 初次失败会挂 `pointerdown/keydown` 重试，最多 3 次；导入底片时立即解绑，绝不顶掉用户已选的图。
- 轨道 `ended` 时清空 `srcObject`、显示“镜头连接已断开”；关闭影集/切回前台时会尝试自动重连一次（`cameraLost`）。
- iOS 从系统弹窗/分享回来后可能暂停 video、清空 `srcObject`、静默 ended 或丢 WebGL 上下文，见第 7 节。

### 3.2 取景预览

预览有两条路径：

**WebGL（主路径）**

- 在 `#preview` canvas 上直接创建 WebGL，`powerPreference: 'low-power'`。
- 每帧把 `<video>`/`<img>` 上传为纹理，按 `coverRect()` 裁切，前摄镜像。
- 片元着色器只做：LUT → 饱和度/鲜艳度 → 阴影/高光分离调色。**不做颗粒、光晕、闪光、日期**。
- 暗角和漏光由 `frameBox` 上的 CSS 覆盖层近似：`--vig`、`--leak` 由 `applyFilmVars()` 写入；`.fx.vignette` 是径向渐变，`.fx.leak` 是左侧渐变 + `screen` 混合。
- 画布按设备 DPR 全分辨率（DPR 上限 3，像素上限约 1.4M）；预览固定 30fps（`1000/30` 节流）。
- LUT 只在乳剂或 EV 改变时重新上传（`lutKey = film.code|ev`）。

**Canvas2D（兜底）**

- WebGL 不可用、着色器编译失败或上下文丢失时，`fallback2DPreview()` 会替换 `#preview` 为 2D canvas。
- 每帧 `drawImage` 后跑一次 `SPOOLO.render()` 的**第一遍色彩**（关闭光晕/颗粒/暗角/漏光），再 `putImageData`。
- 像素预算 `state.previewPixels` 初始 180k，根据帧耗时在 120k–300k 之间调整；DPR 上限 1.5。
- 这比 GPU 慢，但保证老设备/无 WebGL 环境仍能取景。

**上下文丢失**

- 监听 `webglcontextlost`，同时每帧用 `gl.isContextLost()` 兜底检测；一旦丢失就退回 2D 并重设画布，避免 iOS 静默回收上下文后永久冻帧。

### 3.3 构图与 `grabFrame()`

- 取景框在手机竖屏是 **3:4**，横屏和桌面是 **3:2**。
- `grabFrame()` 读取取景框声明的 `getComputedStyle(frameBox).aspectRatio`，而不是预览画布的 `pw/ph`，避免首屏布局未稳定时把照片裁成错误长宽。
- 用 `coverRect()` 从源画面中心裁出该比例（`object-fit: cover` 语义），再缩放：
  - 横构图：`W = min(1920, crop.w)`，`H = W / ratio`
  - 竖构图：`H = min(1920, crop.h)`，`W = H * ratio`
- 典型输出：
  - 手机竖屏摄像头：**1080 × 1440**
  - 横屏/桌面摄像头：**1920 × 1280**
  - 导入小图：不放大，按源图尺寸出片（如 300×400）
- 前摄在 `drawImage` 前镜像。
- `grabFrame()` 返回 `{ canvas, W, H, ctx }`；这张 canvas 从未被冲印过，是原始裁切画面。

### 3.4 冲印调度与遮罩

`takeShot()` → `openProcessing(film, work)`：

1. 显示遮罩，标题按工艺显示“C-41 冲印中 / E-6 冲印中 / 黑白显影中”。
2. 先等 40ms 让遮罩画出来，再启动 `work()`，避免首帧卡住。
3. 四步“曝光 / 显影 / 定影 / 干燥”的进度条固定 500ms；它只是视觉节奏，**不对应真实的分阶段计算**。
4. 动画结束后每 60ms 检查 `work()` 是否完成；完成后等 100ms 收起遮罩。
5. 普通拍摄实测按快门到完成约 **0.65–0.7s**，其中固定动画占主要部分；闪光拍摄会额外等待摄像头 AE（约 160–460ms），可能多取一帧。

`work()` 内部顺序：

```
develop()（GPU/CPU） → toBlob(0.92) → scaledThumb() → Store.add() → 返回 frame
```

失败路径：JPEG 为空 → `jpeg-encode-failed`；冲印异常 → Toast“冲印失败”；存储失败 → 照片进入内存列表并提示“存储不可用 · 这张只在本次会话”。

### 3.5 定时与闪光

**定时**（`prefs.timer`）

- 0 / 3 / 10 秒循环。
- `runCountdown()` 禁用快门并显示大数字；`cancelCountdown()` 恢复。
- 回卷、打开灯箱、把定时切回“关”都会取消倒计时。
- 倒计时结束后才 `captureShot()`，所以期间改乳剂/日期/闪光会作用于最终这一张。

**闪光**（`prefs.flash`）

- 0 关 / 1 自动 / 2 强制。
- 自动档用 48×36 离屏画布采样当前源的平均亮度，低于 `0.42` 触发。
- 如果 `track.getCapabilities().torch` 存在（多为 Android Chrome），通过 `applyConstraints({advanced:[{torch:true}]})` 点 LED；LED 保持点亮，约 200ms 后抓第一帧。若画面中心亮度仍低于 `0.12`，约 300ms 后再抓一帧，选更亮的一帧，然后关 LED。
- 没有 torch 时触发全屏 `.flash-fx` 白屏补光。白屏动画 720ms，前 70% 保持全亮；约 160ms 抓第一帧，若中心仍暗，约 300ms 后再抓一帧（此时白屏仍然亮着），选更亮的一帧。
- 每帧的亮度用 48×36 离屏画布采样；抓帧补救只看画面中心 50%，避免“暗背景 + 亮主体”被整体拉爆。
- 如果闪光后最亮的一帧中心仍低于 `0.12`，在 `develop()` 前按 `log2(0.18 / luma)` 补回最多 **+4EV**（只用于冲印，不写进底片元数据）。这是软件提亮，不是真实补光。
- 后摄 + 屏幕补光时，屏幕在手机背面，物理上无法照亮前方的场景。检测到这种情况且画面仍暗，会显示一次提示，建议靠近光源或用前摄。硬件 LED 路径不受此限制。
- iPhone 的“减少动态”会把通用动画压到 0.01ms；`.flash-fx.firing` 有专门覆盖，保持稳定白屏，否则屏幕补光会瞬间消失。
- 成片里的闪光量：屏幕补光 `1.0`，硬件 LED `0.35`（只在成片中心留一点暖光）。
- `flashKind` 会写进底片信息（`torch` / `screen`）。

### 3.6 回卷

- 满 36 张自动回卷；顶盖 REWIND 按钮单击手动回卷。
- 回卷立即把 `roll+1 / frame=1` 写入 localStorage，再做动画。
- 动画期间快门禁用，计数显示 `--`。
- 回卷不删除影集，只改变下一张的卷号/张号。

---

## 4. 色彩管线（核心）

这一节是接力开发最重要的部分。所有效果都建立在“8-bit、sRGB、显示参考”的约定上。

### 4.1 色彩空间与数值约定

- 源像素：`<video>`/`<canvas>` 的 RGBA 8-bit，通道 0–255。
- CPU 管线：`Uint8ClampedArray`，中间值按 0–255 浮点计算，写入时钳制。
- GPU 管线：纹理采样归一化到 0–1，片元着色器最后 `clamp(col, 0, 1)`。
- LUT：256 个输入级 → 256 个输出级，存为 768 字节的三通道数组（黑白为 256 字节单通道）。
- 亮度统一使用 Rec.709 权重：

```js
luma = r*0.2126 + g*0.7152 + b*0.0722
```

- **不进行线性化/去 gamma**。所有对比、饱和、混合都直接在显示空间做。这意味着：
  - 参数组合是“看起来对”的经验值，不是物理光照模型；
  - 调整某个乳剂时，直接看取景/成片，不要按线性光公式推导；
  - 若未来要引入线性工作流，必须同时重调全部 27 个预设，不能只改一处。

### 4.2 乳剂参数模型

每个 `FILMS` 对象的结构：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `code` | string | 乳剂代号，如 `PT-400`；也是 LUT 缓存键的一部分 |
| `name` / `en` | string | 中文/英文展示名 |
| `process` | `C-41` / `E-6` / `B&W` | 冲印标题、卡片标签 |
| `iso` | number | 展示与边码 |
| `note` | string | 胶卷卡说明 |
| `tone` | CSS color | 胶卷卡/暗盒的色块 |
| `bw` | boolean | 黑白乳剂；此时色彩字段用标量 |
| `contrast` | `[r,g,b]` 或 number | 围绕 0.5 的对比度 |
| `lift` | `[r,g,b]` 或 number | 黑位抬升/压低，0–1 域 |
| `gamma` | `[r,g,b]` 或 number | gamma 幂 |
| `gain` | `[r,g,b]` 或 number | 增益，约 0.9–1.1 |
| `shoulder` | 0–1 | 高光肩部起点，0.66–0.82；越大高光越亮、滚降越晚 |
| `sat` | number | 饱和度倍率；黑白为 0 |
| `vibrance` | number | 鲜艳度，低饱和像素获得更多提升 |
| `shadowTint` | `[r,g,b]` | 阴影区通道微调，单位是 0–1 域（内部 ×255） |
| `highTint` | `[r,g,b]` | 高光区通道微调 |
| `halation` | object? | `{ amount, radius, threshold, color }`；黑白通常没有 |
| `grain` | object | `{ amount, size, shadow }` |
| `vignette` | number | 暗角强度 0–1 |
| `leak` | number | 漏光强度 0–1 |

彩色乳剂的 `contrast/lift/gamma/gain` 是三元数组，黑白是标量。所有乳剂的 `grain.size` 目前都是 1（v1.11.8 起）。

### 4.3 曲线与 LUT

`buildLUT(film, ev)` 对每个输入级 `i`：

```js
x = (i / 255) * Math.pow(2, ev);           // EV 先折进输入
y = (x - 0.5) * contrast + 0.5 + lift;      // 对比 + 黑位
if (y < 0) y = 0;

// 高光肩部：超过 shoulder 后用 tanh 平滑压缩
if (y > shoulder) {
  y = shoulder + (1 - shoulder) *
      Math.tanh((y - shoulder) / (1 - shoulder));
}

if (gamma !== 1) y = Math.pow(y, gamma);    // gamma
y *= gain;                                  // 通道增益
clamp(y, 0, 1);
```

- 彩色：R/G/B 各自跑一遍，写入 `lut[i]`、`lut[i+256]`、`lut[i+512]`。
- 黑白：先把源像素转 luma，再用单通道 `mono[i]`。
- **EV 是折进 LUT 的**：`ev` 单位是“档”，`state.ev/3`。±2EV 对应 `2^±2` 的输入缩放。
- LUT 缓存的键是 `film.code + '|' + ev.toFixed(2)`。乳剂参数是静态的；如果运行时改 `FILMS` 里的参数，必须刷新页面或清掉缓存，不能热改。
- 256 级 LUT 在平滑渐变上可能出现轻微 banding；当前没有加 dithering。如果以后加入，应在 LUT 生成或最终合成阶段处理。

### 4.4 第一遍：色彩

对每个像素：

**黑白乳剂**

```js
l = r*0.2126 + g*0.7152 + b*0.0722;
r = g = b = mono[l | 0];
```

**彩色乳剂**

```js
r = lut[r]; g = lut[g + 256]; b = lut[b + 512];

// P1 串扰矩阵（行优先，行和为 1；默认值）
r2 = 1.0000*r + 0.0225*g - 0.0225*b;
g2 = -0.0150*r + 1.0000*g + 0.0150*b;
b2 = 0.0100*r - 0.0100*g + 1.0000*b;
r = clamp(r2, 0, 255); g = clamp(g2, 0, 255); b = clamp(b2, 0, 255);

// 基础饱和 / 鲜艳度
lum = r*0.2126 + g*0.7152 + b*0.0722;
mx = max(r,g,b); mn = min(r,g,b);
s = sat + vibrance * (1 - (mx - mn) / 255);
r = lum + (r - lum) * s;
g = lum + (g - lum) * s;
b = lum + (b - lum) * s;

// 色相相关饱和度（只缩放色度，不动亮度和色相）
mx = max(r,g,b); mn = min(r,g,b); c = mx - mn;
if (c > 0.0255) {
  h = hue(r,g,b);                    // 0…2π，红=0，绿=2π/3，蓝=4π/3
  w = 1 + hueSat * (0.035*cos(h - 0.60) + 0.014*cos(2h - 2.40));
  w = clamp(w, 0.5, 1.5);
  lum = r*0.2126 + g*0.7152 + b*0.0722;
  r = lum + (r - lum) * w;
  g = lum + (g - lum) * w;
  b = lum + (b - lum) * w;
}
```

串扰矩阵的含义：

- 三个通道不再各走各的 LUT，而是互相吸收一点，模拟染料层的非理想吸收/扫描串色。
- 每一行系数之和为 1，因此纯灰 `r=g=b` 经过矩阵后不变；如果你新增矩阵，先保证这一点，否则整张照片会偏色。
- 默认矩阵很轻（交叉项 0.01–0.0225）：红/绿互相拉近，蓝向青绿偏一点，肤色更暖、绿色更沉。乳剂可用 `matrix: [9 个数字]` 覆盖。
- 矩阵输出要钳制到 0–255 再进饱和度，否则负通道会把后续 luma 和色相计算带偏。

色相饱和度的含义：

- 只改变色度，不改变色相；`hueSat` 默认 1，乳剂可用 `hueSat: 0` 关闭或 `0.5` 减半。
- 默认曲线抬暖黄/肤色（h≈0.6 rad）、收青绿；第二个谐波负责让过渡更自然，不是三个硬分段。
- CPU 预生成 512 级权重表（`hueTable`），避免每个像素两次 `cos`；GPU 使用同一条解析式。两者在 0.7° 的量化误差内一致。
- 黑白乳剂跳过矩阵和色相饱和度，避免给灰阶引入无意义的颜色。

饱和度公式的含义：

- `sat` 给出基础饱和度；
- `vibrance` 按当前像素的“色度跨度”加权：灰暗/低饱和的像素得到更多提升，已经很艳的像素提升较少，避免肤色/高光过曝。

**分离调色**（黑白也会执行，虽然黑白预设的 tint 很接近中性）：

```js
nrm = lum / 255;
shw = 1 - nrm;  hiw = nrm;
r += st0*shw + ht0*hiw;   // st0 = shadowTint[0]*255
g += st1*shw + ht1*hiw;
b += st2*shw + ht2*hiw;
```

这一步就是“青绿阴影、暖高光”等乳剂性格的来源。tint 数值很小（约 −0.012…+0.05），改动时以 0.002 为步进试。

矩阵和色相曲线的默认值都在 `films.js` 的 `COLOR_MODEL`，通过 `SP.colorModel(film)` 同时提供给 CPU、GPU 与取景预览；改默认值会影响全部彩色乳剂，只想调某一卷就用乳剂上的 `matrix` / `hueSat` 覆盖。`SP.COLOR_MODEL` 是可变的，调试时可以在控制台直接改，下次 render 立即生效。

**高光去饱和与白点抬升**（彩色乳剂；黑白跳过第一项）：

```js
nrm = lum / 255;
hl  = smoothstep(0.62, 1.0, nrm);
ds  = hl * (film.highlightDesat ?? 0.28);
r += (lum - r) * ds;  g += (lum - g) * ds;  b += (lum - b) * ds;

nrm = lum / 255;
hl2 = smoothstep(0.62, 1.0, nrm);
wl  = hl2 * 0.03;
r += (255 - r) * wl;  g += (255 - g) * wl;  b += (255 - b) * wl;
```

- `highlightDesat` 默认 0.28，可在乳剂上覆盖；黑白乳剂强制为 0。
- 越接近白，颜色越向自身亮度收拢，模拟高光处染料先耗尽、最后只剩乳剂/片基的白。
- 白点抬升固定 3%，只影响最亮部，让高光“透气”，不改变中间调。
- 取景预览的 `GL_FS` 与 CPU 第一遍都实现了这两步；`drawPreviewGL` 必须在 `uploadLut()` 之前 `useProgram(glProg)`，否则 `uHiDesat` 会写到别的程序上。

第一遍还会同时生成亮部遮罩，供 halation 与全局 bloom 共用（见 4.5）。写入前钳制到 0–255。

### 4.5 光晕 halation 与全局 bloom

两者共享同一张亮部遮罩，但用两个不同的模糊半径：halation 紧贴高光、带乳剂颜色；bloom 更宽、更中性，模拟镜头/扫描仪的光学扩散。黑白乳剂没有 halation，但仍会走 bloom。

**亮部遮罩**

对第一遍后的像素（已包含高光去饱和/白点抬升）取 luma `nrm`：

```js
m = nrm > threshold ? (nrm - threshold) / (1 - threshold) : 0;
m = m * m;          // 平方让高光更集中
```

- `threshold`：乳剂有 `halation` 时用 `halation.threshold`，否则用 0.72。
- CPU：写入半分辨率遮罩（每 2×2 源像素取一个），值 0–255。
- GPU：在 `BRIGHT_FS` 里对全分辨率色彩纹理采样，输出到半分辨率 FBO，值 0–1。

**第一级模糊（halation）**

- CPU：`boxBlur(mask, hw, hh, radius/2, 2)`，两遍水平+垂直盒式模糊。
- GPU：9-tap 高斯核，两轮水平和垂直 ping-pong；采样步长 `step = round(radius/2)/4`，采样偏移 −4…+4 个 `step`。权重为：

```
0.0162, 0.0540, 0.1216, 0.1946, 0.2270,
0.1946, 0.1216, 0.0540, 0.0162
```

**第二级模糊（全局 bloom）**

- CPU：复制第一级模糊后的遮罩，`boxBlur(maskBloom, hw, hh, max(3, min(hw,hh)/60), 2)`。
- GPU：把第一级结果 copy 到 `maskC`，再用同样的 9-tap 核、更大步长 `max(3, min(HW,HH)/60)/4` 做两轮 ping-pong。
- 半径与分辨率挂钩，因此 1080×1440 和 1920×1280 成片的视觉扩散比例接近。
- 默认 `amount`：彩色 0.12，黑白 0.10；默认颜色：彩色 `[1, 0.96, 0.90]`，黑白纯白。单个乳剂可以用 `film.bloom = { amount, color }` 覆盖。

**合成**

```js
m  = blurredMask * haloAmount;
c  = 1 - (1 - c) * (1 - m * haloColor);     // halation：橙红 screen

mb = bloomMask * bloomAmount;
c  = 1 - (1 - c) * (1 - mb * bloomColor);   // bloom：暖白 screen
```

- `threshold` 越低，越多高光参与光晕；`radius` 越大，晕染越宽；`amount` 越大，颜色越明显。
- 乳剂对象没有 `halation` 时，只有 bloom；`bloom` 永远开启（由 `develop()` 传入 `bloom: true`）。
- 光晕颜色通常是橙红 `[1, 0.35~0.5, 0.22~0.40]`；夜景乳剂会把 radius/amount 拉大。
- bloom 会明显抬高白色物体周围的灰场亮度；如果调整了模糊半径，先检查纯白块与灰底的边缘，不要只看照片缩略图。
- 取景预览不包含 halation/bloom，这是有意的：预览要轻、要快。

### 4.6 颗粒 grain

目标是“银盐结块”而不是电视雪花：细粒提供质地，低频团块提供起伏；振幅按亮度加权并软限幅；黑白必须单色，彩色以亮度颗粒为主。v1.14.0 重写了这一层。

**CPU：细粒 hash + 低频 value noise**

`films.js` 用 `Math.imul` 生成稳定的 32 位噪声：

```js
function hash(x, y, seed) {
  var n = Math.imul(x, 1619) ^ Math.imul(y, 31337) ^ Math.imul(seed, 6971);
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  n ^= n >>> 15;
  return (n >>> 0) / 2147483647.5 - 1;   // -1 … +1
}
```

低频层用同一个 hash 作为格点，做双线性 value noise：

```js
nC = valueNoise(gx / coarseScale, gy / coarseScale, seedC) * coarseAmt;
```

振幅与权重：

```js
gAmt = grain.amount * (grainScale || 1) * 255 * 0.70;
ga = gAmt
   * (0.62 + 0.62 * sin(PI * luma))          // 中间调最强
   * (1 + grain.shadow * (1 - luma))          // 暗部增益
   * (1 - 0.35 * smoothstep(0.72, 1, luma));  // 高光收敛
if (ga > 32) ga = 32 + (ga - 32) * 0.35;      // 软限幅，0–255 域

n1 = hash(gx, gy, seedA);
n2 = hash(gx + 53, gy + 97, seedB);           // seedB = seed*7 + 13
nFine = n1 * 0.78;

// 黑白：单色
n = nFine + nC;
r += n * ga;  g += n * ga;  b += n * ga;

// 彩色：亮度主导，弱通道差
nL = nFine + nC;
nCh = n2 * 0.30;
r += (nL + nCh * 0.55) * ga;
g += (nL - nCh * 0.10) * ga;
b += (nL - nCh * 0.55) * ga;
```

- `coarseScale` 默认按 ISO：≥1600 → 5，≥800 → 4，≥400 → 3，更低 → 2。
- `coarseAmt` 默认：≥800 → 0.55，≥400 → 0.50，更低 → 0.38；乳剂可用 `grain.coarse` / `grain.coarseScale` 覆盖。
- `grain.size > 1` 时细粒坐标会先除以 size；目前 27 种乳剂都是 1px。
- 软限幅保证高感卷仍然粗，但不会把画面打成纯噪声。
- 颗粒是**每张照片随机种子**（拍摄时生成），同一卷每张纹理不同。
- 颗粒在成片分辨率上生成；缩略图直接从成片缩放，图案同源，不再二次生成。

**GPU：512×512 噪声纹理 + 两个采样器**

早期 GPU 版本用浮点 hash，屏幕坐标变大后会出现周期/网格，现在改为预生成纹理：

- CPU 用 `hashNoise()` 生成 512×512 RGBA：R/G/B 三套独立 seed，A=255。
- 两份纹理对象共享同一份数据：`NEAREST` 给细粒，`LINEAR` 给低频团块（`uNoiseSoft`）。
- 合成着色器按 `floor(px / grainSize)` 采样细粒，按 `px / (grainSize * coarseScale)` 采样软噪声：
  - `n1 = nA.r*2-1`，`n2 = nA.b*2-1`
  - `nC = uNoiseSoft.g*2-1`
- `uNoiseOff` 由每张照片的 `seed` 决定，避免同一卷不同照片纹理完全相同。
- 512 纹理直接平铺会让颗粒每 512px 精确重复。着色器按 `floor(gp/512)` 给每个纹理块加不同的**整数位移**（细粒和低频各一套），把平铺周期打散；位移只重排随机像素，不改变分布，也不会在块边界产生接缝。CPU 的 hash 不存在平铺，无需处理。
- 实测 1080×1440 灰场，细粒在 x 方向相隔 512px 的 high-pass 相关系数从 0.976 降到 ~0.00。
- 通道混合与 CPU 完全一致：

```glsl
float nL = n1 * 0.78 + nC * uGrainCoarseAmt;
float nCh = n2 * 0.30;
if (uGrainMono > 0.5) c += vec3(nL * ga);
else {
  c.r += (nL + nCh * 0.55) * ga;
  c.g += (nL - nCh * 0.10) * ga;
  c.b += (nL - nCh * 0.55) * ga;
}
```

- 振幅在 0–1 域做同样的 0.70 缩放与软限幅（阈值 0.125）。
- `uGrainMono` 由 `film.bw` 决定；黑白不会再出现 R/G/B 各自独立的彩色颗粒。

**为什么取景里看不到颗粒？**

颗粒只在成片时加入，取景只保留色彩、暗角和漏光。这样预览更干净，也少一层逐像素开销。预览与成片的颗粒**不是**所见即所得，这是有意的。

### 4.7 暗角 vignette

```js
// d = 像素到中心的距离 / 半对角线长度
f = 1 - vignette * smoothstep(0.45, 1.02, d);
r *= f; g *= f; b *= f;
```

- `smoothstep(0.45, 1.02, d)`：中心 45% 以内完全不压暗，边缘平滑过渡，超过 1.02 全强度。
- CPU 用 `dx=(x-cx)/normR`、`dy=(y-cy)/normR`；GPU 用像素坐标和 `uRes` 计算，等价。
- 暗角在颗粒之后、漏光/闪光之前。

### 4.8 漏光 leak

漏光是一条从左侧进入的暖色光带，垂直方向在画面 34%–94% 高度之间渐隐：

```js
// 垂直系数：34% 以上最强，94% 以下为 0
leakV = smoothstep(0.94*h, 0.34*h, y) * leak;

// 水平系数：左边缘最强，向右按 1.6 次幂衰减
lf = leakV * pow(1 - x/w, 1.6) * 255;

r += lf;
g += lf * 0.42;
b += lf * 0.10;
```

- CPU 预计算每一列的 `pow`，避免在像素循环里重复算。
- GPU 用 `uLeakTop = 0.34*H`、`uLeakBot = 0.94*H`，`vUv.x` 从左侧起算，公式一一对应。
- `LC-800`、`AV-200`、`NS-800`、`FL-200` 带漏光；其他乳剂为 0。

### 4.9 闪光 flash

成片里的闪光是一个中心暖色径向叠加，和取景时的整屏白闪是两件事：

```js
fw = 1 - smoothstep(0.12, 0.92, d);
fa = fw * flashAmount * 56;    // CPU 在 0–255 域；GPU 用 56/255 归一化

r += fa;
g += fa * 0.94;
b += fa * 0.86;
```

- 屏幕补光：`flashAmount = 1.0`，保留完整模拟。
- 硬件 LED：`flashAmount = 0.35`，因为 LED 已经真实照亮过场景，成片里只留一点暖调。
- 闪光后仍然很暗时的 **救援曝光** 不属于这个叠加公式：它在 `develop()` 的 `ev` 上加最多 +4EV，发生在 LUT 之前，见 3.5。
- 自动闪光的亮度采样和触发时序见 3.5。

### 4.10 完整合成顺序

两套管线的顺序必须保持一致：

```
1. 输入曝光（EV → LUT 输入）
2. 分通道 LUT / 黑白 LUT
3. 3×3 串扰矩阵（彩色，行和为 1）
4. 饱和度 / 鲜艳度（彩色）
5. 色相相关饱和度（彩色）
6. 阴影 / 高光分离调色
7. 高光去饱和 / 白点抬升（彩色去饱和；两者共同抬白点）
8. 生成亮部遮罩（halation + bloom 共用）
9. 光晕 halation（screen）
10. 全局 bloom（screen，更宽的第二级模糊）
11. 颗粒 grain（按亮度加权，软限幅）
12. 暗角 vignette（乘法）
13. 漏光 leak（加法）
14. 闪光 flash（加法）
15. clamp 0…1
16. 日期水印（Canvas2D，在管线之外）
```

### 4.11 CPU 与 GPU 的差异

| 环节 | CPU (`films.js`) | GPU (`gpu-develop.js`) | 差异 |
| --- | --- | --- | --- |
| LUT | `buildLUT` 数组 | 同一 `buildLUT` 上传为 256×1 纹理 | 理论一致；8-bit 纹理采样 |
| 饱和/鲜艳度 | 0–255 域 | 0–1 域 | 公式相同 |
| 串扰矩阵 | 0–255 域，3×3，clamp | 0–1 域，`uM0..uM2` | 公式相同；GPU 用 `dot` |
| 色相饱和度 | 512 级权重表 | 解析 `cos` | 0.7° 量化误差内一致 |
| 分离调色 | 0–255 域 | 0–1 域 | 公式相同 |
| 高光去饱和/白点 | `smoothstep(0.62,1)`，0–255 域 | 同一公式，0–1 域 | 一致 |
| 亮部遮罩 | 半分辨率，平方阈值 | 半分辨率，平方阈值 | 一致 |
| halation 模糊 | 两遍盒式模糊 | 两轮 9-tap 高斯 | 形状略有差异 |
| bloom 第二级模糊 | 复制遮罩后更大半径的两遍盒式模糊 | `maskC` + 更大步长的两轮 9-tap | 半径都按 `min(halfW,halfH)/60` 缩放 |
| 颗粒 | `Math.imul` 细粒 + value noise 团块 | 512 噪声纹理（NEAREST + LINEAR），双尺度 | 权重、软限幅一致；采样方式不同 |
| 颗粒彩色混合 | 亮度主导，弱通道差 | 同一权重 | 一致 |
| 暗角/漏光/闪光 | 逐像素公式 | 同一公式的 shader | 一致 |
| 精度 | JS 浮点 + 8-bit 写回 | highp（可用时），8-bit FBO | GPU 略平滑 |
| 日期 | Canvas2D | 无（由 app.js 统一叠加） | 一致 |

结论：**GPU 是主路径，CPU 是兜底；两者不会像素级完全相同，但颜色方向、颗粒振幅和空间效果应一致。** 修改任何一个效果，都要同步检查另一个。v1.14.0 的实测（1080×1440）：同一灰场的颗粒 high-pass RMS 在 CPU/GPU 间差 <0.1，黄块高光饱和度差 <0.001；bloom 环带亮度因模糊核不同有 1–2 级差异。v1.15.0 加入 P1 后，CPU 彩色成片在测试机上约 200ms（P0 约 170ms，+18%），黑白因为跳过矩阵/色相基本不变（约 190ms vs 170ms，波动范围内）；色相权重表把逐像素 `cos` 换成了查表。P1 的 CPU/GPU 黄块高光饱和度差约 0.008（绝对），来自 512 级色相表量化和 JPEG 色度抽样，肉眼不可分。

### 4.12 取景预览与成片的对应关系

| 内容 | 取景预览 | 成片 |
| --- | --- | --- |
| LUT / EV / 饱和 / 鲜艳度 / 分离调色 | 有（GPU shader 或 2D `render` 第一遍） | 有 |
| 3×3 串扰 / 色相饱和度 | 有（`GL_FS` 或 2D `render` 第一遍） | 有 |
| 高光去饱和 / 白点抬升 | 有 | 有 |
| 裁切 / 镜像 | 有（`uCrop` / `mirror`，或 2D 裁切） | `grabFrame` 已裁好并镜像 |
| 光晕 halation | 无 | 有 |
| 全局 bloom | 无 | 有 |
| 颗粒 grain | 无 | 有 |
| 暗角 vignette | CSS 径向渐变近似 | 逐像素径向 |
| 漏光 leak | CSS 左侧渐变近似 | 逐像素光带 |
| 闪光 | 触发时全屏白闪 | 中心暖光叠加 |
| 日期打印 | 无 | 有 |
| 分辨率 | DPR 全分辨率（上限 1.4M 像素），30fps | 长边 1920，按一次快门冲印 |
| 管线 | 实时轻量 | 完整 GPU/CPU |

这就是为什么“取景看起来”和“成片”可能略有不同，尤其是颗粒、halation 与 bloom。调整乳剂颜色时，最好同时看取景和成片。

### 4.13 分辨率与缩略图

- 成片长边上限 1920：
  - 竖屏 1080×1440
  - 横屏/桌面 1920×1280
  - 导入小图不放大
- 缩略图 `THUMB_W = 720`，从**冲印完成的成片**直接 `drawImage` 缩放，不再二次跑乳剂管线，也不再二次计算颗粒。
- 缩略图 JPEG 质量 0.8；帧记录 `thumbW` 标记实际宽度。
- 旧版本底片没有 `thumbW`，打开影集时会在后台逐张从原图重建为 720px，并写回 IndexedDB；`Store.update` 先读后写，重建期间被删除的照片不会被写回。
- 720px 的选择：影集格子约 165 CSS × DPR3 ≈ 495 设备像素，720 会被浏览器略缩小；灯箱约 282 CSS × DPR3 ≈ 846 设备像素，从 1080 略缩小。两者缩小倍率接近，颗粒图案同源。

### 4.14 新增一种乳剂

1. 在 `js/films.js` 的 `FILMS` 数组里追加对象。彩色乳剂示例：

```js
{
  code: 'XX-400', name: '示例乳剂', en: 'EXAMPLE', process: 'C-41', iso: 400,
  note: '一句话风格说明。',
  tone: '#b08a70',
  contrast: [1.00, 1.00, 1.00],
  lift: [0.015, 0.015, 0.015],
  gamma: [1.00, 1.00, 1.00],
  gain: [1.00, 1.00, 1.00],
  sat: 1.05, vibrance: 0.12,
  shadowTint: [0, 0.004, 0.008], highTint: [0.012, 0.004, 0],
  shoulder: 0.72,
  halation: { amount: 0.12, radius: 8, threshold: 0.75, color: [1, 0.45, 0.28] },
  grain: { amount: 0.050, size: 1, shadow: 1.6 },
  vignette: 0.20, leak: 0
  /* 以下均可省略，省略时用全局默认：
     highlightDesat: 0.28,
     matrix: [1.000, 0.0225, -0.0225, -0.015, 1.000, 0.015, 0.010, -0.010, 1.000],
     hueSat: 1,
     bloom: { amount: 0.12, color: [1, 0.96, 0.90] },
     grain.coarse: 0.50, grain.coarseScale: 3 */
}
```

2. 黑白乳剂加 `bw: true`，把 `contrast/lift/gamma/gain` 写成标量，不写 `sat/vibrance/halation`；`highlightDesat` 会被强制为 0，矩阵和色相饱和度也会跳过，颗粒自动变单色，bloom 仍默认开启（0.10、白色）。
3. 胶片数量会自动更新：`renderFilmList()` 设置 `#filmCount`，旋钮的 `aria-valuemax` 也按 `FILMS.length` 写；不需要改 HTML 里的 27。
4. 更新 `README.md` 的乳剂表和版本号；同步顶盖/页脚/`?v=`。
5. 用至少这些素材测试：灰卡（看颗粒和 banding）、肤色（看低饱和/高光）、蓝天（看分通道 LUT）、霓虹（看 halation/漏光）、黑白（看 luma 曲线）。
6. 同时看取景和成片；再禁用 WebGL 检查 CPU 兜底。

调参建议：

- 先调 `contrast/lift/gamma/gain` 到整体明暗和反差满意；
- 再用 `shoulder` 控制高光滚降；
- 用 `sat/vibrance` 定饱和度，不要用 gain 硬拉饱和；
- 用 `shadowTint/highTint` 做乳剂性格，步进 0.002–0.005；
- 用 `matrix` 做乳剂级串色，先用 0.005–0.02 的交叉项试；每行之和保持 1，否则灰会偏色；
- 用 `hueSat`（0–1.5）做色相饱和度，默认 1；调整 `COLOR_MODEL.hue` 的余弦系数前先看肤色、绿色和蓝色三块色卡；
- 用 `highlightDesat`（0.15–0.35）控制高光收色，用 `bloom.amount`（0.08–0.16）控制辉光；
- 最后加 halation/grain/vignette/leak，避免空间效果掩盖颜色问题；
- 颗粒先看灰卡：`grain.amount` 定总体，`grain.shadow` 定暗部，`grain.coarse` / `coarseScale` 定团块；不要用提高 amount 来解决“看起来像数码噪点”，那通常是细粒过多或彩色通道差过强。

### 4.15 修改或新增一个空间效果

必须同时改两处：

1. **CPU**：在 `films.js` 的 `render()` 第一遍/第二遍里实现，保持顺序。
2. **GPU**：在 `gpu-develop.js` 的对应着色器（`COLOR_FS` / `BRIGHT_FS` / `BLUR_FS` / `COMP_FS`）或新增 pass；在 `render()` 里设置 uniform、绑定纹理、按顺序 draw。
3. 如果这个效果也要出现在取景里，再改 `app.js` 的 `GL_FS`/`drawPreview2D` 和 CSS 覆盖层；否则明确写进“取景不包含”。
4. 两套管线的数值域要换算清楚：CPU 0–255 vs GPU 0–1。
5. 保持合成顺序与第 4.10 节一致，否则 GPU/CPU 会出现色差。
6. 在 WebGL 不可用、WebGL 上下文丢失、动画帧异常三种情况下验证 CPU 兜底。

### 4.16 色彩管线常见坑

- **把 sRGB 当线性光**：整套参数是按显示空间调的；擅自加 `pow(2.2)` 会让全部乳剂发灰/偏色。
- **只改 GPU 或只改 CPU**：用户在无 WebGL 设备上会看到另一套颜色。
- **改 LUT 却不清缓存**：`lutCache` 的键只有 `code|ev`，热改乳剂参数不会生效；刷新页面。
- **饱和度过高导致色相偏移**：饱和是围绕 luma 拉伸，极端值会削顶；用 vibrance 而不是无限加 sat。
- **矩阵行和不为 1**：中性灰会被染色；任何新矩阵先跑 50% 灰块，确认 R/G/B 仍然相等。矩阵输出要 clamp 后再算亮度/色相。
- **色相饱和度不是万能调味**：曲线过强会让相邻色相出现“色带”或不自然的肤色；CPU 用 512 级表、GPU 用解析式，改系数后两边都要看。
- **halation threshold 不要设 1**：`(nrm - threshold)/(1 - threshold)` 会除零；保持在 0.5–0.85。
- **颗粒网格/重复**：GPU 不要退回浮点大坐标 hash；使用 512 噪声纹理 + 双尺度采样，并且必须按 512 块加整数位移。少了这一步，灰场上每隔 512px 会出现同一片颗粒（即使肉眼不易察觉，放大或做相关性分析会很明显）。
- **颗粒像数码噪点**：先检查是不是细粒权重太高、彩色通道差太大，或者 ga 没有软限幅；不要只靠降低 `amount`。
- **颗粒尺寸与分辨率**：1px 细粒在 1920 成片和 720 缩略图上的物理大小不同；缩略图直接缩放，不要再生成一遍颗粒。
- **bloom 与 halation 共用遮罩**：改 `halation.threshold` 会同时改变 bloom 的覆盖范围；如果只想调 bloom，优先改 `bloom.amount`，不要动阈值。
- **预览与成片不一致**：确认效果是否本来就不在预览里（颗粒/光晕/bloom/闪光/日期）。
- **Y 轴方向**：GPU 源纹理 `UNPACK_FLIP_Y_WEBGL = true`；漏光/日期/坐标方向容易在这里搞反。
- **日期水印**：在管线外由 Canvas2D 叠加，使用冲印时的系统日期；拍摄跨午夜时可能与快门时间差一天。
- **8-bit LUT banding**：极端渐变可能出现台阶；需要时在 LUT 或合成阶段加 dither，但会改变现有观感。

---

## 5. 存储、影集与导出

### 5.1 IndexedDB

- 数据库：`spoolo`，版本 1
- 对象仓库：`frames`，`keyPath: 'id'`，索引 `ts`
- 缩略图也存同一行；列表只读元数据 + 缩略图，原图在开灯箱时按 id 读。

帧记录主要字段：

| 字段 | 说明 |
| --- | --- |
| `id` | `时间戳-随机串` |
| `roll` / `frameNo` | 卷号 / 张号 |
| `code/name/en/iso` | 乳剂信息 |
| `ev` | 拍摄 EV（档） |
| `flash` / `flashKind` | 是否闪光、LED/屏幕 |
| `w` / `h` | 成片尺寸 |
| `date` | 拍摄时日期打印是否开启 |
| `ts` | 时间戳，列表倒序 |
| `blob` | 成片 JPEG（列表读取时被剥离） |
| `thumb` | 缩略图 JPEG |
| `thumbW` | 缩略图实际宽度（v1.12.4+，旧记录缺失） |
| `persisted` | 仅本次会话：是否真的写入 IndexedDB |

### 5.2 Store 行为

- `Store.all()`：游标读取所有行，`meta()` 去掉 `blob`；与内存中写入失败的行合并，按 `ts` 倒序；读失败时返回上次成功快照。
- `Store.add(frame)`：写 IndexedDB；失败时把整行放进内存列表，并设置 `lastAddPersisted = false`。应用用这个标记决定是否提示“仅本次会话”。
- `Store.get(id)`：先查内存，再按 id 读数据库。
- `Store.update(row)`：只更新已存在的记录，先读后写；用于旧缩略图重建，不会把重建期间被删掉的照片写回来，也不改 `lastAddPersisted`。
- `Store.remove(id)`：内存和数据库都删；数据库行删失败会抛出，内存行可以容忍。
- **没有 clear/estimate 等公开接口**。

### 5.3 删除与撤销

- 单张删除：先把原图/缩略图复制成独立 Blob，再立即从 IndexedDB 删除；Toast 提供 6 秒撤销，撤销写回副本。
- 批量删除：`window.confirm` 确认；同样先复制 Blob，再删；撤销批量写回。
- 6 秒内关闭页面：删除已经落库，不会在下次打开时“复活”；这是刻意的选择（避免残留待删除记录）。
- 撤销是单层：新的 Toast 会替换旧的撤销入口。

### 5.4 缩略图迁移

- 新照片：`thumbW = min(720, 成片宽)`，直接缩放成片。
- 旧照片：没有 `thumbW`，打开影集时会逐张 `Store.get(id)` → 解码原图 → 缩放到 720 → `Store.update()`。
- 迁移在后台逐张进行（约每 140ms 一张），影集关闭或切到胶卷库时停止；删除/撤销期间的写入有保护。
- 迁移只处理旧记录一次；失败会标记本会话不再重试，下次打开再试。

### 5.5 保存 / 分享 / ZIP

- 桌面单张：`<a download>` 下载 JPEG。
- iOS 单张：优先 `navigator.share({files:[File]})`；不支持文件分享时打开原图，让用户长按保存。
- 批量桌面：`SPOOLO.zipFiles(files)` 生成 store-only ZIP；JPEG 已压缩，不再 deflate。
- 批量移动端：优先系统分享多张 JPEG；`NotAllowedError` 时给出可再次点击的“保存”Toast；否则打包 ZIP。
- ZIP 文件名：`SPOOLO_<code>_ROLL<xx>_<xx>.jpg`。

---

## 6. UI、交互与无障碍

### 6.1 布局

- `max-width: 999px` 为手机布局：
  - 竖屏：3:4 取景框，左右功能键导轨，胶卷仓 + 底部 EV/快门/影集面板。
  - 横屏：3:2 取景框；极矮横屏退回整页滚动。
- `min-width: 1000px` 为桌面：左侧相机、右侧常驻暗房侧栏。
- 灯箱在 `560px` 宽以上切双列；低于此宽度单列，取景台按剩余高度收缩，操作区始终可见。
- Toast 在手机顶部（安全区内侧），桌面底部；灯箱打开时会把 Toast 临时挂进 `<dialog>`，因为原生 dialog 在 top layer，会盖住普通 fixed 元素。

### 6.2 抽屉与焦点

- 手机抽屉打开时：
  - 机身和跳转链接设为 `inert`；
  - Tab 焦点在抽屉内循环；
  - 打开时聚焦当前标签，关闭后焦点回到触发按钮；
  - `html.overflow = hidden` 锁滚动。
- 关闭抽屉会调用 `wakePreview()`：恢复 rAF 运行状态、重算画布、重挂/播放视频、必要时重连镜头、检测 WebGL 上下文。

### 6.3 键盘快捷键

- 空格 / 回车：焦点在 body 或快门时拍摄。
- `G` 网格、`F` 翻转镜头、`T` 定时、`D` 日期、`M` 快门声、`Esc` 关闭抽屉/灯箱。
- 灯箱打开、冲印遮罩显示、手机抽屉打开时，快捷键会被拦截，避免改到背后的相机。
- 标签页支持左右 / Home / End。

### 6.4 批量管理

- 影集“管理”进入选择模式；点选、全选/取消全选。
- 选中态用琥珀色 `outline`，不使用 `box-shadow`（触屏 `:hover` 会粘住并覆盖阴影）。
- 批量保存/删除按钮在未选中时禁用；删除有确认和 6 秒撤销。
- 当前管理状态、选中集合都在 `state`；切换标签或关闭抽屉不会丢。

### 6.5 iOS 取景恢复

v1.12.5 起，针对“批量删除/确认/分享后回到相机画面卡死”增加了多层恢复：

- 关闭抽屉、关闭灯箱、`confirm` 结束、`pageshow`、窗口重新聚焦时 `wakePreview()`。
- 预览循环在页面可见但 `state.running` 被漏掉时自愈。
- 视频被系统暂停时低频补 `play()`；`srcObject` 被清空则重新挂载。
- 轨道静默 ended 时自动重连一次；`track ended` 事件路径也有 `cameraLost` 标记。
- WebGL 上下文丢失：`webglcontextlost` 事件 + 每帧 `gl.isContextLost()` 双保险，退回 Canvas2D。

---

## 7. 测试与调试

### 7.1 本地运行

```bash
python -m http.server 8123
```

访问 `http://localhost:8123/`。摄像头只在 HTTPS 或 localhost 下可用；手机测试必须用 HTTPS（局域网自签证书或 GitHub Pages）。

### 7.2 强制走不同路径

- **CPU 成片**：禁用 WebGL（浏览器设置/启动参数），或在页面脚本执行前覆盖 `getContext`：

  ```js
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    if (typeof type === 'string' && type.indexOf('webgl') >= 0) return null;
    return orig.apply(this, arguments);
  };
  ```

- **2D 预览**：同上，或者让 `initWebGLPreview()` 失败。
- **WebGL 上下文丢失**：在控制台执行：

  ```js
  const gl = document.querySelector('#preview').getContext('webgl');
  gl.getExtension('WEBGL_lose_context').loseContext();
  ```

- **IndexedDB 不可用**：在页面脚本前让 `indexedDB.open` 抛错，应用会走内存兜底并提示“仅本次会话”。
- **摄像头拒绝/无摄像头**：拒绝权限后应显示“镜头权限被拒绝 / 重试 / 导入底片”，导入后仍可完整拍摄。
- **旧缩略图迁移**：用 DevTools 向 IndexedDB 写入一条没有 `thumbW` 的记录，打开影集看是否自动变成 720。
- **iOS 卡死模拟**：在抽屉打开时 `video.pause()`、清空 `srcObject`、手动 dispatch `ended`，或让 WebGL 上下文丢失，然后关闭抽屉，观察是否恢复。

### 7.3 建议的回归清单

**拍摄主链路**

- 27 种乳剂各拍一张，编码/尺寸正确。
- EV 到 ±2.0，预览/成片变化一致。
- 3s / 10s 定时；倒计时中切“关”应取消。
- 强制闪光、自动闪光（暗图触发、亮图不触发）。
- 拍满 36 张自动回卷；手动回卷；回卷中刷新不重复编号。
- 冲印动画中刷新，下一次不重复 `ROLL/#`。

**影集/灯箱**

- 灯箱打开、保存、删除、撤销。
- 批量全选/取消/保存/删除/撤销。
- 小屏 320×568、375×667 与横屏 667×375：照片和操作按钮都可见。
- 灯箱内保存/分享的 Toast 可见；关闭后 Toast 回到 body。
- 旧底片缩略图自动迁移，刷新后保持。
- 设备 DPR3 下影集预览与灯箱颗粒图案同源。

**降级/异常**

- 无 WebGL、上下文丢失、IndexedDB 禁用。
- 摄像头拒绝、轨道 ended、页面切后台再回来。
- iPhone Safari：保存/分享、删除撤销、批量删除后返回取景不冻帧。

### 7.4 调试入口

- 浏览器控制台会输出 `SPOOLO shader:` / `SPOOLO gpu shader:` 编译错误。
- `window.SPOOLO` 下可直接调用色彩引擎和 Store。
- `app.js` 的内部状态不暴露；需要时临时在 IIFE 内加日志，或通过 DOM（计数器、Toast、`#processing`、`#frames`）观察。
- GPU 管线失败时不会抛异常到 UI，只会回退 CPU；如果成片明显变慢，先检查控制台 shader 警告。
- 修改 JS/CSS 后同步更新 `index.html` 的 `?v=`，否则手机可能拿缓存旧文件。

---

## 8. 版本、发布与协作

- 版本规则：每次改动都递增；修 bug/小调整进末位，界面或功能改动进中间位。
- 版本号同时出现在：
  - 顶盖铭牌（`index.html` 的 `.maker-meta`）
  - 暗房页脚（`.lab-foot`）
  - `README.md` 头部与版本记录
  - 所有 CSS/JS 的 `?v=` 指纹
- 发布：提交到特性分支 → 测试 → 快进合并 `main` → 推送；GitHub Pages 从 `main` 根目录发布。
- 改动色彩/乳剂时，至少更新 README 的乳剂表和变更记录；新增/修改管线时同步更新本文第 4 节。
- 不要引入构建步骤或运行时依赖；保持单文件可读、可直接部署。

---

## 9. 已知限制与设计取舍

- **显示参考色彩**：不做 ICC/线性光/广色域；颜色是经验调参，换设备可能略有差异。
- **色彩模型是经验的**：P1 的 3×3 串扰矩阵和色相饱和度是全局经验参数，不是光谱/染料化学模拟；极端纯色（激光、霓虹灯管）可能偏离真实胶片。
- **8-bit LUT**：256 级，极端渐变可能 banding；没有 dithering。
- **预览 ≠ 成片**：取景不含颗粒、halation、bloom、闪光、日期；暗角/漏光是 CSS 近似。高光去饱和/白点抬升已在预览里。
- **CPU/GPU 不完全一致**：光晕/bloom 模糊核、精度、FBO 8-bit 会带来轻微差异；以视觉一致为目标。
- **颗粒是成片分辨率的像素级效果**：1px 细粒 + 2–5px 低频团块在成片分辨率上生成；缩略图直接缩放，尺寸小的时候看起来更细。高感卷的团块更明显，但在纯灰场上仍会比真实胶片更均匀。
- **日期是冲印时系统时间**：不是快门时间的独立快照；跨午夜可能差一天。
- **成片长边上限 1920**；导入小图不放大。
- **iPhone 不能网页控制 LED 闪光灯**；回退为屏幕补光。后摄的屏幕在手机背面，无法照亮前方，软件只能延长补光、重试并最多补回 4EV；真正夜拍后摄需要硬件闪光灯或外部光源。
- **iOS 摄像头/视频/WebGL 会被系统挂起或回收**；代码有恢复路径，但仍建议真机回归。
- **IndexedDB 失败会退化为内存**；关页后这些照片会丢，提示只在当次会话。
- **ZIP 是 store-only**：不压缩 JPEG，文件比原图总和略大一点；换取实现简单和速度。
- **短横屏/矮桌面**：主界面退回整页滚动，快门可能需要向下滚；灯箱已单独适配。
- **批量删除全部会退出管理模式**；撤销后照片回来，但管理态不恢复（小交互取舍）。

---

## 10. 术语表

| 术语 | 含义 |
| --- | --- |
| LUT | Look-Up Table，256 级输入到输出的映射；本项目的色彩曲线主体 |
| EV | 曝光补偿，以档为单位；UI 以 1/3 档步进 |
| shoulder | 高光肩部起点，超过后用 tanh 压缩 |
| halation | 胶片高光在乳剂层间反射形成的橙红光晕 |
| bloom | 高光向周围扩散的柔和辉光；本项目用比 halation 更宽的第二级模糊实现，黑白也有 |
| grain | 颗粒：细粒随机扰动 + 低频团块，按亮度加权并软限幅，暗部更明显 |
| crosstalk matrix | 3×3 通道串扰矩阵，模拟染料层互相吸收；行和为 1 以保持中性灰 |
| hue-dependent saturation | 随色相变化的饱和度曲线；只缩放色度，不改变色相和亮度 |
| split-tone | 阴影/高光分离调色 |
| display-referred | 直接在显示空间（sRGB 8-bit）计算，不做线性化 |
| FBO | WebGL Framebuffer Object，离屏渲染目标 |
| ping-pong | 两张纹理交替作为输入/输出做多轮模糊 |
| screen blend | `1-(1-a)(1-b)`，光晕用的加法混合 |
| DPR | devicePixelRatio，设备像素比 |
| store-only ZIP | 只存不压缩的 ZIP（method 0） |

---

如果这份文档和代码不一致，以代码为准；但请顺手把文档改掉——接力开发最怕的是“看起来懂了，实际管线已经变了两版”。
