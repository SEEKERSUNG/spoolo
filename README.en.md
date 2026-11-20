[简体中文](README.md) | **English**

# SPOOLO · A Film Camera in Your Browser

> **Version v1.24.3**
> Try it online: <https://seekersung.github.io/spoolo/>
> Source repository: <https://github.com/SEEKERSUNG/spoolo>
> Technical documentation: [TECHNICAL.md](TECHNICAL.md)

> Versioning: every change increments the version number—bug fixes and minor adjustments increment the patch number, while UI or feature changes increment the minor number.
> The version appears on the top plate (and at the bottom of the darkroom sidebar on desktop), in the README, and in static resource fingerprints (`?v=`); update all of them together.

A 135 film camera that works as soon as you open the webpage: live view, a mechanical shutter feel, and a darkroom where you can develop your photos again and again. All colors come from the spectral film and paper simulation in [spektrafilm](https://github.com/andreavolpato/spektrafilm): negative film follows “exposure → paper enlargement → scanning,” while reversal film is scanned directly. Everything runs in the browser as a fully static site with no build step and no dependencies.

## Films (20 Spectral Emulsions)

The film library uses the original film and paper names from the upstream spektrafilm profiles and identifies their source. The previous synthetic color-emulation films and 1D curve LUTs have been removed; all colors are now calculated by the spectral pipeline.

| Code | Name | Process | ISO | Type |
| --- | --- | --- | --- | --- |
| EKT100 | Kodak Ektar 100 | C-41 | 100 | Negative |
| P160 | Kodak Portra 160 | C-41 | 160 | Negative |
| P400 | Kodak Portra 400 | C-41 | 400 | Negative |
| P800 | Kodak Portra 800 | C-41 | 800 | Negative |
| P800+1 | Kodak Portra 800 (Push 1) | C-41 | 800 | Negative |
| P800+2 | Kodak Portra 800 (Push 2) | C-41 | 800 | Negative |
| G200 | Kodak Gold 200 | C-41 | 200 | Negative |
| UM400 | Kodak Ultramax 400 | C-41 | 400 | Negative |
| V50D | Kodak Vision3 50D | ECN-2 | 50 | Negative |
| V250D | Kodak Vision3 250D | ECN-2 | 250 | Negative |
| V200D | Kodak Verita 200D | ECN-2 | 200 | Negative |
| V200T | Kodak Vision3 200T | ECN-2 | 200 | Negative |
| V500T | Kodak Vision3 500T | ECN-2 | 500 | Negative |
| 400H | Fujifilm Pro 400H | C-41 | 400 | Negative |
| C200 | Fujifilm C200 | C-41 | 200 | Negative |
| X400 | Fujifilm X-Tra 400 | C-41 | 400 | Negative |
| E100 | Kodak Ektachrome 100 | E-6 | 100 | Reversal |
| K64 | Kodak Kodachrome 64 | K-14 | 64 | Reversal |
| V100 | Fujifilm Velvia 100 | E-6 | 100 | Reversal |
| P100F | Fujifilm Provia 100F | E-6 | 100 | Reversal |

Eight papers are available separately in the darkroom’s “Paper” tab: Portra Endura, Endura Premier, Supra Endura, Ektacolor Edge, Ultra Endura, Fujifilm Crystal Archive Type II, Kodak 2383, and Kodak 2393. Reversal film is scanned directly and does not pass through paper.

## Spectral Pipeline (from spektrafilm)

At startup, SPOOLO loads 20 negative/reversal films and 8 color papers, then runs them through a simplified spectral development pipeline:

```
Display sRGB → film spectral upsampling → film exposure → development (density curves + DIR coupler)
Negative  → paper exposure (dichroic filters + paper spectral sensitivity) → paper development → scanning
Reversal  → direct film scan (normalized to the developed black/white densities)
```

For each film, the implementation precomputes a 49×49 `tc` LUT, then bakes a 33³
display sRGB → display sRGB 3D LUT in the browser. The viewfinder preview and final
image share the same LUT; EV scales the linear light before the lookup. Grain,
halation, vignetting, light leaks, and lens softening are applied after the LUT.
The data and algorithms come from **spektrafilm** (by Andrea Volpato):

- Project: <https://github.com/andreavolpato/spektrafilm>
- Code: GPL-3.0-or-later; film/paper profile data: CC BY-SA 4.0
- This port includes only the film and paper color pipeline. It does not port cropping, custom grading, Raw decoding, scanner LUTs, grain, halation, glare, or similar modules; SPOOLO still implements those spatial effects itself.
- Input is treated as display sRGB. Upstream uses linear ProPhoto RGB by default, so colors outside the sRGB gamut are clamped—a trade-off imposed by the web camera’s input format.
- Data was checked against upstream commit `3bb2c2d2801ff68b92019cf1dbcbb133d60832bc`: Vision3 200T / 500T use the `T` incandescent reference illuminant, while Kodak 2383 / 2393 use `K75P` for viewing. Reversal-film scanning illuminants and output matrices depend only on the film itself and never change with the selected paper.

See [THIRD_PARTY.md](THIRD_PARTY.md) for full attribution, modification notes, and license obligations. The upstream profile license is preserved at
[`third_party/spektrafilm/SPEKTRAFILM_LICENSE.txt`](third_party/spektrafilm/SPEKTRAFILM_LICENSE.txt).

## Features

- **Live view**: uses the camera (`getUserMedia`), switches between front and rear cameras, and crops the viewfinder for the device orientation (3:4 in portrait; 3:2 in landscape and on desktop), so what you see is what you get. It requests a 1920×1440 4:3 stream, and WebGL renders the viewfinder colors at full device-DPR resolution on the GPU.
- **English and Simplified Chinese**: use the round metal `EN / 简` button at the upper left of the top plate, next to the rewind knob, to switch instantly without reloading, losing the current photo, or interrupting undo. Interface text, dynamic messages, and ARIA labels update together; the language preference is stored locally, and Simplified Chinese is the default.
- **Instant film changes**: turn the top-plate dial or select a film in the library to bake a 33³ LUT from the spektrafilm film pipeline on demand (negative film via paper enlargement; reversal film via direct scan). The viewfinder immediately takes on that emulsion’s colors.
- **Spectral simulation is the only color engine**: 20 spectral films × 8 papers (reversal film is scanned directly; paper applies only to negative film). Data and code are lazily loaded at startup, totaling about 600 KB without blocking the initial viewfinder. The dial cycles through spectral films, while the darkroom’s “Paper” tab selects paper separately.
- **Grain toggle**: the function keys include a “Grain” button that controls whether dual-scale grain is added during final development; the setting is saved in local preferences.
- **Mechanical feel**: synthesized sound effects (a two-stage shutter click plus low-frequency thunk, dial clicks, and rewind sounds, all generated live with WebAudio and no audio files); exposure compensation from −2 to +2 EV in 1/3-stop increments; self-timer, composition grid, and date imprint.
- **Flash**: the function key cycles through off / auto / forced; auto mode triggers according to viewfinder brightness. Browsers that support hardware `torch` (mostly Chrome on Android) light the LED directly. Other environments, including Safari on iPhone, automatically fall back to a full-screen fill light, add warm light to the center of the final image, and record the trigger method in the negative’s metadata. The white screen remains for about 0.7 seconds to give the camera’s auto-exposure time to respond; if the image is still very dark after the flash, SPOOLO takes another, brighter frame and compensates by up to 4 EV. Note: with the rear camera, the phone’s screen faces away from the subject and cannot illuminate it. On an iPhone without hardware LED support for the rear camera, SPOOLO can only brighten the image as much as possible and suggest using the front camera or adding ambient light.
- **36 exposures per roll**: the counter decreases with each shot, a full roll rewinds automatically, and manual rewind is also available.
- **Darkroom development**: after capture, a four-step animation runs through “Exposure / Development / Fixing / Drying.” The WebGL pipeline applies the spectral LUT, lens softening/chromatic aberration, halation/global bloom, grain, vignetting, light leaks, flash, and date watermark on the GPU. Images are rendered at the lens source resolution (1080×1440 for a phone in portrait, up to a 1920px long edge on desktop), with the CPU pipeline as a fallback.
- **Faster development**: invisible viewfinder uploads and drawing pause behind the processing overlay, GPU texture storage is reused, and the full JPEG and matching thumbnail are encoded in parallel. Animation waits overlap real work without changing resolution, spectral LUTs, grain, or JPEG quality.
- **Album**: local IndexedDB storage, with a lightbox for negative metadata, local saving, and deletion with a 6-second undo window. Thumbnails are scaled directly from the 720px final images, so their grain patterns match the images opened in the lightbox. Older negatives are rebuilt on demand in the background when the album opens. Batch management supports multi-select/select all, batch saving (system sharing on mobile; ZIP archives on desktop), and batch deletion with undo.
- **Import and develop**: send a local photo to the darkroom as a negative and develop it with any film. JPEG / PNG / WebP / GIF / AVIF are supported. HEIC/HEIF, TIFF, camera RAW, and JPEG XL must first be exported as JPEG because browsers cannot decode these formats natively; on failure, the viewfinder explains the specific reason and suggests how to export the image. When a file’s MIME type is empty or `application/octet-stream`, SPOOLO also recognizes explicit image extensions instead of incorrectly rejecting a valid image.
- **Graceful degradation**: when no camera is available or permission is denied, the viewfinder offers only “Retry” and “Import Negative.” Importing one photo is enough to complete the full capture and development workflow.
- **Error recovery**: loss of the offscreen WebGL context or a rendering error automatically falls back to the CPU. Album deletion feedback reflects what was actually persisted, supports partial failure and undo, and asynchronous refreshes cannot bring back old photos or duplicate cards.
- **Responsive and accessible**: a persistent darkroom sidebar on desktop and a bottom drawer on narrow screens; Space for the shutter, `G` for the grid, `F` to flip the camera, `T` for the timer, `D` for the date, `M` for shutter sound, and `Esc` to close panels. The film dial and EV wheel use `role="slider"`, toggles use `aria-pressed`, and `prefers-reduced-motion` is respected.

## Color Engine

- **Spectral color pipeline**: display sRGB → film spectral upsampling → film exposure → development (density curves + DIR coupler) → paper exposure/development/scanning for negative film, or direct film scanning for reversal film → output gamut mapping. A 33³ display-sRGB 3D LUT is baked on demand for each film × paper combination. The CPU uses Float32 trilinear sampling; the GPU uses a WebGL1 2D atlas with two bilinear layers.
- **Exposure compensation**: EV is not baked into the LUT. Instead, linear light is scaled before the lookup, and the viewfinder preview and final image share the same LUT and EV semantics.
- **Lens optics (P2)**: the center stays sharp while softness increases toward the edges; the R and B channels shift radially in opposite directions to create lateral chromatic aberration. Intensity scales relative to a 1080px short edge. Dust/scratches and the film frame are not baked into final images by default, and the viewfinder preview does not add lens softening or chromatic aberration.
- **Grain**: a dual-scale model combining fine `Math.imul` hash grain with clumps of low-frequency value noise. It is weighted toward midtones, boosted in shadows, converges in highlights, and softly limits the total amount. Color is dominated by luminance grain with only very weak channel differences, avoiding colored digital noise when enlarged. Strength is mapped from spektrafilm film data (ISO, consumer/cinema stock, push processing, and reversal film). The “Grain” function key can disable it entirely.
- **Halation**: half-resolution highlight mask → two separable box-blur passes → screen blending, with threshold, radius, and color taken from the current emulsion. Global bloom reuses the same highlight mask with a larger blur radius to create a broader, softer lens glow.
- **Vignetting and light leaks** are synthesized from radial masks and gradients.
- **Preview/final consistency**: the viewfinder applies only the spectral LUT (plus CSS vignette/light-leak overlays). Grain, halation, and bloom are not applied in the viewfinder; they are added once when the final image is developed. The final image uses the complete pipeline, and both paths share the same parameters. WebGL performs LUT sampling on the GPU for the preview and displays it at full device-DPR resolution. Without WebGL, it falls back to Canvas2D with an adaptive budget of roughly 120,000–300,000 pixels. The viewfinder runs at a fixed 30 fps.

## Run Locally

### Quick Desktop Preview (HTTP)

```bash
python3 -m http.server 8123
```

Open <http://localhost:8123/>. `localhost` is already a secure context, so HTTPS is not mandatory for desktop camera testing.

### Phone and LAN Camera Testing (HTTPS)

```bash
python3 tools/https-server.py
```

The tool uses only the Python standard library; automatically generating a certificate requires OpenSSL on the system. It listens on `0.0.0.0:8443` by default and prints the available addresses after startup:

- This computer: <https://localhost:8443/>
- Phone and computer on the same network: `https://<LAN-IPv4>:8443/` (replace this with the actual address shown in the startup log)

Automatically generated self-signed certificates are valid for 30 days. The certificate and private key are stored in a separate temporary directory, never in the repository, and every automatic startup generates a new certificate. The first time you open the site, you must confirm in the browser that you want to proceed. If the browser still restricts camera access, install and trust the certificate, or provide an existing PEM certificate:

```bash
python3 tools/https-server.py --cert /path/to/cert.pem --key /path/to/key.pem
```

Run `python3 tools/https-server.py --help` to see options for the listening address, port, static directory, and more. Listening on all interfaces by default exposes the repository’s static files to other devices on the same network, so use it only on a trusted network and press `Ctrl+C` to stop it when testing is complete.

> `getUserMedia` is available only over HTTPS or on `localhost`. If you open `index.html` directly (`file://`), most browsers will deny camera permission. In that case, select “Import Negative” in the viewfinder and choose a photo to complete the full capture and development workflow.
> Opening the site over HTTP using a LAN IP causes browsers to block the camera outright; you must use HTTPS (GitHub Pages already provides HTTPS). A self-signed certificate also requires browser trust confirmation.

## Project Structure

```
index.html          Camera body: top plate / viewfinder / film chamber / controls / darkroom / lightbox
favicon.svg         Browser tab icon
css/base.css        Design tokens, layout, camera body, and viewfinder
css/ui.css          Dials, function keys, shutter, film cards, album, drawers, and other components
js/i18n.js         English/Chinese dictionary and translation of static text and dynamic count phrases
js/films.js         Grain / halation / vignette / light-leak / lens pixel pipeline after the spectral LUT
js/spektra.js       Spectral film simulation (3D LUT baking and sampling shared by GPU / CPU)
js/spektra-data.js  Compressed spectral film / paper data (lazily loaded at startup, about 600 KB)
js/gpu-develop.js   Final-image WebGL pipeline (color / halation / grain / vignette / light leaks / flash)
js/zip.js           Store-only ZIP packaging for batch saving
js/store.js         IndexedDB negative storage (falls back to memory when unavailable)
js/app.js           Viewfinder, shutter, development, film/paper and album, import, and audio
tools/build-spektra-data.py  Generates js/spektra-data.js from upstream profiles
tools/https-server.py     Local HTTPS static server and temporary self-signed certificate
third_party/spektrafilm/     Original upstream profile license
LICENSE / NOTICE    Full GPL-3.0 text and project copyright / licensing notices
TECHNICAL.md        Technical documentation: architecture, color pipeline, data model, extension, and debugging
README.en.md        English guide: features, emulsion list, local setup, and licensing
THIRD_PARTY.md      Third-party sources, attribution, and licensing notes
```

## License

SPOOLO’s code is released under **GPL-3.0-or-later**; see [LICENSE](LICENSE) for the full text and [NOTICE](NOTICE) for copyright and licensing notices.

The spectral pipeline’s data and algorithms come from [spektrafilm](https://github.com/andreavolpato/spektrafilm): the code is GPL-3.0-or-later, and the film/paper profile data is CC BY-SA 4.0, by Andrea Volpato. `js/spektra-data.js` is a directly derived encoding of the upstream profiles, provided under CC BY-SA 4.0 rather than the GPL. Redistribution or modification must preserve attribution, source links, license notices, and modification records. See [THIRD_PARTY.md](THIRD_PARTY.md) for details; the original upstream license is available at
[`third_party/spektrafilm/SPEKTRAFILM_LICENSE.txt`](third_party/spektrafilm/SPEKTRAFILM_LICENSE.txt).

## Deployment

The repository is a fully static site. To publish it with GitHub Pages, select the root directory of the `main` branch under **Settings → Pages**.
