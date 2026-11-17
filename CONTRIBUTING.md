# Contributing

Start with a focused issue or pull request describing the board behavior or user problem you want to address. Include a small reproduction and UART output for emulator bugs, and identify the firmware version and board revision. Do not attach firmware or models unless you have permission to redistribute them.

## Development

Use Rust stable with rustfmt and clippy. The root Cargo workspace contains `crates/firmware` and `crates/cli`; the Tauri app in `app/` is separate. Install Node.js LTS and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) for desktop development.

Run these checks from the root:

```powershell
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
```

For the frontend, run `npm ci` and `npm run build` in `app/`. Use `npm run tauri dev` there to launch the desktop app. Keep downloaded firmware and models in the ignored `vendor-dl/` directory. Do not add generated installers, build directories, or dependency caches to a pull request.

## Adding boards and parts

The design goal is **add a board = one TOML + one glb**: a declarative TOML board definition supplies the chip, pins, bus wiring, and virtual-part configuration; a GLB supplies the physical view and interaction anchors. This is a vision for the board interface, not a claim that automatic board loading is complete today. Share reusable peripheral behavior in virtual parts instead of embedding board-specific behavior in the CPU core. Only contribute models with explicit redistribution rights; otherwise provide an upstream runtime fetch reference.

Test parsers with small synthetic inputs, including malformed and truncated images. Test parts through observable bus transactions and firmware behavior. Describe the checks you ran in your pull request and distinguish implemented behavior from planned support.

## Licensing and provenance

Original contributions are offered under **MIT OR Apache-2.0**, matching the repository's licenses. By contributing, you agree to license your original contributions on those terms.

**Do not copy, translate, link, or vendor GPL or AGPL code into this project.** This includes code from firmware projects with those licenses. Implement compatibility independently from publicly documented formats and hardware interfaces; file-format compatibility does not require copying firmware code. Record sources and applicable licenses in `ATTRIBUTION.md` when adding third-party material.

LilyGO's T-Embed-CC1101 repository has no license file. Its firmware and 3D model are not redistributed here; users fetch them from upstream at runtime or supply them locally. A public download URL alone is not a redistribution license. Preserve the Apache-2.0 license and upstream notices for the vendored esp-emulator WASM build, and record its version and verified provenance when updating it.
