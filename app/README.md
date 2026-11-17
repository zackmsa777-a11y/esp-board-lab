# ESP Board Lab desktop app

A Tauri 2 Windows workbench for running ESP32 firmware in the vendored Espressif WebAssembly emulator. The initial board preset is LilyGO T-Embed CC1101 Plus (ESP32-S3); Generic ESP32-S3 and ESP32-C3 are also available.

## Prerequisites

- Node.js 22.12+ and npm (Node 24 LTS recommended).
- Rust stable with the MSVC target, Visual Studio C++ Build Tools and the Windows SDK.
- Microsoft Edge WebView2 Runtime (the installer offers the runtime bootstrapper when missing).
- The repository's `vendor/esp-emu-wasm/pkg/esp_emu.js` and `esp_emu_bg.wasm` assets.

From PowerShell in `app/`:

```powershell
# D: cache locations are useful on machines with a small system drive.
$env:TEMP = 'D:\swarm-tmp'
$env:TMP = 'D:\swarm-tmp'
$env:CARGO_HOME = 'D:\cargo-home'
$env:NPM_CONFIG_CACHE = 'D:\npm-cache'
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
npm install
npm run dev            # Browser UI at http://127.0.0.1:1420
npm run tauri dev      # Native desktop window
```

Select the matching board, load a merged firmware `.bin`, then press **Run**. **Pause** yields the CPU; **Reset** recreates the chip from the retained firmware and leaves it paused. Changing the board reloads the retained image for that chip. Drop a `.bin` anywhere on the window to load it. Click the serial terminal to send keyboard input to UART 0.

The 320 × 170 display is a placeholder. Display, buttons and CC1101 radio are not wired yet. GPIO tiles show output-enable and output registers, rather than sampled input values. Some firmware will stop on unsupported peripherals or a CPU fault; the error pane includes the emulator fault report. MIPS is an estimate from requested instructions, and can overestimate execution during sleep or faults.

## Build and validate

```powershell
npm ci
npx tsc --noEmit
npm run build
npm run smoke
npm run tauri build
```

`npm run build` writes frontend assets to `dist/`. The Tauri build produces NSIS and MSI installers under `src-tauri/target/release/bundle/nsis/` and `src-tauri/target/release/bundle/msi/`. The first build downloads Rust dependencies and Windows bundler tools. An unsigned installer may trigger Windows SmartScreen.

The Tauri `bundle.useLocalToolsDir` setting keeps WiX/NSIS tool caches inside the project target directory, rather than the Windows user cache on C:.

`npm run smoke` runs the same pure emulator loop as the worker under Node for up to five seconds (or until a CPU fault), loads `../vendor-dl/fw/tembed_factory.bin`, and asserts UART output contains `psramInit`. A fault after that boot marker is reported but does not fail this boot smoke test. The factory firmware is a local test fixture, not distributed. To use a different path:

```powershell
npm run smoke -- D:\path\to\tembed_factory.bin
```

Vite copies the two vendored assets into the ignored `public/esp-emu/` directory at both dev and build startup. Do not commit these generated files. The worker imports this runtime URL; there is only one committed WASM binary, in `vendor/`.

## Source layout

- `src/emu/loop.ts`: platform-independent chip lifecycle, slices and snapshots.
- `src/emu/worker.ts`: WASM initialization, command queue, scheduling and ~150 ms status messages.
- `src/emu/protocol.ts`: typed UI/worker messages.
- `src/App.tsx`: board selection, firmware loading, GPIO and xterm terminal.
- `src-tauri/`: minimal native host and installer configuration. Native file drag handling is disabled so the browser's file drop API works in WebView2.

License: MIT OR Apache-2.0. The vendored emulator has its own attribution and license in the repository.
