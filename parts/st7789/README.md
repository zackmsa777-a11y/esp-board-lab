# ST7789V display part

An esp-part SDK device for a four-wire ST7789V SPI display. Default geometry is
the LilyGO T-Embed CC1101 Plus: 170x320 visible pixels within 240x320 GRAM,
column offset 35 and row offset 0.

Pins: `CS`, `SCK`, `MOSI`, `DC`, `BL`. CS is active low; the SPI claim includes
clock and MOSI so a CS driven as an ordinary GPIO routes correctly. D/C is read
from each SPI transfer's `pin_levels`, and active-high BL is watched via GPIO.
A panel without a BL connection has its backlight permanently enabled.

Supports reset, sleep, normal mode, display enable, inversion, CASET/RASET,
RAMWR/RAMWRC, all MADCTL bits, and RGB565/RGB666 serial pixels. Parameters and
pixels can span arbitrary transfers. ML/MH affect refresh order only; they
leave the stable image unchanged. Analog tuning commands accept and ignore
data until the next command. Reads provide a plausible ST7789V ID
(`85 85 52`) and status, with zero padding. Read bytes exclude dummy clocks
already represented by the SPI transfer's framing.

Framebuffer exports are `ebl_fb_ptr`, `ebl_fb_width`, `ebl_fb_height`, and
`ebl_fb_seq`. Pixels are packed RGBA8888 in panel-native orientation with alpha
255, inversion and BGR applied, and black when asleep, off, or backlight off.
The allocation stays fixed; pixel writes update only the affected pixel.
State changes repaint the panel once. The wrapping sequence changes whenever
visible pixels or display/sleep/inversion/backlight state changes. `frames`
counts RAMWR commands, not host refreshes or RAMWRC continuations.

Geometry inputs: `set:panel-width=<n>`, `set:panel-height=<n>`,
`set:col-offset=<n>`, `set:row-offset=<n>`. Values are clamped to GRAM bounds.
To use a 240-pixel-wide panel, set column offset to zero before width to 240.

Partial display, vertical scrolling, analog tuning, refresh timing, and TE
signaling are not simulated. GRAM survives SWRESET; reset returns the display
to sleep/off with default registers. Unsupported pixel formats consume no
pixels. Out-of-range or reversed address windows cannot write out of bounds.

From this directory:

```powershell
cargo test
cargo clippy -- -D warnings
cargo build --release --target wasm32-unknown-unknown
```

Reference: [Sitronix ST7789V datasheet, sections 8.8, 8.12 and 9.1.28](https://dl.espressif.com/dl/schematics/ST7789V_SPEC_V1.0.pdf).
