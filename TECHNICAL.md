# SPOOLO 技术文档

> 适用版本：**v1.22.0**
> 面向：准备接手维护、调整色彩、增加乳剂或排查移动端问题的开发者。
> 建议阅读顺序：`README.md` → 本文第 1～3 节 → `js/spektra.js` → `js/films.js` → `js/gpu-develop.js` → `js/app.js` 的冲印部分。

SPOOLO 是一台纯静态的网页 135 胶片相机。没有构建步骤、没有运行时依赖，所有效果都在浏览器里现场计算。这个文档的目标是让你在改一行颜色参数之前，知道它会经过哪些像素、哪些着色器、哪些存储路径。

---

## 0. 一页地图

### 0.1 文件职责

| 文件 | 职责 |
| --- | --- |
| `index.html` | 机身 DOM、胶卷仓、控制台、暗房/影集、灯箱、冲印遮罩、Toast |
| `css/base.css` | 设计令牌、布局、机身/取景器、响应式断点、取景器 CSS 覆盖层 |
| `css/ui.css` | 旋钮、功能键、快门、胶卷卡、影集、批量条、抽屉、灯箱、Toast 等组件 |
| `js/films.js` | 光谱 LUT 之后的 CPU 像素管线：颗粒/光晕/bloom/暗角/漏光/闪光算法 |
| `js/spektra.js` | spektrafilm 移植层：光谱上采样、胶片 / 相纸显影、负片扩印与反转片 direct scan、输出色域映射、33³ LUT 烘焙与采样 |
| `js/spektra-data.js` | 光谱胶片/相纸的压缩数据包（base64 Float32/Uint16），启动时懒加载 |
| `js/gpu-develop.js` | 成片 WebGL 管线：光谱 LUT → 镜头柔化/色差 → 亮部遮罩 → 光晕/宽 bloom 两级模糊 → 合成 |
| `js/store.js` | IndexedDB 影集存储（失败降级到内存） |
| `js/zip.js` | 桌面批量保存用的 store-only ZIP（CRC32，不压缩 JPEG） |
| `js/app.js` | 取景、快门、定时、闪光、冲印调度、胶卷/相纸/影集/灯箱/批量、交互与无障碍 |
| `tools/https-server.py` | 本地 HTTPS 静态服务；自动生成临时自签名证书，也可使用已有 PEM 证书 |
| `TECHNICAL.md` | 本文 |
| `README.md` | 用户功能、乳剂列表、运行方式、许可说明 |
| `LICENSE` / `NOTICE` | GPL-3.0 许可全文与项目版权 / 授权声明 |
| `THIRD_PARTY.md` | spektrafilm 代码与 profile 数据的署名、修改记录与许可义务 |

脚本加载顺序是固定的（见 `index.html` 底部）：

```
films.js → store.js → gpu-develop.js → zip.js → app.js
```

`spektra-data.js` 与 `spektra.js` 不在首屏 HTML 里：`app.js` 启动后按顺序
注入这两个脚本（带 `?v=` 版本指纹），随后调用
`SPOOLO.Spektra.setData(SPOOLO.SPEKTRA_DATA)` 并烘焙当前胶卷 × 相纸。
光谱链是唯一色彩引擎，不再有合成 LUT 回退。

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

- **纯静态**：`python3 -m http.server` 或 GitHub Pages 即可；不要引入打包器、框架或后端。
- **无第三方运行时依赖**：字体是唯一的外部资源，且失败时必须有回退字体。
- **色彩是显示参考（display-referred）**：输入与输出都按显示 sRGB 8-bit 处理；光谱链内部会在采样前做 sRGB ↔ 线性转换，但不再有可手调的“胶片感”曲线参数。所有色彩由 spektrafilm 的胶片 / 相纸数据决定，改管线前先接受这个前提。
- **移动优先**：主要使用场景是手机竖屏；桌面是第二布局。
- **iOS Safari 是特殊环境**：摄像头、闪光灯、分享、WebGL 上下文、IndexedDB Blob 都有各自的坑，代码里保留了多条兜底路径。

### 0.4 我想改 X，先看哪里

| 想改的东西 | 入口 |
| --- | --- |
| 某一卷的颜色 | 上游 profile 数据 + `js/spektra.js` 的光谱链；预览和成片共用同一份 LUT |
| 新增一卷 | 在 `tools/build-spektra-data.py` 的 `FILM_ORDER` / `FILM_META` 里加 profile，重新生成数据；第 4.17 节 |
| 颗粒 | `Spektra.effectsFor()` 的 `grain` + `films.js` 的 `render()` 第二遍 + `gpu-develop.js` 的 `COMP_FS` / `getNoise()` |
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

**第一层：光谱色彩（`spektra.js`）**

- `SPOOLO.Spektra.setData()`：解码胶片 / 相纸数据。
- `SPOOLO.Spektra.bake(filmId, paperId, 33)`：烘焙显示 sRGB → 显示 sRGB 的 33³ LUT。
- `SPOOLO.Spektra.effectsFor(filmId)`：把胶片元数据映射成颗粒 / 光晕 / 暗角参数，供预览、成片与 UI 复用。
- `SPOOLO.Spektra.sampleSrgb()`：CPU 三线性采样。

**第二层：空间效果（`films.js` / `gpu-develop.js`）**

