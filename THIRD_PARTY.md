# 第三方来源与许可

SPOOLO 的**代码**以 **GNU GPL v3 或更高版本（GPL-3.0-or-later）** 发布，
见根目录 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

其中「光谱胶片模拟」移植自 **spektrafilm**。该移植包含两部分不同许可的
材料，必须同时保留下面的署名与许可说明。`js/spektra-data.js` 中的 profile
数据不属于 GPL 授权范围，而是单独按 CC BY-SA 4.0 授权。

## spektrafilm（算法与代码）

- 项目：spektrafilm — <https://github.com/andreavolpato/spektrafilm>
- 作者：Andrea Volpato
- 代码许可：**GPL-3.0-or-later**
- 本项目中的衍生文件：
  - `js/spektra.js`（浏览器端的胶片曝光、显影、相纸曝光 / 显影 / 扫描、
    输出色域映射与 3D LUT 烘焙）
  - `tools/build-spektra-data.py`（数据构建脚本，算法部分同样是衍生作品）

本移植只保留上游的「胶片 → 负片相纸扩印 / 反转片直接扫描」色彩链，并为了
浏览器运行做了以下修改（Modified by the SPOOLO project / SEEKERSUNG, 2026）：

- 用 JavaScript 重写为无依赖、无构建的浏览器模块；
- 光谱上采样使用按胶片预计算的 49×49 `tc` LUT，而不是上游运行时的
  192×192 LUT；
- 最终色彩链在运行时烘焙为 33³ 的显示 sRGB → 显示 sRGB 3D LUT，以
  2D 图集 + 双线性采样的方式在 WebGL1 中运行；
- 输出色域映射使用上游 `oklch` 变体，并量化为 48×360 的 C_max 表；
- 没有移植裁切、自定义调色、Raw 解码、镜头 / 传感器模拟、光晕、
  颗粒、眩光、扩散、扫描仪 LUT 等模块；这些空间效果仍由 SPOOLO
  自己的管线完成。

## spektrafilm profiles（胶片 / 相纸数据）

`js/spektra-data.js` 是上游 `src/spektrafilm/data/profiles/*.json` 的
直接衍生编码（derived encoding），包括胶片光谱灵敏度、密度曲线、
DIR coupler、相纸感光曲线、染料密度、中性滤色片等。

- 原作者：**Andrea Volpato**
- 原项目：<https://github.com/andreavolpato/spektrafilm>
- 数据许可：**Creative Commons Attribution-ShareAlike 4.0 International
  (CC BY-SA 4.0)**
- 许可全文：[`third_party/spektrafilm/SPEKTRAFILM_LICENSE.txt`](third_party/spektrafilm/SPEKTRAFILM_LICENSE.txt)
  （上游原文，未修改）
- 修改说明：数据被重新编码为 base64 Float32 / Uint16 数组；`tc` LUT
  重采样为 49×49；输出 C_max 表量化为 Uint16；只导出色彩链所需字段。
  修改者：SPOOLO project / SEEKERSUNG，2026 年。数据本身仍按
  CC BY-SA 4.0 提供；任何再分发或修改必须保留上述署名、来源链接、
  CC BY-SA 4.0 许可说明，并注明修改。

上游的 profile 数据许可是 CC BY-SA 4.0；SPOOLO 的代码以 GPL-3.0-or-later
发布，两者可以一起分发，但数据部分仍单独受 CC BY-SA 4.0 约束，不因放入
本仓库而转为 GPL。CC BY-SA 4.0 → GPLv3 的兼容性声明由 Creative Commons
提供；再分发时请同时满足两边的署名、许可链接与相同方式共享义务。如果你
只取用 `js/spektra-data.js` 中的数据，请按 CC BY-SA 4.0 履行义务。

## 商标说明

SPOOLO 和 spektrafilm 都不隶属于 Kodak、Fujifilm 或其他胶片厂商。
项目中的胶卷 / 相纸名称直接来自上游 spektrafilm profile 的 stock 名，
仅用于标识对应的测量数据；光谱数据来自公开厂商资料与上游项目的测量 /
建模，不表示任何厂商授权或背书。
