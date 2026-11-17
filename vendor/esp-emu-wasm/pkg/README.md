<p align="center">
  <img src="docs/logo/logo.svg" alt="ESP-EMU — ESP32 emulator" width="560">
</p>

<h1 align="center">esp-emulator</h1>

A Rust-based emulator for ESP32-C3, ESP32-C5, ESP32-C6, ESP32-H2, ESP32-P4 (RISC-V) and ESP32-S3 (Xtensa LX7) firmware. Runs ESP-IDF applications without hardware by emulating the CPU, memory, and key peripherals including WiFi, Ethernet, crypto accelerators, and timers. Also compiles to WebAssembly for browser-based emulation.

## Features

- **CPU**: RV32IMC on C3; full RV32IMAC on C5/C6/H2; RV32IMAFC (with single-precision FP via Berkeley SoftFloat) on P4; Xtensa LX7 (dual-core, windowed registers, zero-overhead loops, MAC16, FPU) on S3. Multi-hart scheduler supports P4's dual HP cores. RV32 PMP and Espressif PMA enforced via a fused two-level page table — catches the same access violations as silicon (IDF panic memprot tests, TEE REE-vs-TEE isolation, IRAM/IROM write protection). P4 and S31 run the whole PIE SIMD instruction set that ESP-SR, esp-dl and esp-nn use, checked bit for bit against silicon.
- **Access permission control**: the APM and TEE permission controllers (C5, C6, H2, S31), P4's PMS and the `SENSITIVE` PMS monitors on C3 and S3 are enforced for the CPU and DMA, so ESP-TEE, IDF's memprot app and other isolation firmware see the same faults and violation reports as silicon
- **WiFi**: Soft AP with WPA2-PSK, WPA3-SAE (PMF, H2E, transition mode) and WPA2/WPA3-Enterprise (802.1X relayed to a RADIUS server), 802.11 management frames, DHCP server, and TAP networking for real connectivity
- **Ethernet**: OpenCores Ethernet MAC (OpenETH) for QEMU-compatible `CONFIG_ETH_USE_OPENETH` firmware, plus Synopsys DesignWare GMAC for ESP32-P4's built-in EMAC
- **Networking backends**: user-mode (zero-setup, QEMU-style NAT via smoltcp — DHCP, DNS forwarder, mDNS relay with optional record-rewriting NAT for Matter/HomeKit-style service discovery, IPv6 SLAAC, `hostfwd`, restrict mode, ICMP echo), TAP bridge (Linux), vmnet (macOS)
- **BLE**: NimBLE host stack on every BLE chip, plus Bluedroid on ESP32-S31, with HCI forwarding to Bumble (virtual controller) or physical Linux HCI adapters
- **LP core and sleep (ESP32-C6)**: IDF `ulp_lp_core` firmware runs on the emulated low-power RISC-V core next to the HP core — started through the PMU or its LP timer, HP↔LP software interrupts, shared LP RAM, `lp_core_printf` over the LP UART on the console. The HP core's deep sleep and light sleep work with the RTC timer and the LP core as wake sources, and the LP core runs on while the HP core sleeps. LP IO/I2C and GPIO/UART wake-ups are not modelled yet
- **Thread / 802.15.4**: OpenThread `ot_cli` and `ot_br` on ESP32-C6 and ESP32-H2. Single-node forms a partition out of the box; two emulator instances form one Thread mesh (Leader + Child, or Border Router + end device) over a localhost UDP bridge
- **Crypto**: AES (ECB/CBC/OFB/CTR/CFB), SHA (1/224/256), RSA, ECC, HMAC-SHA256, Digital Signature, XTS-AES flash encryption, ECDSA (P-256/P-384 on P4 and C5; P-256 on H2), Key Manager + HUK Generator (P4, C5) — drives flash / HMAC / DS / ECDSA key sourcing for `CONFIG_SECURE_FLASH_ENCRYPTION_KEY_SOURCE_KEY_MGR`
- **Peripherals**: UART, USB Serial JTAG, USB-OTG on S3 (FS), P4 (HS + FS) and S31 (HS) (DWC2 device mode, enumerated by a built-in virtual host; a TinyUSB CDC-ACM port works as the console), SDMMC host on P4, S3 and S31 (an SD card over a host image with `--sd`, mounted by the stock `esp_vfs_fat_sdmmc_mount`, or on an SPI bus of any chip for `esp_vfs_fat_sdspi_mount`; the ESP-Hosted SDIO link on P4; with no card a command times out, as in an empty slot), GPIO, system timer, timer groups, interrupt controllers (PLIC for C3/C6/H2, CLIC for C5/P4), eFuse, SPI flash, GDMA, GP-SPI, RMT, LEDC, PCNT, MCPWM, I2C (with a built-in EEPROM slave), I2S (standard, TDM and PDM streams paced at the programmed sample rate, with TX-to-RX loopback), ADC (C3/C5/C6/H2; one-shot on S31; reads a pad's pull or a voltage a part holds), the DVP camera receiver of LCD_CAM on S3/P4/S31 (frames from a co-simulated sensor, through the stock `esp_driver_cam`), the MIPI DSI host on P4 with the DW-GDMA and 2D-DMA its panel driver uses (`esp_lcd` brings up a DPI panel and refreshes it; a panel over `--cosim-tcp` is sent the commands and the frames, `tools/cosim-tcp-dsi-view.py` draws them), the JPEG codec and the PPA on P4 and S31, with the 2D-DMA they run through (the stock `esp_driver_jpeg` encodes RGB, YUV and grey pictures and decodes to RGB; `esp_driver_ppa` scales, rotates, blends and fills), and the TIMG/RTC watchdogs
- **esptool / espefuse over `socket://`**: a `--uart-tcp HOST:PORT` bridge plus `--strap-mode 0x02` (UART download) lets esptool, espefuse, and `idf.py flash` drive the running emulator over TCP, matching the QEMU-Espressif workflow. See [esptool / espefuse](docs/guides/FLASHING.md).
- **Chips**: ESP32-C3, ESP32-C5, ESP32-C6, ESP32-H2, ESP32-P4, and ESP32-S3 (dual-core Xtensa; boots the real mask ROM through the IDF bootloader to app_main; 2.4 GHz WiFi station and BLE both work against the built-in controllers; external PSRAM works in both quad and octal mode, `CONFIG_SPIRAM=y`) with per-chip memory maps and interrupt controllers. C5 is a hybrid: a C6-shaped peripheral map driven by a P4-style CLIC on a single core (2.4 GHz WiFi and BLE both work; 5 GHz and 802.15.4 are not modelled)
- **Debugging**: `--gdb PORT` serves a GDB remote stub (QEMU `-s -S` equivalent) for `riscv32-esp-elf-gdb` / `xtensa-esp32s3-elf-gdb`; `--trace FILE` records a per-task timeline for Perfetto with no guest instrumentation. See [Execution Tracing and Profiling](docs/guides/HOST-INTERFACES.md#execution-tracing-and-profiling).
- **WASM**: Browser-based emulation via WebAssembly with JavaScript API
- **Virtual parts**: add virtual components to the emulated chip, such as a push button on a GPIO, an SHT31 sensor on I2C, a TMP123 sensor on SPI, an MH-Z19B CO₂ sensor on a UART, an SG90 servo on a PWM pin or a potentiometer on an ADC pad. They run in the browser build or inside the emulator itself, and the firmware drives them with its stock drivers. [docs/guides/PARTS.md](docs/guides/PARTS.md) runs the examples and walks through writing your own; [`examples/parts/pushbutton`](examples/parts/pushbutton) is a complete part to copy, [`examples/parts/sht31`](examples/parts/sht31) an I2C one, [`examples/parts/tmp123`](examples/parts/tmp123) an SPI one, [`examples/parts/mhz19b`](examples/parts/mhz19b) a serial one, [`examples/parts/ky040`](examples/parts/ky040) a rotary encoder the chip's pulse counter counts, [`examples/parts/sg90`](examples/parts/sg90) one read as PWM and [`examples/parts/potentiometer`](examples/parts/potentiometer) an analog one
- **ROM stubs**: Intercepts key ROM functions (printf, UART, delay, WiFi TX) instead of emulating full ROM

## Quick Start

### Prerequisites

- A merged flash binary built with ESP-IDF (see [Building Firmware](#building-firmware-images))

Default ROM ELFs (C3 rev3, C5 rev100, C6 rev0, H2 rev0, P4 rev3, S3 rev0) are embedded in the binary, so `--rom` is optional for the common case. Pass `--rom <path>` only to override with a different silicon revision or a custom ROM (e.g. from `~/.espressif/tools/esp-rom-elfs/`).

### Running

```sh
./esp-emu \
  --chip esp32c3 \
  --firmware build/merged_flash.bin
```

### Building firmware images

The emulator runs merged flash binaries built with ESP-IDF. Requires ESP-IDF environment (`source export.sh`).

```sh
cd your-esp-idf-project
idf.py set-target esp32c3    # or esp32c5, esp32c6, esp32h2, esp32p4, esp32s3, esp32s31
idf.py build
idf.py merge-bin -o merged_flash.bin
```

`merge-bin` resolves a relative `-o` path inside the build directory, so the image lands at `build/merged_flash.bin`.

### Common options

| Flag | Default | Description |
|------|---------|-------------|
| `--chip <CHIP>` | (required) | Target chip: `esp32c3`, `esp32c5`, `esp32c6`, `esp32h2`, `esp32p4`, `esp32s3`, or `esp32s31` |
| `--firmware <PATH>` | (required) | Merged flash image: raw, or Intel HEX from `esptool merge-bin --format hex` |
| `--elf <PATH>...` | — | Application ELF(s): symbolised backtraces, panic intercepts, BLE / Thread interception |
| `--timeout <DURATION>` | — | Exit after duration (e.g. `5s`, `500ms`) |
| `--exit-on <STRING>` | — | Exit with code 0 when UART output contains this string |
| `--inject <DATA>` | — | Payload to inject into UART RX (supports `\n` escape). Repeatable. |
| `--inject-on <STRING>` | — | Trigger string in UART output that causes injection (paired with `--inject`). Repeatable. |
| `--net <BACKEND>` | `tap0` if present on Linux, else `user` | Network backend: `user` (no setup, any OS), `user,hostfwd=tcp::H-:G`, `tap,ifname=tap0` (Linux), `vmnet` (macOS) |
| `--wifi-ssid <SSID>` | `myssid` | WiFi soft AP SSID broadcast to firmware |
| `--wifi-password <PASS>` | `mypassword` | Passphrase for WPA2-PSK and WPA3-SAE. Empty string for open mode |
| `--ble-hci <BACKEND>` | — | BLE HCI backend: `tcp:host:port` for Bumble, `hci0` for a Linux adapter |
| `--uart-tcp <HOST:PORT>` | — | Bridge UART0 to a TCP server so esptool connects via `socket://` |
| `--gdb <PORT>` | — | Serve a GDB remote stub on this port (QEMU's `-s`); `--gdb-halt` waits for the client |
| `--trace <FILE>` | — | Per-task Chrome Trace Event trace for Perfetto; requires `--elf` |

Every flag, with the settings behind flash size, PSRAM size, I2C devices and chip revision, is in [`docs/guides/CLI.md`](docs/guides/CLI.md).

## Building from Source

```sh
cargo build --release          # Optimized build -> target/release/esp-emu
cargo build                    # Debug build -> target/debug/esp-emu
cargo test                     # Run all tests
```

### WASM build

```sh
cargo install wasm-pack
wasm-pack build --target web --out-dir www/pkg --no-typescript -- --features wasm --no-default-features
```

The browser build reaches the internet through `esp-emu-relay`, a small
WebSocket relay for TCP and UDP that runs on Linux, macOS and Windows. It can
also forward ports on your computer to a server in the firmware. The page's
**Network** panel links to the release archive for your OS. Or install it with
one command, on Linux and macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/espressif/esp-emulator/main/install.sh | sh -s -- --relay
```

and on Windows, from PowerShell:

```powershell
irm https://raw.githubusercontent.com/espressif/esp-emulator/main/install-relay.ps1 | iex
```

From a checkout:

```sh
cargo build --release --manifest-path esp-emu-relay/Cargo.toml
./esp-emu-relay/target/release/esp-emu-relay
```

Then click **Connect** in the **Network** panel (`ws://127.0.0.1:8787`).

See [docs/guides/BROWSER.md](docs/guides/BROWSER.md) for the full browser emulation guide.

### Virtual parts in the browser

The WASM build includes the co-simulation boundary, so a page can run firmware
next to virtual parts. [docs/guides/PARTS.md](docs/guides/PARTS.md) is the user
guide; `www/button-demo.html` is the demo.

To run the demo from a checkout, put two files in `www/` (neither is checked
in): `_button_fw.bin`, the merged image of `test_apps/gpio_button` built for
esp32c3, and `pushbutton.wasm`, built from `examples/parts/pushbutton` (its
README says how). Without them the page asks for the files instead. The
release's wasm tarball and Pages carry both, so there the demo starts at once.
`node tests/browser/button.mjs` runs the demo headless in Chromium and checks
that the firmware's interrupt sees each press (`cd tests/browser && npm i &&
npx playwright install chromium` once first). `www/sensor-demo.html` runs the
I2C sensor the same way, from `_sensor_fw.bin` (`test_apps/i2c_sensor` for
esp32c3) and `sht31.wasm` (`examples/parts/sht31`), and
`node tests/browser/sensor.mjs` checks that its firmware reads the part.
`www/co2-demo.html` runs the serial CO₂ sensor from `_co2_fw.bin`
(`test_apps/uart_mhz19b` for esp32c3) and `mhz19b.wasm`
(`examples/parts/mhz19b`), and `node tests/browser/uart.mjs` checks it.
`www/encoder-demo.html` turns a KY-040 rotary encoder counted by the chip's
pulse counter, from `_encoder_fw.bin` (`test_apps/pcnt_encoder` for esp32c6)
and `ky040.wasm` (`examples/parts/ky040`), and `node tests/browser/encoder.mjs`
checks the count follows each turn.
`www/servo-demo.html` runs the servo from `_servo_fw.bin` (`test_apps/pwm_servo`
for esp32c3) and `sg90.wasm` (`examples/parts/sg90`), and
`node tests/browser/pwm.mjs` checks it.
`www/adc-demo.html` runs the potentiometer from `_adc_fw.bin`
(`test_apps/adc_oneshot` for esp32c3) and `potentiometer.wasm`
(`examples/parts/potentiometer`), and `node tests/browser/adc.mjs` checks it.

### Virtual parts in the command-line emulator

The release binaries run the same `.wasm` parts inside the emulator; a source
build needs `--features cosim-parts`.
[docs/guides/PARTS.md](docs/guides/PARTS.md#run-parts-in-the-command-line-emulator)
is the user guide and shows the board file.

The example below runs from the checkout's root, with the `board.json` of
`examples/boards/button` and the two files the browser demo above uses:
`_button_fw.bin`, the merged image of `test_apps/gpio_button` built for
esp32c3, and `pushbutton.wasm`, built from `examples/parts/pushbutton`.

```sh
cargo build --release --features cosim-parts
./target/release/esp-emu --chip esp32c3 --firmware _button_fw.bin \
    --cosim-board board.json --control-tcp 127.0.0.1:5556

printf 'part list\npart button input press\n' | nc -N 127.0.0.1 5556
```

`nc` prints the answers, `ok button` and `ok`, and exits; on macOS leave out
`-N`, as under [Host Control Channel](docs/guides/HOST-INTERFACES.md#host-control-channel).
The firmware prints `BUTTON: pressed`.

### Release packaging

```sh
scripts/build.sh                                       # Auto-detects host target
scripts/build.sh --target aarch64-apple-darwin          # macOS Apple Silicon
scripts/build.sh --target x86_64-unknown-linux-gnu      # Linux x86_64
scripts/build.sh --target wasm                          # WebAssembly
scripts/build.sh --target examples                      # Button, sensor and thermometer kits; needs ESP-IDF (. $IDF_PATH/export.sh)
```

`EXAMPLES_DIR=<unpacked examples kit> scripts/build.sh --target wasm` puts the
button demo's firmware and part in the wasm tarball's `www/`, as the release
pipeline does.

## Documentation

### User guides

The guides in [`docs/guides/`](docs/guides/) are synced verbatim into the public
[espressif/esp-emulator](https://github.com/espressif/esp-emulator) repo on every
release, so they are edited here and never there:

- [`CLI.md`](docs/guides/CLI.md) — every flag; flash size, PSRAM size, I2C devices, chip revision via eFuse
- [`NETWORKING.md`](docs/guides/NETWORKING.md) — WiFi soft AP (WPA2 / WPA3 / Enterprise), OpenETH and P4 Ethernet, user-mode NAT, TAP and vmnet
- [`HOST-INTERFACES.md`](docs/guides/HOST-INTERFACES.md) — UART injection, UART1 TCP bridge, host control channel, execution tracing
- [`FLASHING.md`](docs/guides/FLASHING.md) — esptool / espefuse / `idf.py flash` over `socket://`
- [`BLE.md`](docs/guides/BLE.md) — NimBLE and Bluedroid against Bumble or a Linux HCI adapter
- [`THREAD.md`](docs/guides/THREAD.md) — OpenThread `ot_cli` / `ot_br` on C6 and H2, two-node meshes over `--thread-sim`
- [`MATTER.md`](docs/guides/MATTER.md) — Matter commissioning and control with chip-tool
- [`HOSTED.md`](docs/guides/HOSTED.md) — ESP-Hosted P4 ↔ C5/C6 SDIO setup
- [`RAINMAKER.md`](docs/guides/RAINMAKER.md) — RainMaker provisioning flow
- [`BROWSER.md`](docs/guides/BROWSER.md) — running the WASM build in a browser (hosted at <https://espressif.github.io/esp-emulator/>)
- [`PARTS.md`](docs/guides/PARTS.md) — virtual parts: run firmware next to virtual components in the browser or the command-line emulator, where parts come from, writing one

### Internal design (this repo only)

- [docs/internal/ARCHITECTURE.md](docs/internal/ARCHITECTURE.md) — Emulator internals: execution model, memory subsystem, CPU, ROM stubs (incl. download-mode-only stubs and ROM data-unpack synthesis), UART download mode, interrupt architecture, crypto accelerators, firmware loading, WASM interface
- [docs/internal/NETWORKING.md](docs/internal/NETWORKING.md) — WiFi emulation: soft AP state machine, WPA2-PSK handshake, CCMP frame format, TX/RX DMA paths, TAP networking, PHY calibration stubs
- [docs/internal/BLE.md](docs/internal/BLE.md) — BLE emulation: HCI interception, C3/C6/S31 chip differences, IROM breakpoints, trampoline delivery, ACL fragmentation, Bumble/HCI transport, provisioning
- [docs/internal/ESPTOOL.md](docs/internal/ESPTOOL.md) — esptool / espefuse over `socket://`: UART vs USB-Serial/JTAG (joint) download, per-chip strap remap, Secure Download Mode eFuse setup, command support matrix, MR !966 reproduction
- [docs/internal/TROUBLESHOOTING.md](docs/internal/TROUBLESHOOTING.md) — Debugging: boot failures, WiFi/BLE/interrupt issues, register stubs, known bugs, AI-optimized lookup tables