- `SPOOLO.render(data, w, h, film, opts)`：CPU 版光谱采样 + 颗粒 / 光晕 / 暗角 / 漏光 / 闪光，原地修改 RGBA `Uint8ClampedArray`。
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
  render, lensModel, LENS_MODEL,      // films.js
  Spektra, SPEKTRA_DATA,              // spektra.js / spektra-data.js
  GLDevelop,                          // gpu-develop.js
  Store,                              // store.js
  zipFiles                            // zip.js
};
```

`app.js` 不向 `window.SPOOLO` 暴露内部状态。调试时可以在 DevTools 里直接调用：

```js
SPOOLO.Spektra.films().length
const lut = SPOOLO.Spektra.bake('kodak_portra_400', 'kodak_portra_endura', 33)
const film = SPOOLO.Spektra.effectsFor('kodak_portra_400')
SPOOLO.Store.all()
SPOOLO.render(pixels, w, h, film, { ev: 0, spectralLut: lut, grain: true, seed: 1 })
```

### 1.3 启动顺序

`app.js` 的 `init()` 做这些事：

1. `renderFilmList()`：先写入载入占位；光谱数据到达后生成 20 张乳剂卡，写入旋钮的 `aria-valuemax`。
2. 恢复网格/日期/声音/颗粒/定时/闪光/EV/卷号/张号。
3. `bindControls()`：所有事件。
4. `setTimeout(loadSpectral, 0)`：注入光谱脚本、校验上次胶片 / 相纸 id、烘焙当前 LUT。
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
| `ev` | EV 以 **1/3 档** 为单位，范围 −6…+6 |
| `facing` | `environment` / `user` |
| `stream` / `live` | 当前 MediaStream 与视频是否已连接 |
| `mirror` | 前摄时预览与成片是否镜像 |
| `source` | `camera` / `file` / `none` |
| `sourceUrl` | 导入图当前使用的 `blob:` URL；换图或切回镜头时 `revokeObjectURL` |
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
| `spectralLut` | 当前光谱胶片 × 相纸烘焙出的 33³ LUT（`data` 为 Float32，`atlas` 为 8-bit 2D 图集） |
| `spectralFilmId` / `spectralPaperId` | 当前已生效的光谱胶片 / 相纸 id |
| `spectralFilmObj` | `Spektra.effectsFor()` 返回的「像胶片」对象，供取景、暗角、颗粒、灯箱元数据复用 |
| `spectralLoading` | 光谱数据是否正在加载 |
| `spectralError` | 光谱加载 / LUT 失败信息；让快门 Toast、暗房状态和机身显示保持一致 |
| `spectralBakeTimer` / `spectralPending*` | 换卷/换纸时的防抖烘焙队列 |

### 2.2 `prefs` 持久化

`localStorage` 键：`spoolo.prefs.v1`

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `ev` | `0` | 1/3 档单位 |
| `roll` | `1` | 卷号，1–9999 |
| `frame` | `1` | 当前张号；>36 会被规范到下一卷 |
| `timer` | `0` | 0 / 3 / 10 秒 |
| `flash` | `0` | 0 关 / 1 自动 / 2 强制 |
| `grid` | `true` | 构图网格 |
| `date` | `false` | 日期打印 |
| `sound` | `true` | 合成快门声 |
| `grain` | `true` | 冲印时是否叠加颗粒 |
| `spectralFilm` | `kodak_portra_400` | 光谱胶片 id |
| `spectralPaper` | `kodak_portra_endura` | 光谱相纸 id |

`normalizePrefs()` 会收敛旧版本脏值。光谱数据尚未加载时，`spectralFilm` /
`spectralPaper` 只做非空字符串校验；真正加载后会在 `loadSpectral()` 里
再按可用 id 列表校验。摄像头朝向不持久化，启动固定后摄。

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
- 片元着色器只做：光谱 3D LUT 采样（EV 在线性光上缩放）。**不做镜头、颗粒、光晕、暗角、漏光、闪光、日期**。
- 暗角和漏光由 `frameBox` 上的 CSS 覆盖层近似：`--vig`、`--leak` 由 `applyFilmVars()` 写入；`.fx.vignette` 是径向渐变，`.fx.leak` 是左侧渐变 + `screen` 混合。
- 画布按设备 DPR 全分辨率（DPR 上限 3，像素上限约 1.4M）；预览固定 30fps（`1000/30` 节流）。
- LUT 只在胶片 / 相纸组合改变时重新上传（`lutKey = spec.key`）；EV 只改 uniform，不重新上传。

**Canvas2D（兜底）**

- WebGL 不可用、着色器编译失败或上下文丢失时，`fallback2DPreview()` 会替换 `#preview` 为 2D canvas。
- 每帧 `drawImage` 后跑一次 `SPOOLO.render()` 的**光谱 LUT 第一遍**（关闭镜头/光晕/颗粒/暗角/漏光），再 `putImageData`。
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

1. 显示遮罩，标题按工艺显示“C-41 冲印中 / ECN-2 冲印中 / E-6 冲印中 / K-14 冲印中”。
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

- 源像素：`<video>` / `<canvas>` 的 RGBA 8-bit，通道 0–255。
- CPU 管线：`Uint8ClampedArray`，中间值按 0–255 浮点计算，写入时钳制。
- GPU 管线：纹理采样归一化到 0–1，片元着色器最后 `clamp(col, 0, 1)`。
- 色彩 LUT：33³ 的显示 sRGB → 显示 sRGB 3D LUT。CPU 存 Float32 三线性采样；GPU 存 8-bit 2D 图集，切片内由线性过滤、切片间手动 `mix`。
- 光谱采样前会做 sRGB → 线性转换；EV 在线性光上缩放后查表，不烘进 LUT。
- 亮度统一使用 Rec.709 权重（只用于空间效果）：

```js
luma = r*0.2126 + g*0.7152 + b*0.0722
```

- 不再有可手调的对比 / 提亮 / 伽马 / 增益 / 饱和度参数；所有色彩由 spektrafilm 的胶片与相纸数据决定。

### 4.2 光谱乳剂与效果参数

