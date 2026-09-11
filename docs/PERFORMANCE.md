# Performance baseline

This page records one hardware-rendered Apple M5 comparison captured on 22
August 2026 in Chrome 150 at 1440 x 900. It is not a minimum hardware
specification and should not be used to predict performance on untested systems.
The original capture artifacts are not included here, so this page records
results rather than defining a runnable benchmark.

## Test context

The baseline was captured on 22 August 2026 with these conditions:

| Setting | Value |
| --- | --- |
| Renderer | Apple M5 Metal through the hardware ANGLE path |
| Browser | Chrome 150 in a fresh isolated profile |
| Viewport | 1440 x 900 at device pixel ratio 1 |
| Focus | Page foregrounded for controlled scenes |
| Scene sample | 5 seconds of scripted motion, then 5 seconds at rest |
| Startup | Browser cache disabled; three samples |

The capture covered three startup samples, 16 cold layer scenarios with 14
measurements, 23 controlled option and stress scenes, and five
hardware-rendered overlay scenes.

## Startup

| Sample | App ready | Initial settle | Load event | Motion / rest | Used JS heap |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 784.980 ms | 2,035.082 ms | 439.5 ms | 60 / 60 FPS | 102.9 MiB |
| 2 | 604.849 ms | 1,855.836 ms | 442.4 ms | 60 / 60 FPS | 111.6 MiB |
| 3 | 558.527 ms | 1,809.592 ms | 438.8 ms | 60 / 60 FPS | 105.1 MiB |
| Median | 604.849 ms | 1,855.836 ms | 439.5 ms | 60 / 60 FPS | 105.1 MiB |

The initial-settle measurement is the more useful launch reference because it
includes the first visual and data settling window. All three samples reached
the display ceiling during both motion and rest.

## Cold layer activation

Cold activation was measured separately from warm option switching. Live object
counts are included so that future runs can compare source populations before
attributing a difference to the client.

| Layer | Activation | Source count | Motion / rest | Used JS heap |
| --- | ---: | ---: | ---: | ---: |
| CCTV city | 19,608.240 ms | 48 | 60 / 60 FPS | 192.7 MiB |
| Space Missions (report label: Rocket missions) | 3,581.066 ms | 26 | 60 / 60 FPS | 131.3 MiB |
| Radio | 3,458.709 ms | 750 | 60 / 60 FPS | 124.8 MiB |
| Bikeshare | 2,069.498 ms | 633 | 60 / 60 FPS | 157.4 MiB |
| Datacenters | 817.693 ms | 4,362 | 59.6 / 60 FPS | 328.2 MiB |
| Flights | 667.671 ms | 247 | 60 / 60 FPS | 118.4 MiB |
| Submarine cables | 614.727 ms | 2,629 | 60 / 60 FPS | 412.0 MiB |
| Military Flights | 557.113 ms | 68 | 60 / 60 FPS | 118.4 MiB |

CCTV had the largest cold activation cost in this capture. Submarine cables
used the most heap, followed by datacenters. Completed single-layer samples
generally reached 60 FPS, so activation time and heap separate these cases more
clearly than steady-state frame rate.

## Aircraft, detection, and Cockpit

| Scene | Motion / rest |
| --- | ---: |
| Idle globe | 60 / 60 FPS |
| Flights, 2D | 60 / 60 FPS |
| Flights, 3D proximity | 60 / 60 FPS |
| Flights, all 3D models | 60 / 60 FPS |
| Military Flights, all 3D models | 60 / 60 FPS |
| Detection at 25% | 39.3 / 41.1 FPS |
| Detection at 50% | 37.4 / 39.8 FPS |
| Detection at 100% | 34.4 / 35.5 FPS |
| Cockpit | 49.6 / 49.2 FPS |

The clean detection scenes processed 8,169 to 8,170 observations. Selected
labels rose from 14 at 25% density to 28 at 50% and 56 at 100%. The aircraft
rows came from an earlier loaded, foreground-controlled pass because the clean
rerun received no live aircraft rows.

## Visual styles and combined stress

| Scene | Motion / rest |
| --- | ---: |
| Normal | 60 / 60 FPS |
| CRT (report label: Retro) | 60 / 60 FPS |
| NVG (report label: Surveillance) | 60 / 60 FPS |
| FLIR (report label: Thermal) | 49 / 60 FPS |
| Anime | 60 / 59.8 FPS |
| Noir | 47 / 56.6 FPS |
| Snow | 42.3 / 45.8 FPS |
| Combined static | 57.6 / 60 FPS |
| Combined operational | 39.9 / 43.1 FPS |

The combined static scene rendered 11,575 objects, used 872.2 MiB of JavaScript
heap, and issued 48,665 text draws during motion and 54,106 at rest. The combined
operational sample contained 3,909 observations and two selected labels, but its
live aircraft and traffic rows were empty, so it remains a limited stress case.

Snow, Noir, dense detection, and text-heavy combined layers are the clearest
controlled comparison points for later optimization work.

## Keyed live sources

NASA FIRMS, AISStream, and TomTom were captured in a separate hardware-rendered
pass. The page was visible but was not the focused window, so these frame rates
must not be compared directly with the foreground-controlled scenes above.

| Source | Point-in-time population | Activation or coverage | Motion / rest |
| --- | ---: | --- | ---: |
| NASA FIRMS | 100,430 detections in 3,557 cells | 30.0 s activation | 32.1 / 55.2 FPS |
| AISStream | 12,000 vessels | 6.4 s activation | 22.1 / 29.8 FPS |
| TomTom Traffic | 4,222 road dots | 70% coverage, 2 decoded tiles | 45.0 / 51.7 FPS |

