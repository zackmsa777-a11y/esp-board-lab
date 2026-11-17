# Factory peripheral smoke tests

Run from `app/` after `node ../scripts/build-parts.mjs`:

```powershell
npm run smoke
$env:SCENARIO='radio'; npm run smoke
$env:SCENARIO='nfc'; npm run smoke
$env:SCENARIO='ir'; npm run smoke
$env:SCENARIO='leds'; npm run smoke
Remove-Item Env:SCENARIO
```

The default smoke retains its 20-second display/battery/control checks. Scenarios use `vendor-dl/fw/tembed_factory.bin` by default. They target the factory v1.1.0 image's 12-item menu, not the different LVGL menu on upstream master. Each waits for startup display frame 3, presses the encoder to enter the main menu at Battery (index 0), waits for frame 4, then releases for 500 ms simulated time. A full virtual `cw` detent produces four GPIO transitions and advances this firmware's half-step decoder by two entries. Startup consumes the encoder press event; using a turn here can leave a half-detent after the menu transition.

- `radio`: USER key once to item 2 CC1101 Radio, then encoder press. Load an original synthetic RAW `.sub` with sync 01 23 and CRC16, attempt `send W12-RADIO` through UART, then use the encoder mode button to enter TX-BURST if USB CDC is not connected to UART0. Export the real TX capture, hold the mode button until SNIFF-OOK, release, hold again until packet RX, replay the capture, and require a new CRC-valid reception plus a display redraw. Holding until the state changes accommodates RadioLib's blocking transmission loop.
- `nfc`: two `cw` detents to item 5 PN532 NFC, then encoder press. Require SAMConfiguration, load an original NTAG213 dump, remove/place it, require InListPassiveTarget and a display change, then export and verify the UID.
- `ir`: one `cw` detent to item 3 IR TX/RX, then encoder press. Require a real TX capture (toggle mode if necessary), export `.ir`, switch to RX and inject an original NEC signal; require completed playback and a firmware display change.
- `leds`: five `cw` detents to item 11 WS2812 LEDs, then encoder press. Require a decoded nonblack frame and eight RGBA LEDs via the WASM extra exports.

Button holds last 300 ms **emulated time**, followed by 500 ms release time, using the encoder part's latest event timestamp. This lets the firmware debounce releases even under CPU load. Radio mode transitions hold until acknowledged, with 500 ms simulated release before and after.

`SMOKE_MS` controls the startup timeout for scenarios (default 90 seconds). Each later operation has its own bounded timeout. Artifacts include menu/selection/result screenshots, original samples, captures/dumps and a JSON result under `D:/swarm-tmp/w12-smoke-<scenario>`. Set `SMOKE_ARTIFACTS` to override. `SMOKE_PNG` still controls the smoke's final framebuffer image. Failed assertions are failures; fixtures are never a substitute for firmware-driven peripheral events.