上游 profile 的字段经 `Spektra.effectsFor(filmId)` 转成 UI / 空间效果使用的对象：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `code` | string | 乳剂代号，如 `P400`；暗盒、边码、灯箱元数据 |
| `name` / `en` | string | 展示名 |
| `process` | `C-41` / `ECN-2` / `E-6` / `K-14` | 冲印标题、卡片标签 |
| `iso` | number | 展示、边码、颗粒强度 |
| `tone` | CSS color | 胶卷卡 / 暗盒色块 |
| `grain` | object | `{ amount, size, shadow, coarse, coarseScale }` |
| `halation` | object? | `{ amount, radius, threshold, color }` |
| `vignette` | number | 暗角强度 0–1 |
| `leak` | number | 漏光强度 0–1 |
| `spectral` | `true` | 标记当前对象来自光谱层 |

`effectsFor()` 从胶片元数据推导颗粒与光晕：

```js
grainAmt = 0.030 + 0.000045 * min(iso, 1600)
         + (consumer ? 0.006 : 0) - (cine ? 0.005 : 0)
         + 0.012 * push
         * (positive ? 0.8 : 1)
halation = antihalation === 'no' ? 0.32 : weak ? 0.20 : 0.12
```

这套映射是 SPOOLO 自己的近似，不是 spektrafilm 的逐胶片预设；上游的颗粒是全局物理粒子模型，且在我们的 33³ LUT 模式下本来就会被关闭。照片数据本身仍来自上游 profile。

### 4.3 33³ LUT 烘焙

`Spektra.bake(filmId, paperId, 33)` 对每个 LUT 格点执行：

1. 显示 sRGB → 线性 sRGB。
2. 胶片 raw：`mIn` → XYZ → xy → 方形坐标 → 查 49×49 `tc` → 乘 `b=ΣXYZ`。
3. 胶片显影：密度曲线 + DIR coupler 反推（`developFilm`）。
4. 负片走相纸：胶片染料密度 → 透射光 → 乘相纸灵敏度 → 乘中灰曝光因子；
   反转片跳过相纸，直接把胶片染料密度送去扫描，并按显影后的黑 / 白密度
   归一化扫描亮度（否则幻灯片会整体发灰）。
5. 负片相纸显影：三层正态 CDF 密度模型。
6. 扫描：染料密度 → D50 光 → XYZ → sRGB 矩阵（`mOut`）。
7. 输出色域映射：上游 `oklch` 变体，按 48×360 的 C_max 表做 Reinhard 式压缩。

结果写进 `{ data: Float32Array, atlas: Uint8Array, size: 33, key }`。运行时只保留当前胶片 × 相纸一份；换卷或换纸会防抖 80ms 后重新烘焙。

### 4.4 第一遍：光谱 LUT

CPU（`films.js`）：

```js
Spektra.sampleSrgb(lut, data[i], data[i+1], data[i+2], ev, out);
data[i] = out[0]; data[i+1] = out[1]; data[i+2] = out[2];
```

GPU（`gpu-develop.js` / 预览 `GL_FS`）：

```glsl
vec3 specSample(vec3 c) {
  vec3 lin = vec3(s2l(c.r), s2l(c.g), s2l(c.b)) * uSpecExp;
  lin = clamp(lin, 0.0, 1.0);
  vec3 t = vec3(l2s(lin.r), l2s(lin.g), l2s(lin.b));
  // 以 t.rg 为切片内坐标、t.b 为切片号，两层手动插值
}
```

- EV 单位是“档”，`state.ev / 3`；`uSpecExp = 2^ev`，CPU 同样在线性光上乘。
- LUT key 由 `filmId|paperId|size` 组成，不含 EV；调 EV 不重新烘焙。
- 取景预览只做这一步；镜头、光晕、颗粒、暗角、漏光、闪光只在成片管线中执行。
- 写入效果前钳制到 0–255（CPU）或 0–1（GPU）。

### 4.4.1 镜头光学（P2）

镜头层在色彩之后、亮部遮罩之前执行，因此 bloom/halation 看到的是被镜头柔化过的高光边缘。模型只有两个参数，单位都是「1080px 短边时的像素」，成片按 `min(W,H)/1080` 等比缩放：

```js
lens = film.lens || LENS_MODEL;   // 默认 { softness: 0.8, ca: 0.8 }
softPx = lens.softness * min(W,H)/1080;
caPx   = lens.ca       * min(W,H)/1080;
```

- `softness`：边缘 4-tap 柔化半径。`r²` 从中心 0 到角落 1，中心保持锐利，角落最柔。
- `ca`：R/B 通道沿径向反向偏移的像素数，绿通道不动。
- `film.lens: false` 整层关闭；`film.lens: { softness, ca }` 单独覆盖。
- 默认值很轻：1080×1440 角落约 0.8px 柔化、0.8px 色差；1920×1280 会按短边放大到约 0.95px。
- **GPU**：`LENS_FS` 渲染到 `lensT`。先算归一化 `rr = |p|² / |res/2|²`，`dir = normalize(p)`；R/B 采样坐标偏移 `dir * caPx * rr / res`，每个通道用 4-tap 柔化函数采样，共 12 次纹理读取。柔化采样坐标用 `clamp` 到 0–1。
- **CPU**：复制第一遍颜色，R/B 用双线性采样（`bilinearAt`）减少色差锯齿，柔化用中心 + 4 邻域（`nearestAt`）的 5-tap；比 GPU 略硬，但速度可控。
- **遮罩**：CPU 在镜头之后用半分辨率循环取每个 2×2 块的左上角重算亮部遮罩；GPU 的 `BRIGHT_FS` 直接读 `lensT`。两边都不再使用镜头前的颜色生成 bloom/halation。
- **不做**：取景预览不叠加镜头层；灰尘/划痕、片框/齿孔默认不烘进成片（UI 的齿孔只是机身装饰）。如果要加，优先做成默认关闭的开关，而不是默认改变每一张照片。

