# Attribution

Original esp-board-lab code is licensed under MIT OR Apache-2.0. Third-party materials retain their own terms.

| Component | Source URL | License | What we use |
| --- | --- | --- | --- |
| Espressif esp-emulator WASM build, v1.1.0 | https://github.com/espressif/esp-emulator/releases/tag/v1.1.0 | Apache-2.0 (upstream binary distribution) | Vendored WASM core, JavaScript bindings, and reference assets in `vendor/esp-emu-wasm`; version provenance is in its `VERSION` file. Core source is not included. |
| LilyGO T-Embed-CC1101 | https://github.com/Xinyuan-LilyGO/T-Embed-CC1101 | No repository license file; no redistribution permission assumed | Board reference information. Its 3D model and factory firmware are **not redistributed**. Users fetch these from upstream at runtime or supply their own local files; the local `vendor-dl/` directory is ignored by Git. |
| Flipper file formats | https://developer.flipper.net/flipperzero/doxygen/file_formats.html | Format reference only; no code or documentation redistribution | Public descriptions of `.sub`, `.ir`, and related formats for planned independent compatibility implementations. No Flipper firmware code is copied or linked. |
| Tauri | https://github.com/tauri-apps/tauri | MIT OR Apache-2.0 | Desktop shell and application bundling. |
| React | https://github.com/facebook/react | MIT | Desktop web frontend. |
| clap | https://github.com/clap-rs/clap | MIT OR Apache-2.0 | Command-line argument parsing. |
| Serde / serde_json | https://github.com/serde-rs/serde / https://github.com/serde-rs/json | MIT OR Apache-2.0 | Firmware metadata serialization and JSON output. |

This is a component overview, not an exhaustive transitive dependency inventory. Preserve upstream notices when updating vendored files and review each new dependency or asset before redistribution. Downloading an upstream asset does not relicense it under this project's license.
