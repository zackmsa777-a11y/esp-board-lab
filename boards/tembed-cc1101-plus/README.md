# LilyGO T-Embed CC1101 Plus

ESP32-S3, 16 MB flash and 8 MB PSRAM. `board.json` is an esp-emu cosimulation board; `profile.json` supplies app metadata. Run `node scripts/build-parts.mjs` from the repository root to publish the modules and profiles into the app public directory.

The ST7789 models the native 170 by 320 panel (column offset 35). The app rotates its RGBA framebuffer 90 degrees clockwise. SPI: SCK 11, MOSI 9, LCD CS 41, D/C 16, active-high backlight 21. Encoder: CLK 4, DT 5, switch 0. User key: active-low GPIO 6. Charger and gauge share SDA 8 / SCL 18 at addresses 0x6B and 0x55.

Wheel inputs are `cw`, `ccw`, `press`, `release`; the key accepts `press`, `release`. Both battery parts accept `set:percent=78`, `set:voltage-mv=3950`, `set:charging=1`, `set:usb=1`. Send battery updates to both parts to keep them consistent. These are also the defaults.

The board models the display, input controls, charger and gauge. RF, NFC, SD, audio, LEDs and IR are not modeled by this profile.