### 4.5 光晕 halation 与全局 bloom

两者共享同一张亮部遮罩，但用两个不同的模糊半径：halation 紧贴高光、带乳剂颜色；bloom 更宽、更中性，模拟镜头/扫描仪的光学扩散。当前光谱乳剂都带 halation；即使某卷没有，也仍会走 bloom。

**亮部遮罩**

对镜头后的像素（已包含光谱 LUT 和镜头柔化/色差）取 luma `nrm`：

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
- 默认 `amount` 0.12，默认颜色 `[1, 0.96, 0.90]`；单个乳剂可以用 `film.bloom = { amount, color }` 覆盖。

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

目标是“银盐结块”而不是电视雪花：细粒提供质地，低频团块提供起伏；振幅按亮度加权并软限幅；当前光谱乳剂都是彩色，颗粒以亮度为主、只留很弱的通道差。v1.14.0 重写了这一层。

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

// 亮度主导，弱通道差
nL = nFine + nC;
nCh = n2 * 0.30;
r += (nL + nCh * 0.55) * ga;
g += (nL - nCh * 0.10) * ga;
b += (nL - nCh * 0.55) * ga;
```

- `coarseScale` 默认按 ISO：≥1600 → 5，≥800 → 4，≥400 → 3，更低 → 2。
- `coarseAmt` 默认：≥800 → 0.55，≥400 → 0.50，更低 → 0.38；乳剂可用 `grain.coarse` / `grain.coarseScale` 覆盖。
- `grain.size > 1` 时细粒坐标会先除以 size；当前光谱乳剂都是 1px。
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
- `uGrainMono` 仍保留在着色器里，但当前光谱乳剂没有 `bw` 字段，统一传 0，走彩色亮度颗粒分支。

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
- 漏光由 `film.leak` 控制；当前 `Spektra.effectsFor()` 对所有光谱乳剂都设为 0，保留算法供以后按乳剂启用。

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
1. EV 在线性光上缩放（不烘进 LUT）
2. spektrafilm 33³ 光谱 LUT
3. 镜头柔化 / 横向色差（P2，中心 0 → 边缘最强）
4. 生成亮部遮罩（从镜头后的颜色生成，halation + bloom 共用）
5. 光晕 halation（screen）
6. 全局 bloom（screen，更宽的第二级模糊）
7. 颗粒 grain（按亮度加权，软限幅；可被「颗粒」开关关闭）
8. 暗角 vignette（乘法）
9. 漏光 leak（加法）
10. 闪光 flash（加法）
11. clamp 0…1
12. 日期水印（Canvas2D，在管线之外）
```

### 4.11 CPU 与 GPU 的差异

| 环节 | CPU (`films.js`) | GPU (`gpu-develop.js`) | 差异 |
| --- | --- | --- | --- |
| 光谱 LUT | Float32 三线性采样 | 8-bit 2D 图集，切片内线性 + 切片间 `mix` | 实测 64×48 渐变最大差 1/255，均值 0.14/255 |
| 镜头柔化/CA | 邻域 5-tap + 双线性色差 | 每通道 4-tap 柔化，共 12 次采样 | CPU 略硬；强度同 |
| 亮部遮罩 | 半分辨率，平方阈值，镜头后生成 | 半分辨率，平方阈值，读 `lensT` | 一致 |
| halation 模糊 | 两遍盒式模糊 | 两轮 9-tap 高斯 | 形状略有差异 |
| bloom 第二级模糊 | 复制遮罩后更大半径的两遍盒式模糊 | `maskC` + 更大步长的两轮 9-tap | 半径都按 `min(halfW,halfH)/60` 缩放 |
| 颗粒 | `Math.imul` 细粒 + value noise 团块 | 512 噪声纹理（NEAREST + LINEAR），双尺度 | 权重、软限幅一致；采样方式不同 |
| 颗粒彩色混合 | 亮度主导，弱通道差 | 同一权重 | 一致 |
| 暗角/漏光/闪光 | 逐像素公式 | 同一公式的 shader | 一致 |
| 精度 | JS 浮点 + 8-bit 写回 | highp（可用时），8-bit FBO | GPU 略平滑 |
| 日期 | Canvas2D | 无（由 app.js 统一叠加） | 一致 |

结论：**GPU 是主路径，CPU 是兜底；光谱色彩应基本一致，空间效果允许轻微差异。** 修改任何一个效果，都要同步检查另一个。v1.18.0 的实测（64×48 渐变，EV +0.33）：CPU Float32 三线性与 GPU 8-bit 图集的最大通道差为 1/255，均值 0.14/255；颗粒、光晕、bloom 的采样方式不同，但权重与合成顺序一致。镜头在取景预览里不执行，所以这是成片专属成本。

### 4.12 取景预览与成片的对应关系

| 内容 | 取景预览 | 成片 |
| --- | --- | --- |
| 光谱 LUT / EV | 有（`GL_FS` 或 2D `render` 第一遍） | 有 |
| 镜头柔化 / 横向色差 | 无（预览保持锐利） | 有 |
| 裁切 / 镜像 | 有（`uCrop` / `mirror`，或 2D 裁切） | `grabFrame` 已裁好并镜像 |
| 光晕 halation | 无 | 有 |
| 全局 bloom | 无 | 有 |
| 颗粒 grain | 无 | 有（功能键「颗粒」可关） |
| 暗角 vignette | CSS 径向渐变近似 | 逐像素径向 |
| 漏光 leak | CSS 左侧渐变近似 | 逐像素光带 |
| 闪光 | 触发时全屏白闪 | 中心暖光叠加 |
| 日期打印 | 无 | 有 |
| 分辨率 | DPR 全分辨率（上限 1.4M 像素），30fps | 长边 1920，按一次快门冲印 |
| 管线 | 实时轻量 | 完整 GPU/CPU |

