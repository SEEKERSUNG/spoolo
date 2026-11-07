# SPOOLO · 一台网页里的胶片相机

> **版本 v1.21.0**
> 在线体验：<https://seekersung.github.io/spoolo/>
> 源码仓库：<https://github.com/SEEKERSUNG/spoolo>
> 技术文档：[TECHNICAL.md](TECHNICAL.md)

> 版本规则：每次改动都递增版本号——修 bug、小调整进末位，界面或功能改动进中间位。
> 版本号同时出现在顶盖铭牌（桌面端另有暗房侧栏底部）、README 与静态资源指纹（`?v=`）三处，一起改。

打开网页就能拍的 135 胶片相机：实时取景、机械快门手感，还有一间可以反复冲印的暗房。色彩全部来自 [spektrafilm](https://github.com/andreavolpato/spektrafilm) 的光谱胶片 / 相纸模拟：负片走「曝光 → 相纸扩印 → 扫描」，反转片直接扫描胶片。全部运行在浏览器里，纯静态、无构建、无依赖。

## 胶卷（20 种光谱乳剂）

胶卷库直接使用上游 spektrafilm profile 的原始胶片与相纸名称，并注明数据来源。原先那套自有的合成仿色胶卷与 1D 曲线 LUT 已移除，所有色彩都由光谱链计算。

| 代号 | 名称 | 工艺 | ISO | 类型 |
| --- | --- | --- | --- | --- |
| EKT100 | Kodak Ektar 100 | C-41 | 100 | 负片 |
| P160 | Kodak Portra 160 | C-41 | 160 | 负片 |
| P400 | Kodak Portra 400 | C-41 | 400 | 负片 |
| P800 | Kodak Portra 800 | C-41 | 800 | 负片 |
| P800+1 | Kodak Portra 800（Push 1） | C-41 | 800 | 负片 |
| P800+2 | Kodak Portra 800（Push 2） | C-41 | 800 | 负片 |
| G200 | Kodak Gold 200 | C-41 | 200 | 负片 |
| UM400 | Kodak Ultramax 400 | C-41 | 400 | 负片 |
| V50D | Kodak Vision3 50D | ECN-2 | 50 | 负片 |
| V250D | Kodak Vision3 250D | ECN-2 | 250 | 负片 |
| V200D | Kodak Verita 200D | ECN-2 | 200 | 负片 |
| V200T | Kodak Vision3 200T | ECN-2 | 200 | 负片 |
| V500T | Kodak Vision3 500T | ECN-2 | 500 | 负片 |
| 400H | Fujifilm Pro 400H | C-41 | 400 | 负片 |
| C200 | Fujifilm C200 | C-41 | 200 | 负片 |
| X400 | Fujifilm X-Tra 400 | C-41 | 400 | 负片 |
| E100 | Kodak Ektachrome 100 | E-6 | 100 | 反转片 |
| K64 | Kodak Kodachrome 64 | K-14 | 64 | 反转片 |
| V100 | Fujifilm Velvia 100 | E-6 | 100 | 反转片 |
| P100F | Fujifilm Provia 100F | E-6 | 100 | 反转片 |

相纸在暗房台的「相纸」标签页单独选择，共 8 种：Portra Endura、Endura Premier、Supra Endura、Ektacolor Edge、Ultra Endura、Fujifilm Crystal Archive Type II、Kodak 2383、Kodak 2393。反转片直接扫描胶片，不经过相纸。

## 光谱链（来自 spektrafilm）

启动时载入 20 种负片 / 反转片与 8 种彩色相纸，走一遍简化的光谱冲印链：

```
显示 sRGB → 胶片光谱上采样 → 胶片曝光 → 显影（密度曲线 + DIR coupler）
负片   → 相纸曝光（二向色滤色片 + 相纸光谱灵敏度）→ 相纸显影 → 扫描
反转片 → 直接扫描胶片（按显影后的黑 / 白密度归一化）
```

实现上按胶片预计算 49×49 的 `tc` LUT，再在浏览器里现场烘焙 33³ 的
显示 sRGB → 显示 sRGB 3D LUT；取景预览与成片共用同一份 LUT，EV 在线性
光上缩放后查表。颗粒、光晕、暗角、漏光与镜头柔化在 LUT 之后叠加。
数据与算法来自 **spektrafilm**（作者 Andrea Volpato）：

- 项目：<https://github.com/andreavolpato/spektrafilm>
- 代码：GPL-3.0-or-later；胶片 / 相纸 profile 数据：CC BY-SA 4.0
- 本移植只取胶片与相纸色彩链，没有移植裁切、自定义调色、Raw 解码、
  扫描仪 LUT、颗粒 / 光晕 / 眩光等模块；这些空间效果仍由 SPOOLO 自己完成。
- 输入按显示 sRGB 处理；上游默认使用线性 ProPhoto RGB，因此超出 sRGB
  色域的颜色会被钳制，这是网页相机输入格式带来的取舍。

完整的署名、修改说明与许可义务见 [THIRD_PARTY.md](THIRD_PARTY.md)。
上游 profile 许可原文保存在
[`third_party/spektrafilm/SPEKTRAFILM_LICENSE.txt`](third_party/spektrafilm/SPEKTRAFILM_LICENSE.txt)。

## 功能

- **实时取景**：调用摄像头（`getUserMedia`），前后摄切换，取景窗按手持方向裁切（竖屏 3:4、横屏与桌面 3:2），所见即所得。请求 1920×1440 的 4:3 流，取景色彩由 WebGL 在 GPU 上按设备 DPR 全分辨率渲染。
- **换卷即时生效**：转动顶盖旋钮或用胶卷库点选，按 spektrafilm 的胶片链现场烘焙 33³ LUT（负片经相纸扩印，反转片直接扫描），取景画面立刻变成该乳剂的色彩。
- **光谱模拟是唯一色彩引擎**：20 种光谱胶片 × 8 种相纸（反转片直接扫描，相纸只参与负片）；数据与代码在启动时懒加载，约 600KB，不在首屏阻塞取景。旋钮循环光谱胶片，暗房台的「相纸」标签页单独选择相纸。
- **颗粒开关**：功能键新增「颗粒」按钮，成片冲印时决定是否叠加双尺度颗粒；状态写入本地偏好。
- **机械手感**：合成音效（快门双响 + 低频 thunk、旋钮咔哒、回卷声，全部由 WebAudio 现场合成，不含音频文件）；曝光补偿 ±2EV 以 1/3 档步进；定时拍摄、构图网格、日期打印。
- **闪光灯**：功能键循环切换关 / 自动 / 强制；自动档按取景亮度触发。支持硬件 `torch` 的浏览器（多为 Android Chrome）直接点亮 LED，其他环境（含 iPhone Safari）自动回退为整屏补光，成片中心叠加暖光，底片信息会记录触发方式。屏幕白屏会保持约 0.7s 给摄像头自动曝光时间；若闪光后画面仍然很暗，会再取一帧更亮的并最多补回 4EV。注意：后摄的屏幕在手机背面，无法照亮前方，iPhone 后摄没有硬件 LED 时只能尽量提亮并提示改用前摄或增加环境光。
- **一卷 36 张**：计数器随拍摄递减，满卷自动回卷，也可手动回卷。
- **暗房冲印**：拍下后走「曝光 / 显影 / 定影 / 干燥」四步动画，成片由 WebGL 管线在 GPU 上完成光谱 LUT、镜头柔化/色差、光晕/全局辉光、颗粒、暗角、漏光、闪光与日期水印；按镜头源分辨率烘焙（手机竖屏 1080×1440，桌面最高 1920px 长边），CPU 管线作为兜底。
- **影集**：IndexedDB 本地存储，灯箱查看底片信息、保存到本地、删除（6 秒内可撤销）。缩略图直接从 720px 成片缩放，颗粒图案与点开后的灯箱成片同源；旧底片打开影集时会在后台按需重建。支持批量管理：多选 / 全选、批量保存（移动端系统分享，桌面打包 ZIP）与批量删除（带撤销）。
- **导入冲洗**：把本地照片当作底片送进暗房，用任意一卷冲印。支持 JPEG / PNG / WebP / GIF / AVIF；HEIC/HEIF、TIFF、相机 RAW、JPEG XL 需要先导出为 JPEG（浏览器本身不支持解码这些格式），失败时取景窗会给出具体原因和导出建议。
- **优雅降级**：没有摄像头或未授权时，取景窗上只给「重试 / 导入底片」两个出口，导入一张照片即可走完整的拍摄与冲印流程。
- **响应式与无障碍**：桌面为常驻暗房侧栏，窄屏为底部抽屉；空格快门、`G` 网格、`F` 翻转镜头、`T` 定时、`D` 日期、`M` 快门声、`Esc` 关闭面板；胶卷旋钮与 EV 滚轮为 `role="slider"`、开关为 `aria-pressed`，并遵循 `prefers-reduced-motion`。

## 色彩引擎

- **光谱色彩链**：显示 sRGB → 胶片光谱上采样 → 胶片曝光 → 显影（密度曲线 + DIR coupler）→ 负片走相纸曝光 / 相纸显影 / 扫描，反转片直接扫描胶片 → 输出色域映射。负片按胶片 × 相纸组合现场烘焙 33³ 显示 sRGB 3D LUT，CPU 用 Float32 三线性采样，GPU 用 WebGL1 2D 图集 + 两层双线性。
- **曝光补偿**：EV 不烘进 LUT，而是在线性光上缩放后查表；取景预览与成片使用同一份 LUT、同一个 EV 语义。
- **镜头光学（P2）**：中心保持锐利，越靠边越柔；R / B 通道沿径向反向偏移形成横向色差。强度按 1080px 短边缩放。灰尘/划痕和片框默认不烘进成片，取景预览也不叠加镜头柔化/色差。
- **颗粒**：细粒 `Math.imul` 哈希 + 低频 value noise 团块的双尺度模型，按中间调加权、暗部增益、高光收敛，并对总量软限幅；彩色以亮度颗粒为主、只保留很弱的通道差，避免放大后出现彩色数码噪点。强度由 spektrafilm 胶片数据（ISO、消费级/电影级、推冲、正片）映射。可用功能键「颗粒」整体关闭。
- **光晕 halation**：半分辨率亮部遮罩 → 两遍分离式盒式模糊 → screen 混合，阈值、半径与颜色来自当前乳剂。全局 bloom 复用同一亮部遮罩，再用更大的半径模糊一次，形成更宽、更柔的镜头辉光。
- **暗角与漏光**由径向遮罩与渐变合成。
- **预览与成片一致性**：取景画面只做光谱 LUT（+ CSS 覆盖层的暗角 / 漏光）；颗粒、halation 与 bloom 不在取景时叠加，只在冲印成片时一次加入；成片走完整管线，两者参数同源。预览由 WebGL 在 GPU 上完成 LUT 采样，按设备 DPR 全分辨率上屏；不支持 WebGL 时退回 Canvas2D + 约 12 万–30 万像素的自适应预算。取景固定 30fps。

## 本地运行

```bash
python -m http.server 8123
```

然后访问 <http://localhost:8123/>。

> `getUserMedia` 只在 HTTPS 或 `localhost` 下可用。直接双击 `index.html`（`file://`）时多数浏览器会拒绝摄像头权限，此时点取景窗上的「导入底片」选一张照片，即可走通完整的拍片与冲印流程。
> 手机也一样：用局域网 IP 以 http 打开会被浏览器直接屏蔽镜头，**必须走 HTTPS**（GitHub Pages 的地址天然是 https），进页面后点一下屏幕即会弹出授权。

## 目录结构

```
index.html          机身结构：顶盖 / 取景器 / 胶片仓 / 控制台 / 暗房 / 灯箱
favicon.svg         浏览器标签页图标
css/base.css        设计令牌、布局、机身与取景器
css/ui.css          旋钮、功能键、快门、胶卷卡、影集、抽屉等组件
js/films.js         光谱 LUT 之后的颗粒 / 光晕 / 暗角 / 漏光 / 镜头像素管线
js/spektra.js       光谱胶片模拟（GPU / CPU 共用的 3D LUT 烘焙与采样）
js/spektra-data.js  光谱胶片 / 相纸的压缩数据包（启动时懒加载，约 600KB）
js/gpu-develop.js   成片 WebGL 管线（色彩 / 光晕 / 颗粒 / 暗角 / 漏光 / 闪光）
js/zip.js           批量保存用的 store-only ZIP 打包
js/store.js         IndexedDB 底片存储（不可用时降级为内存）
js/app.js           取景、快门、冲印、胶卷/相纸与影集、导入、音效
tools/build-spektra-data.py  从上游 profile 生成 js/spektra-data.js
third_party/spektrafilm/     上游 profile 许可原文
LICENSE / NOTICE    GPL-3.0 全文与项目版权 / 授权声明
TECHNICAL.md        技术文档：架构、色彩管线、数据模型、扩展与调试
THIRD_PARTY.md      第三方来源、署名与许可说明
```

## 许可

SPOOLO 的代码以 **GPL-3.0-or-later** 发布，全文见 [LICENSE](LICENSE)，
版权与授权声明见 [NOTICE](NOTICE)。

光谱链的数据与算法来自 [spektrafilm](https://github.com/andreavolpato/spektrafilm)：
代码为 GPL-3.0-or-later，胶片 / 相纸 profile 数据为 CC BY-SA 4.0，
作者 Andrea Volpato。`js/spektra-data.js` 是上游 profile 的直接衍生编码，
按 CC BY-SA 4.0 提供，不属于 GPL 授权范围；再分发或修改时必须保留署名、
来源链接、许可说明和修改记录。详见 [THIRD_PARTY.md](THIRD_PARTY.md)，
上游许可原文见
[`third_party/spektrafilm/SPEKTRAFILM_LICENSE.txt`](third_party/spektrafilm/SPEKTRAFILM_LICENSE.txt)。

## 部署

仓库是纯静态站点，GitHub Pages 直接在 **Settings → Pages** 选择 `main` 分支根目录即可发布。
