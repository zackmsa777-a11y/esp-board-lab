# esp-board-lab

An open-source ESP32 board emulator for Windows, packaged as a desktop `.exe`. The first target is the **LilyGO T-Embed CC1101 Plus**. Load a firmware image, inspect its layout, and run it against a virtual board powered by Espressif's esp-emulator WebAssembly core.

## Status

**Phase 0:** T-Embed factory firmware boots to I2C initialization on the WASM core. This establishes CPU execution and UART output; a complete interactive board and working peripherals are still under development. Reaching I2C initialization does not mean the factory application is fully functional.

The project's original code is open source (MIT OR Apache-2.0). The vendored Espressif core is an Apache-2.0 binary distribution; its source is not included. LilyGO firmware and 3D assets are not bundled. Users fetch them from upstream at runtime or provide local files. See [attribution](ATTRIBUTION.md).

## Architecture

```mermaid
flowchart LR
    App["Tauri desktop app"] --> Worker["Web Worker"]
    Worker --> Core["esp-emu WASM"]
    Core <--> Parts["Virtual parts: display, buttons, buses, radios"]
```

The worker keeps CPU emulation off the UI thread. Rust's `ebl_firmware` crate inspects image headers, partitions, application metadata, and firmware fingerprints; the `ebl` CLI exposes the same inspector without starting the desktop app. Virtual parts and declarative board definitions will provide the hardware around the CPU.

## Quick start

Install Rust stable with rustfmt and clippy. Desktop development also requires Node.js LTS and the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/), including MSVC build tools and WebView2.

From the repository root, inspect a firmware file you obtained separately:

```powershell
cargo run -p ebl-cli -- inspect .\vendor-dl\fw\tembed_factory.bin
cargo run -p ebl-cli -- inspect .\vendor-dl\fw\tembed_factory.bin --json
```

Human output includes the chip, flash capacity, merged-image flag, partition table, application description, and fingerprint hints. JSON output is suitable for scripts. To install the CLI locally, run `cargo install --path crates/cli`, then use `ebl inspect <path>`.

Start the desktop app:

```powershell
cd app
npm ci
npm run tauri dev
```

`npm run dev` starts the frontend development server; `npm run build` checks and builds the frontend. `npm run tauri build` builds the native app and Windows installers. Git tags matching `v*` trigger a draft release with NSIS `.exe`, MSI, and the Windows CLI.

## Roadmap

1. **T-Embed boots:** image inspection, WASM worker, UART console, and factory firmware reaching I2C initialization (current Phase 0 milestone); extend board support to complete boot.
2. **3D view:** interactive board model, display surface, buttons, encoder, and mapped pins.
3. **Virtual parts:** CC1101 radio, PN532 NFC, IR, and the buses required by factory and community firmware.
4. **Auto-import:** recognize firmware and board profiles; offer user-initiated upstream firmware/model downloads and independently implemented file-format import.
5. **CI and headless:** reproducible boot checks, scripted virtual inputs, and broader board coverage.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, licensing rules, and the vision of adding a board with one TOML file and one GLB model. Third-party credits are in [ATTRIBUTION.md](ATTRIBUTION.md) and [NOTICE](NOTICE).