这就是为什么“取景看起来”和“成片”可能略有不同，尤其是镜头柔化/色差、颗粒、halation 与 bloom。调整乳剂颜色时，最好同时看取景和成片。

### 4.13 分辨率与缩略图

- 成片长边上限 1920：
  - 竖屏 1080×1440
  - 横屏/桌面 1920×1280
  - 导入小图不放大
- 缩略图 `THUMB_W = 720`，从**冲印完成的成片**直接 `drawImage` 缩放，不再二次跑乳剂管线，也不再二次计算颗粒。
- 缩略图 JPEG 质量 0.8；帧记录 `thumbW` 标记实际宽度。
- 旧版本底片没有 `thumbW`，打开影集时会在后台逐张从原图重建为 720px，并写回 IndexedDB；`Store.update` 先读后写，重建期间被删除的照片不会被写回。
- 720px 的选择：影集格子约 165 CSS × DPR3 ≈ 495 设备像素，720 会被浏览器略缩小；灯箱约 282 CSS × DPR3 ≈ 846 设备像素，从 1080 略缩小。两者缩小倍率接近，颗粒图案同源。

### 4.14 新增一种光谱乳剂 / 相纸

1. 把上游 profile JSON 放进 `spektrafilm/src/spektrafilm/data/profiles/`。
2. 在 `tools/build-spektra-data.py` 的 `FILM_ORDER` / `PAPER_ORDER` 里追加 stock 名；胶片还要在 `FILM_META` 里给出 `(code, en, tone, process)`，必要时在 `FILM_ISO` 里给出真实 ISO（片名里的数字不总是 ISO）。
3. 重新生成数据：

```bash
python3 tools/build-spektra-data.py --upstream /path/to/spektrafilm --out js/spektra-data.js
```

4. 刷新页面；`renderFilmList()` / `renderPaperList()` 会自动按数据数量生成卡片，旋钮的 `aria-valuemax` 也按 `Spektra.films().length` 写。
5. 如果要调整颗粒 / 光晕，改 `js/spektra.js` 的 `effectsFor()`；要调整空间效果，按 4.15 同时改 CPU / GPU。
6. 更新 `README.md` 的乳剂 / 相纸表和版本号；同步顶盖/页脚/`?v=`。
7. 测试素材：灰卡（检查 LUT 色阶与颗粒）、肤色（检查色彩链）、蓝天（检查色域压缩）、霓虹（检查 halation），再禁用 WebGL 检查 CPU 兜底。

调参建议：

- 色彩问题优先查上游 profile 与 `bake()` 链路，不要在后处理里用曲线“补色”；
- 颗粒先看灰卡：`grain.amount` 定总体，`grain.shadow` 定暗部，`grain.coarse` / `coarseScale` 定团块；
- 光晕先看白色高光与灰底边缘，`threshold` 保持 0.5–0.85，避免除零；
- 镜头/暗角/漏光是空间效果，调完要同时看取景与成片。

### 4.15 修改或新增一个空间效果

必须同时改两处：

1. **CPU**：在 `films.js` 的 `render()` 第一遍/第二遍里实现，保持顺序。
2. **GPU**：在 `gpu-develop.js` 的对应着色器（`COLOR_FS` / `BRIGHT_FS` / `BLUR_FS` / `COMP_FS`）或新增 pass；在 `render()` 里设置 uniform、绑定纹理、按顺序 draw。
3. 如果这个效果也要出现在取景里，再改 `app.js` 的 `GL_FS`/`drawPreview2D` 和 CSS 覆盖层；否则明确写进“取景不包含”。
4. 两套管线的数值域要换算清楚：CPU 0–255 vs GPU 0–1。
5. 保持合成顺序与第 4.10 节一致，否则 GPU/CPU 会出现色差。
6. 在 WebGL 不可用、WebGL 上下文丢失、动画帧异常三种情况下验证 CPU 兜底。

### 4.16 色彩管线常见坑

- **只改 GPU 或只改 CPU**：用户在无 WebGL 设备上会看到另一套颜色。光谱 LUT 是两个管线共用的同一份数据，但采样路径不同。
- **EV 烘进 LUT**：光谱 LUT 不含 EV；如果误把 EV 乘进格点，预览和成片会重复曝光。EV 必须在线性光上、查表前缩放。
- **LUT 缓存 key 不完整**：key 必须包含 `filmId|paperId|size`；只按胶片缓存会在换相纸后继续用旧图。
- **在 LUT 之后用曲线“修色”**：光谱链的颜色是物理链路的结果；后处理加对比/饱和会破坏胶片与相纸的响应，应该改上游 profile 或 `bake()`。
- **halation threshold 不要设 1**：`(nrm - threshold)/(1 - threshold)` 会除零；保持在 0.5–0.85。
- **颗粒网格/重复**：GPU 不要退回浮点大坐标 hash；使用 512 噪声纹理 + 双尺度采样，并且必须按 512 块加整数位移。少了这一步，灰场上每隔 512px 会出现同一片颗粒。
- **颗粒像数码噪点**：先检查是不是细粒权重太高、彩色通道差太大，或者 ga 没有软限幅；不要只靠降低 `amount`。
- **颗粒尺寸与分辨率**：1px 细粒在 1920 成片和 720 缩略图上的物理大小不同；缩略图直接缩放，不要再生成一遍颗粒。
- **bloom 与 halation 共用遮罩**：改 `halation.threshold` 会同时改变 bloom 的覆盖范围；如果只想调 bloom，优先改 `bloom.amount`，不要动阈值。
- **镜头层方向算错**：GPU 的 `dir` 必须是 `normalize(p)`，不能用「归一化半径」去除像素坐标；后者会让 CA 变成整帧级偏移（v1.16.0 开发中出现过，灰底会整片发紫）。
- **镜头过强**：先看 8px 黑白棋盘/格子图的四角；`softness` 超过 1.5 或 `ca` 超过 1.5 会明显削弱文字和细节。取景预览不叠加镜头层，不能只靠取景判断。
- **CPU 镜头近似**：CPU 的柔化是 5-tap 邻域、色差是双线性，和 GPU 的 12-tap 不完全一样；角落会略硬。改参数时两边都要看成片。
- **预览与成片不一致**：确认效果是否本来就不在预览里（镜头/颗粒/光晕/bloom/闪光/日期）。
- **Y 轴方向**：GPU 源纹理 `UNPACK_FLIP_Y_WEBGL = true`；光谱图集上传时临时改为 `false`，漏光/日期/坐标方向容易在这里搞反。
- **日期水印**：在管线外由 Canvas2D 叠加，使用冲印时的系统日期；拍摄跨午夜时可能与快门时间差一天。
- **8-bit 图集 banding**：3D LUT 以 8-bit 图集上传，极端渐变可能出现台阶；需要时提高图集精度或加 dither，但会改变现有观感。