These populations change continuously. A future comparison must record the
live counts again and match the focus conditions.

## Controls for a future capture

Use the same controls before attributing a difference to the application:

1. Record the exact GPU renderer and reject software-rendered or unavailable GPU
   strings.
2. Use a 1440 x 900 viewport at device pixel ratio 1 and keep the page focused.
3. Measure cache-disabled startup separately from cold layer activation and warm
   option switching.
4. Repeat startup three times and compare medians.
5. Sample each option for 5 seconds in scripted motion and 5 seconds at rest.
6. Record live object counts before attributing a difference to the client.
7. Treat a live-source outage as missing coverage, not as evidence of low client
   rendering cost.

## What is not established yet

- This report does not establish Windows performance. A separate single-machine
  Windows capture is recorded in [Hybrid-GPU laptops (Windows)](#hybrid-gpu-laptops-windows)
  below; it covers adapter selection and render settings, not the layer and
  option scenes above.
- The report does not record machine memory capacity, so it cannot support a
  minimum-memory recommendation.
- The report does not cover other GPU renderers or viewport configurations.
- Military Installations is outside this comparison because it requires close
  camera context.
- The keyed pass has no controlled rerun suitable for comparison with the
  option scenes.

Use this page as a regression baseline for one known hardware and browser
configuration, not as a compatibility guarantee.

---

# Hybrid-GPU laptops (Windows)

This section records a second, independent capture on Windows. It exists
because the dominant performance factor it found is not a rendering setting at
all — it is which physical GPU the browser chose.

## Test context

| Setting | Value |
| --- | --- |
| Machine | Intel Core i5-11400H, 15.7 GiB RAM |
| GPUs | Intel UHD Graphics (integrated) + NVIDIA GeForce RTX 2050 (discrete) |
| OS | Windows 11 Home Single Language 10.0.26200 |
| Renderer path | ANGLE / Direct3D11 |
| Viewport | 1920 x 945 at device pixel ratio 1 |
| Scene | Keyless Esri basemap over Austin, no layers enabled, camera parked |
| Method | `scene.postRender` inter-frame deltas, 6 s, continuous render forced |

Continuous render is forced for the measurement because the idle governor
(`src/renderGovernor.js`) otherwise stops the loop, and the gap between
requested frames is not frame cost.

## The GPU choice dominates every render setting

Identical build, identical scene, identical MSAA and resolution — only the
adapter differs:

| Adapter | FPS | Median frame | p95 frame |
| --- | ---: | ---: | ---: |
| Intel UHD Graphics | 7.0 | 114.4 ms | 309.2 ms |
| NVIDIA RTX 2050 | 78.0–80.0 | 7.1–11.3 ms | 16.6–23.5 ms |

That is an 11x difference, and it is the difference between an unusable
application and a smooth one. Chrome on Windows binds its GPU process to one
adapter at browser launch and was measured here NOT to honor the WebGL
`powerPreference: 'high-performance'` hint that `src/main.js` requests. The
reliable fix is an OS-level per-application assignment:

- **Windows:** Settings → System → Display → Graphics → add the browser →
  Options → High performance. Restart the browser fully.
- **macOS:** disable Automatic Graphics Switching in Battery settings.

The setting is stored per executable, so assigning one browser does not affect
another installed browser.

## Render settings on a weak adapter

Measured on the Intel UHD adapter, so these are the returns available to a user
who genuinely has no discrete GPU:

| MSAA | resolutionScale | FPS | Median frame |
| ---: | ---: | ---: | ---: |
| 4 (as shipped) | 1.0 | 7.0 | 114.4 ms |
| 1 | 1.0 | 10.5 | 87.4 ms |
| 1 | 0.7 | 14.7 | 67.5 ms |
| 1 | 0.5 | 16.2 | 59.4 ms |

Roughly 2x is available, and it does not close the 11x adapter gap. Both facts
are why `src/gpuQuality.js` degrades quality for integrated and software
renderers *and* logs the OS-level advice above.

## Automatic quality tiering

`src/gpuQuality.js` classifies the WebGL `UNMASKED_RENDERER_WEBGL` string at
startup and applies:

| Tier | msaaSamples | resolutionScale |
| --- | ---: | ---: |
| discrete / unknown | unchanged | unchanged |
| integrated | 1 | 0.7 |
| software | 1 | 0.5 |

An unreadable renderer string is treated as `unknown` and costs a capable
machine nothing. Override with `?gpu=discrete` (or any tier name) on the URL,
or persist a choice in `localStorage` under `godsEyeView.gpuQuality.v1`.

End-to-end verification on the machine above, both browsers on the same dev
server, no console errors in either:

| Browser | Detected adapter | Tier | Applied | FPS |
| --- | --- | --- | --- | ---: |
| Chrome assigned to the RTX 2050 | NVIDIA RTX 2050 | discrete | nothing | 64.5 |
| Chrome left on the default adapter | Intel UHD | integrated | MSAA 1x, scale 0.7 | 17.2 |

The integrated row is 2.5x its 7.0 FPS as-shipped baseline.

## Limits of this capture

- One machine, one browser engine, one viewport. It does not establish Windows
  performance generally.
- Frame rates were sampled with no data layers enabled; layer activation costs
  are not re-measured here and remain covered by the M5 baseline above.
- The two RTX 2050 samples (78.0 and 64.5 FPS) were taken at different times
  under different background load and are not a controlled comparison with each
  other. Both are far above the display's 60 Hz target.
- `powerPreference` behavior is browser- and version-specific; a future Chrome
  may honor it and make the manual assignment unnecessary.
