# Virtual board parts

This standalone Cargo workspace builds Rust devices against the vendored Apache-2.0 `esp-part` SDK. Each crate exports the part ABI as a `cdylib` and an `rlib` for host tests.

- `st7789`: SPI display controller and native RGBA panel framebuffer.
- `ky040`: Espressif's Apache-2.0 quadrature encoder example; `cw`, `ccw`, `press`, `release` inputs.
- `pushbutton`: Espressif's Apache-2.0 active-low button example; `press`, `release` inputs.
- `bq25896`: TI charger register file at I2C 0x6B, status and quantized voltage/current ADCs. Register 0x14 identifies PN 000 / revision 2, as checked by XPowersLib. Control writes persist; conversion-start and watchdog-reset bits self-clear. Status and ADC registers reflect the supplied environment. ADC conversions complete immediately.
- `bq27220`: TI fuel gauge at I2C 0x55, little-endian standard commands, MAC identity responses, sealing/unsealing, config-update status and an in-memory data-memory window. Temperature is 25 C, nominal capacity 1500 mAh, health 100%, cycle count 12. Charge current is 500 mA; discharge is -150 mA. InternalTemperature is 0x28 and CycleCount is 0x2A, matching LilyGO's driver. Timing, chemistry, calibration and authentication are not simulated.

Both battery parts default to 78%, 3950 mV, USB connected and charging. Inputs: `set:percent=<0-100>`, `set:voltage-mv=<n>`, `set:charging=<0|1>`, `set:usb=<0|1>`. State keys: `percent`, `voltage_mv`, `charging`, `usb`. I2C claims use both configured `SCL` and `SDA` pins, and optional `addr` overrides the default. Register reads auto-increment, including split transactions.

## Build and check

```sh
rustup target add wasm32-unknown-unknown
cargo test --manifest-path parts/Cargo.toml
cargo clippy --manifest-path parts/Cargo.toml --all-targets -- -D warnings
node scripts/build-parts.mjs
```

The script builds release WASM modules, copies them to `app/public/parts`, publishes `boards/*` under `app/public/boards`, and writes a board index. `CARGO_TARGET_DIR` is honored; otherwise build output goes to `parts/target`. Release uses size optimization, LTO and stripping.

## Add a part

Create `parts/<name>/Cargo.toml` with crate types `["cdylib", "rlib"]` and `esp-part = { path = "../../vendor/esp-part-sdk/esp-part" }`. Implement `Device`, declare claims using configured pins, and call `esp_part::export_part!`. Add host tests for actual bus behavior. Add the crate to the workspace members and a module entry in the relevant board file, then run the commands above. Keep release settings in the workspace.

## Driver references

Register behavior was checked against [XPowersLib PowersBQ25896](https://github.com/lewisxhe/XPowersLib/blob/master/src/PowersBQ25896.hpp) (MIT) and [LilyGO factory BQ27220 driver](https://github.com/Xinyuan-LilyGO/T-Embed-CC1101/blob/master/examples/factory_test/peripheral/bq27220.cpp). The battery models are original MIT OR Apache-2.0 code, not copies of the drivers.