---

### 4.17 光谱链路（spektrafilm 移植，唯一色彩引擎）

这是当前唯一的色彩引擎：不再有 256 级 LUT、串扰矩阵、色相饱和度与分离
调色，而是直接查一张 33³ 的显示 sRGB → 显示 sRGB 3D LUT。空间效果
（镜头、光晕、bloom、颗粒、暗角、漏光、闪光）接在色彩之后，参数来自
`Spektra.effectsFor()`。胶卷与相纸分别占暗房台的两个标签页；换卷/换纸
都会重新烘焙当前组合。

**来源与许可**：算法与胶片 / 相纸数据来自
[spektrafilm](https://github.com/andreavolpato/spektrafilm)（Andrea Volpato）。
代码 GPL-3.0-or-later，profile 数据 CC BY-SA 4.0；本项目整体同为
GPL-3.0-or-later。完整署名与修改说明见 `THIRD_PARTY.md`，上游 profile
许可原文见 `third_party/spektrafilm/SPEKTRAFILM_LICENSE.txt`。**不要删除
这些文件或其中的署名**，这是数据许可的强制要求。

#### 数据包

`js/spektra-data.js` 由 `tools/build-spektra-data.py` 生成，结构：

```
S.SPEKTRA_DATA = {
  version, source,
  shared: { cmf, illu: {D50,D55,D65,'TH-KG3'}, dichroic, logExposure,
            kg3, oklabCmax },
  films: [ { id, name, code, en, tone, process, iso, type, positive,
             ref, view, antihalation, use, consumer, cine, push, target,
             mIn, tc, tcSize, tcMax, dc, cd, bd, coupler } ],
  papers:[ { id, name, kind, type, positive, view, sens, cd, bd,
             centers, amps, sigmas, mOut } ],
  neutral: { paperId: { filmId: [C,M,Y] } }
}
```

- `tc`：每张胶片按 hanatos2025 方法预计算的 49×49×3 光谱上采样 LUT，
  `tcMax` 是 Uint16 量化前的最大值；运行时按方形坐标
  `xq=(1−x)², yq=y/(1−x)` 双线性采样。
- `dc`：胶片密度曲线（256×3，未归一化）；`cd` / `bd`：染料通道密度与
  片基密度（81 个波长，380–780nm，5nm）；`coupler`：DIR coupler 矩阵。
- `sens`：相纸光谱灵敏度（81×3）；`centers/amps/sigmas`：相纸密度曲线的
  三层正态 CDF 参数。
- `mIn` / `mOut`：线性 sRGB D65 → 胶片参考光源 XYZ（CAT16）与
  相纸观察光 XYZ → sRGB（CAT02）。
- `neutral`：上游 `neutral_print_filters.json` 的中性滤色片 CC 值；
  缺组合时回退 `[0,65,55]`。

`tools/build-spektra-data.py` 的输入是上游 checkout（profiles + `irradiance_xy_tc.npy`
+ 滤色片数据）。重新生成：

```bash
python3 tools/build-spektra-data.py --upstream /path/to/spektrafilm --out js/spektra-data.js
```

#### 运行时链路

`Spektra.bake(filmId, paperId, 33)` 对每个 LUT 格点执行：

1. 显示 sRGB → 线性 sRGB（`srgbToLinear`）。
2. 胶片 raw：`mIn` → XYZ → xy → 方形坐标 → 查 `tc` → 乘 `b=ΣXYZ`。
3. 胶片显影：密度曲线 + DIR coupler 反推（`developFilm`）。
4. 负片走相纸：胶片染料密度 → 透射光 → 乘相纸灵敏度 → 乘中灰曝光因子。
   中灰因子用未归一化密度曲线在输入 0.184 处计算，取三通道几何平均的
   倒数，对应上游 `_compute_exposure_factor_midgray`。
5. 负片相纸显影：三层正态 CDF 密度模型。
6. 扫描：染料密度 → D50 光 → XYZ → sRGB 矩阵（`mOut`）。
   反转片（`film.positive`）在第 3 步后直接扫描胶片，不再走第 4–5 步；
   扫描亮度按输入 0 / 1 显影后的黑 / 白密度线性归一到 0.01–0.98，
   因此相纸选择不参与反转片成像。
7. 输出色域映射：上游 `oklch` 变体，按 48×360 的 C_max 表做 Reinhard
   软膝压缩。
8. 线性 sRGB → 显示 sRGB，写入 Float32 LUT。

LUT 的输入输出都是**显示 sRGB**，所以取景视频 / 导入的 8-bit 图可以
直接查表。EV 不烘进 LUT：CPU / GPU 都先把输入解码到线性光、乘 `2^EV`、
再编码回显示 sRGB 后查表；超过 1.0 的高光钳到 1.0（LUT 只覆盖显示白点
以内），这是与上游线性 ProPhoto 输入的主要差异之一。

#### 采样与集成

- CPU：`films.js` 的 `render()` 在 `opt.spectralLut` 存在时走
  `spektra.sampleSrgb()`，其余空间效果不变。
- 成片 GPU：`gpu-develop.js` 的 `COLOR_FS` 只做光谱采样；LUT 以 2D 图集
  上传到纹理单元 2，每层内用线性过滤做双线性，两层之间手动 `mix()`，
  共 2 次采样。
- 取景 GPU：`app.js` 的 `GL_FS` 同样在纹理单元 2 上采样图集，`lutKey`
  就是 `spec.key`（含胶片/相纸/尺寸），换卷/换纸才重新上传。
- Canvas2D 兜底：`drawPreview2D()` 把同一份 LUT 传给 `S.render()`。
- 灯箱元数据记录 `spectral` / `spectralFilm` / `spectralPaper` 与名称；
  旧底片没有这些字段时只显示乳剂代号。

性能与内存：本机 33³ 烘焙约 90–150ms，数据包约 600KB；LUT 只保留当前
一组，换卷/换纸会重新计算（防抖 80ms）。光谱数据在启动后自动加载，
不在首屏 HTML 里同步阻塞；加载完成后才允许按快门。胶卷库与相纸页分别
渲染 20 张乳剂卡和 8 张相纸卡，选择后立即更新暗盒与预览。

#### 与上游的差异

- 输入是显示 sRGB，上游默认是线性 ProPhoto RGB；超出 sRGB 色域的颜色
  会被钳制，无法完全复现上游对 ProPhoto 深绿 / 深青的处理。
- `tc` LUT 从 192×192 重采样到 49×49，并且最终再烘焙到 33³；中性灰
  误差约 1e-3 级，饱和色在 0.01–0.02 sRGB 量级。
- 未移植：裁切、自定义调色、Raw 解码、镜头 / 传感器模拟、扫描仪 LUT、
  眩光、扩散、颗粒、光晕。SPOOLO 自己的空间效果仍会叠加在光谱色彩上。
- 相纸 / 胶片组合没有做兼容性限制，任意组合都可选；反转片直接扫描胶片，
  相纸不参与成像。负片的中性滤色片数据按「相纸 → 光源 → 胶片」查找，
  缺失时回退固定值。

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
- 只有实际删除成功的记录才进入成功提示与撤销集合；读取或删除失败会重新读取实际影集，部分失败显示各自数量。影集异步刷新按序号只让最后一次请求重绘，避免并发拍摄、删除与撤销把旧快照盖回来。
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
- 胶卷 / 相纸卡片与影集缩略图重绘时保留仍存在的焦点；异步删除完成后不再次抢占用户已经移动的焦点。

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

桌面快速预览：

```bash
python3 -m http.server 8123
```

访问 `http://localhost:8123/`。`localhost` 是安全上下文；直接用局域网 HTTP 地址测试手机摄像头则会被浏览器拦截。

需要 HTTPS 时：

```bash
python3 tools/https-server.py
```

`tools/https-server.py` 只用 Python 标准库提供静态服务，自动调用 OpenSSL 生成 30 天自签名证书。证书、私钥位于独立临时目录，不进入仓库；SAN 包含 `localhost`、`127.0.0.1`、`::1` 和检测到的局域网 IPv4。默认监听 `0.0.0.0:8443`，启动日志会列出本机与局域网 URL。

- 自签名证书首次使用需要浏览器确认；如果镜头仍被限制，需要把证书加入设备信任。
- 可用 `--cert /path/cert.pem --key /path/key.pem` 使用已有 PEM 证书，避免每次自动启动生成新证书。
- `--host` / `--port` / `--directory` 可覆盖监听地址、端口和静态目录，完整说明见 `--help`。
- 默认监听所有网卡会向同一网络暴露仓库静态文件，只在可信网络中启动；`Ctrl+C` 停止。
- 真机摄像头、系统分享、LED torch 与硬件 GPU 不能由桌面模拟替代，仍需在目标设备上验收。

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

  取景上下文丢失后应退回 2D。成片离屏上下文也要单独测试：`GLDevelop.render()` 在渲染前后检查上下文，并检查 `getError()`；上下文丢失、OOM、FBO 不完整或普通 GL 错误都必须让 `app.js` 回退 CPU，不能把尚未冲印的源画布直接编码成照片。

- **IndexedDB 不可用**：在页面脚本前让 `indexedDB.open` 抛错，应用会走内存兜底并提示“仅本次会话”。
- **摄像头拒绝/无摄像头**：拒绝权限后应显示“镜头权限被拒绝 / 重试 / 导入底片”，导入后仍可完整拍摄。
- **旧缩略图迁移**：用 DevTools 向 IndexedDB 写入一条没有 `thumbW` 的记录，打开影集看是否自动变成 720。
- **iOS 卡死模拟**：在抽屉打开时 `video.pause()`、清空 `srcObject`、手动 dispatch `ended`，或让 WebGL 上下文丢失，然后关闭抽屉，观察是否恢复。

### 7.3 建议的回归清单

**拍摄主链路**

- 20 种光谱乳剂各拍一张，编码/尺寸正确；其中 4 种反转片确认取景、成片与灯箱都是正像。8 种相纸各换一次，确认负片 LUT 重烘焙；反转片换纸画面应保持不变。
- EV 到 ±2.0，预览/成片变化一致。
- 颗粒开关开/关各拍一张，确认成片有/无颗粒，刷新后状态保持。
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

- 无 WebGL、取景上下文丢失、IndexedDB 禁用。
- 成片离屏上下文丢失及普通 GL 错误后必须回退 CPU；与直接 CPU 冲印对照，不能把未处理的源画面编码成照片。
- 注入 IndexedDB `delete` 失败，覆盖单张、批量与部分失败：提示和撤销数量必须准确；删除尚未完成时继续拍摄，最终 UI 与数据库一致且无重复卡片。
- 阻断 `spektra-data.js` 后，暗房状态、机身信息与快门 Toast 都应显示加载失败；恢复后刷新可拍。
- 相纸键盘选择、桌面胶卷切换及影集异步刷新要保留焦点；异步删除完成不能抢走用户的新焦点。
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
  - `README.md` 头部
  - 所有 CSS/JS 的 `?v=` 指纹（包括 `app.js` 里动态注入的 `js/spektra*.js`）
- 发布：提交到特性分支 → 测试 → 快进合并 `main` → 推送；GitHub Pages 从 `main` 根目录发布。
- 改动色彩/乳剂时，至少更新 README 的乳剂表；新增/修改管线时同步更新本文第 4 节。
- 不要引入构建步骤或运行时依赖；保持单文件可读、可直接部署。

---

## 9. 已知限制与设计取舍

- **显示参考色彩**：输入/输出是 sRGB；光谱采样内部会做线性化，但不做 ICC/广色域；换设备可能略有差异。
- **光谱链是移植子集**：输入是显示 sRGB（上游默认线性 ProPhoto RGB），超出 sRGB 的颜色会被钳制；`tc` LUT 从 192² 降到 49²，最终色彩再烘焙到 33³，饱和色与上游有约 0.01–0.02 sRGB 的差异。裁切、自定义调色、Raw 解码、扫描仪 LUT、眩光/扩散等没有移植。
- **光谱 LUT 只保留当前一组**：换胶片/相纸会重新烘焙（90–150ms，防抖 80ms），启动时还会下载约 600KB 的数据包；离线环境第二次打开会命中浏览器缓存，但清缓存后需要重新联网。
- **8-bit 图集**：33³ LUT 以 8-bit 图集上传 GPU，极端渐变可能 banding；没有 dithering。
- **预览 ≠ 成片**：取景只有光谱 LUT 与 CSS 暗角/漏光近似；不含镜头柔化/色差、颗粒、halation、bloom、闪光、日期。
- **镜头层是成片专属**：CPU 柔化比 GPU 略硬；灰尘/划痕、片框/齿孔默认不烘进成片。
- **CPU/GPU 不完全一致**：镜头/光晕/bloom 模糊核、精度、FBO 8-bit 会带来轻微差异；以视觉一致为目标。
- **颗粒是成片分辨率的像素级效果**：1px 细粒 + 2–5px 低频团块在成片分辨率上生成；缩略图直接缩放，尺寸小的时候看起来更细。高感卷的团块更明显，但在纯灰场上仍会比真实胶片更均匀。
- **日期是冲印时系统时间**：不是快门时间的独立快照；跨午夜可能差一天。
- **成片长边上限 1920**；导入小图不放大。
- **导入格式受浏览器解码能力限制**：JPEG / PNG / WebP / GIF / AVIF 可用；HEIC/HEIF、TIFF、相机 RAW、JPEG XL 在多数桌面浏览器里无法解码，需先导出 JPEG。手机相册的“兼容性最佳”或分享时选择 JPEG 可以避免 HEIC。导入优先使用 `blob:` URL，大图不必先转成几十 MB 的 base64。
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
| LUT | Look-Up Table；本项目指 spektrafilm 烘焙的 33³ 显示 sRGB 3D LUT |
| EV | 曝光补偿，以档为单位；UI 以 1/3 档步进，在线性光上缩放后查 LUT |
| halation | 胶片高光在乳剂层间反射形成的橙红光晕 |
| bloom | 高光向周围扩散的柔和辉光；用比 halation 更宽的第二级模糊实现 |
| grain | 颗粒：细粒随机扰动 + 低频团块，按亮度加权并软限幅，暗部更明显；可用功能键关闭 |
| lens softness | 镜头边缘柔化；中心 0、角落最强，按分辨率缩放 |
| lateral CA | 横向色差；R/B 通道沿径向反向偏移，绿通道不动 |
| display-referred | 输入/输出在 sRGB 显示空间；光谱采样内部临时线性化 |
| FBO | WebGL Framebuffer Object，离屏渲染目标 |
| ping-pong | 两张纹理交替作为输入/输出做多轮模糊 |
| screen blend | `1-(1-a)(1-b)`，光晕用的加法混合 |
| DPR | devicePixelRatio，设备像素比 |
| store-only ZIP | 只存不压缩的 ZIP（method 0） |
| 光谱链 | 用 spektrafilm 的胶片/相纸数据走完整光谱色彩链；当前唯一色彩引擎 |
| tc LUT | hanatos2025 光谱上采样查找表，按方形坐标 `xq=(1−x)², yq=y/(1−x)` 索引 |
| DIR coupler | 显影抑制剂释放（Development Inhibitor Releasing）耦合项，让一层密度影响另一层 |
| 3D LUT | 三维颜色查找表；本项目用 33³ 格点 + 三线性采样 |
| CDF 密度模型 | 相纸密度曲线用三层正态累积分布函数叠加表示 |
| OkLch | 以 OKLab 为基础的感知均匀色空间；输出色域压缩在其 L/C 平面上做软膝 |

---

如果这份文档和代码不一致，以代码为准；但请顺手把文档改掉——接力开发最怕的是“看起来懂了，实际管线已经变了两版”。
