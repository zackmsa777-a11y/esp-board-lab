//! ST7789V four-wire SPI display with a native-orientation RGBA framebuffer.
//!
//! Models address control and serial pixel formats from the Sitronix ST7789V
//! datasheet, sections 8.8, 8.12 and 9.1.28. Analog panel tuning, refresh timing,
//! partial display, scrolling and tearing-effect signaling are not simulated.

use esp_part::prelude::*;

const GRAM_WIDTH: usize = 240;
const GRAM_HEIGHT: usize = 320;
const MY: u8 = 0x80;
const MX: u8 = 0x40;
const MV: u8 = 0x20;
const BGR: u8 = 0x08;

struct St7789 {
    cs: Option<u32>,
    sck: Option<u32>,
    mosi: Option<u32>,
    dc: Option<u32>,
    bl: Option<u32>,
    on: bool,
    sleeping: bool,
    inverted: bool,
    backlight: bool,
    madctl: u8,
    colmod: u8,
    command: u8,
    params: [u8; 4],
    param_len: usize,
    columns: [u16; 2],
    rows: [u16; 2],
    column: u16,
    row: u16,
    pixel: [u8; 3],
    pixel_len: usize,
    read_index: usize,
    frames: u64,
    gram: Vec<[u8; 3]>,
    rgba: Vec<u8>,
    width: usize,
    height: usize,
    col_offset: usize,
    row_offset: usize,
    seq: u32,
}

impl Default for St7789 {
    fn default() -> Self {
        let mut rgba = vec![0; GRAM_WIDTH * GRAM_HEIGHT * 4];
        for alpha in rgba.iter_mut().skip(3).step_by(4) {
            *alpha = 255;
        }
        Self {
            cs: None,
            sck: None,
            mosi: None,
            dc: None,
            bl: None,
            on: false,
            sleeping: true,
            inverted: false,
            backlight: true, // A panel with no BL wire is permanently powered.
            madctl: 0,
            colmod: 0x66,
            command: 0,
            params: [0; 4],
            param_len: 0,
            columns: [0, 239],
            rows: [0, 319],
            column: 0,
            row: 0,
            pixel: [0; 3],
            pixel_len: 0,
            read_index: 0,
            frames: 0,
            gram: vec![[0; 3]; GRAM_WIDTH * GRAM_HEIGHT],
            rgba,
            width: 170,
            height: 320,
            col_offset: 35,
            row_offset: 0,
            seq: 0,
        }
    }
}

impl St7789 {
    fn bump_seq(&mut self) {
        self.seq = self.seq.wrapping_add(1);
    }

    fn visible(&self) -> bool {
        self.on && !self.sleeping && self.backlight
    }

    fn rgba_pixel(&self, x: usize, y: usize) -> [u8; 4] {
        if !self.visible() {
            return [0, 0, 0, 255];
        }
        let [mut r, mut g, mut b] = self.gram[y * GRAM_WIDTH + x];
        if self.madctl & BGR != 0 {
            std::mem::swap(&mut r, &mut b);
        }
        if self.inverted {
            (r, g, b) = (255 - r, 255 - g, 255 - b);
        }
        [r, g, b, 255]
    }

    // State/geometry changes repaint once. SPI pixel writes touch one pixel only.
    fn repaint(&mut self) {
        for py in 0..self.height {
            for px in 0..self.width {
                let color = self.rgba_pixel(px + self.col_offset, py + self.row_offset);
                let i = (py * self.width + px) * 4;
                self.rgba[i..i + 4].copy_from_slice(&color);
            }
        }
        self.bump_seq();
    }

    fn reset(&mut self) {
        // SWRESET resets controller registers, not panel wiring, geometry, or GRAM.
        self.on = false;
        self.sleeping = true;
        self.inverted = false;
        self.madctl = 0;
        self.colmod = 0x66;
        self.columns = [0, 239];
        self.rows = [0, 319];
        self.column = 0;
        self.row = 0;
        self.repaint();
    }

    fn command(&mut self, command: u8) {
        self.command = command;
        self.param_len = 0;
        self.pixel_len = 0;
        self.read_index = 0;
        let previous = (self.on, self.sleeping, self.inverted);
        match command {
            0x01 => self.reset(),
            0x10 => self.sleeping = true,
            0x11 => self.sleeping = false,
            0x20 => self.inverted = false,
            0x21 => self.inverted = true,
            0x28 => self.on = false,
            0x29 => self.on = true,
            0x2c => {
                self.column = self.columns[0];
                self.row = self.rows[0];
                self.frames = self.frames.wrapping_add(1);
            }
            // RAMWRC resumes the counters instead of restarting the window.
            // NOP, NORON and tuning/unsupported commands accept subsequent
            // parameter bytes until the next command; none can leak into GRAM.
            _ => {}
        }
        if command != 0x01 && previous != (self.on, self.sleeping, self.inverted) {
            self.repaint();
        }
    }

    fn data(&mut self, byte: u8) {
        match self.command {
            0x2c | 0x3c => self.pixel_byte(byte),
            0x2a | 0x2b if self.param_len < 4 => {
                self.params[self.param_len] = byte;
                self.param_len += 1;
                if self.param_len == 4 {
                    let range = [
                        u16::from_be_bytes([self.params[0], self.params[1]]),
                        u16::from_be_bytes([self.params[2], self.params[3]]),
                    ];
                    if self.command == 0x2a {
                        self.columns = range;
                    } else {
                        self.rows = range;
                    }
                }
            }
            0x36 if self.param_len == 0 => {
                let old = self.madctl;
                self.madctl = byte;
                self.param_len = 1;
                // ML/MH change refresh direction only. MX/MY/MV affect future
                // memory access, not the physical positions of stored pixels.
                if (old ^ byte) & BGR != 0 {
                    self.repaint();
                }
            }
            0x3a if self.param_len == 0 => {
                self.colmod = byte;
                self.param_len = 1;
            }
            _ => {}
        }
    }

    fn pixel_byte(&mut self, byte: u8) {
        let count = match self.colmod & 7 {
            5 => 2,
            6 => 3,
            _ => return, // Unsupported pixel format; don't misinterpret its data.
        };
        self.pixel[self.pixel_len] = byte;
        self.pixel_len += 1;
        if self.pixel_len != count {
            return;
        }
        self.pixel_len = 0;
        let rgb = if count == 2 {
            let word = u16::from_be_bytes([self.pixel[0], self.pixel[1]]);
            let r = ((word >> 11) & 31) as u8;
            let g = ((word >> 5) & 63) as u8;
            let b = (word & 31) as u8;
            [
                (r << 3) | (r >> 2),
                (g << 2) | (g >> 4),
                (b << 3) | (b >> 2),
            ]
        } else {
            self.pixel.map(|c| (c & 0xfc) | (c >> 6))
        };
        self.write_pixel(rgb);
        self.advance();
    }

    fn physical_address(&self) -> Option<(usize, usize)> {
        if self.columns[0] > self.columns[1] || self.rows[0] > self.rows[1] {
            return None;
        }
        // CASET/RASET are logical column/row addresses. Exchange first, then
        // mirror physical axes: with MV=1 CASET spans 0..319, RASET 0..239.
        let (mut x, mut y) = (usize::from(self.column), usize::from(self.row));
        if self.madctl & MV != 0 {
            std::mem::swap(&mut x, &mut y);
        }
        if x >= GRAM_WIDTH || y >= GRAM_HEIGHT {
            return None;
        }
        if self.madctl & MX != 0 {
            x = GRAM_WIDTH - 1 - x;
        }
        if self.madctl & MY != 0 {
            y = GRAM_HEIGHT - 1 - y;
        }
        Some((x, y))
    }

    fn write_pixel(&mut self, rgb: [u8; 3]) {
        let Some((x, y)) = self.physical_address() else {
            return;
        };
        self.gram[y * GRAM_WIDTH + x] = rgb;
        if x < self.col_offset || y < self.row_offset {
            return;
        }
        let (px, py) = (x - self.col_offset, y - self.row_offset);
        if px >= self.width || py >= self.height {
            return;
        }
        let i = (py * self.width + px) * 4;
        let rgba = self.rgba_pixel(x, y);
        if self.rgba[i..i + 4] != rgba {
            self.rgba[i..i + 4].copy_from_slice(&rgba);
            self.bump_seq();
        }
    }

    fn advance(&mut self) {
        if self.column < self.columns[1] {
            self.column += 1;
        } else {
            self.column = self.columns[0];
            self.row = if self.row < self.rows[1] {
                self.row + 1
            } else {
                self.rows[0]
            };
        }
    }

    fn read_byte(&mut self) -> u8 {
        let i = self.read_index;
        self.read_index = self.read_index.saturating_add(1);
        // SPI dummy clocks are represented separately by the transfer; these
        // are the payload bytes, without an extra software-inserted dummy byte.
        match (self.command, i) {
            (0x04, 0..=2) => [0x85, 0x85, 0x52][i],
            (0xda | 0xdb, 0) => 0x85,
            (0xdc, 0) => 0x52,
            (0x09, 0) => self.madctl,
            (0x09, 1) => 0x80 | if !self.sleeping { 0x10 } else { 0 },
            (0x09, 2) => {
                if self.on {
                    0x04
                } else {
                    0
                }
            }
            (0x0a, 0) => {
                0x08 | if !self.sleeping { 0x10 } else { 0 } | if self.on { 0x04 } else { 0 }
            }
            (0x0b, 0) => self.madctl,
            (0x0c, 0) => self.colmod,
            (0x0d, 0) => {
                if self.inverted {
                    0x20
                } else {
                    0
                }
            }
            (0x0f, 0) => 0xc0,
            _ => 0,
        }
    }
}

impl Device for St7789 {
    const NAME: &'static str = "st7789";
    const ON_BUS: bool = true;

    fn configure(&mut self, config: &PartConfig) {
        // Invalid GPIOs are disconnected instead of causing a shift overflow.
        let pin = |name: &str| config.pins.get(name).copied().filter(|p| *p < 64);
        self.cs = pin("CS");
        self.sck = pin("SCK");
        self.mosi = pin("MOSI");
        self.dc = pin("DC");
        self.bl = pin("BL");
        self.backlight = self.bl.is_none();
        self.repaint();
    }

    fn claims(&self) -> Vec<Claim> {
        let spi = SpiClaim {
            cs_pin: self.cs,
            clk_pin: self.sck,
            mosi_pin: self.mosi,
            cs_active_high: Some(false),
            ..Default::default()
        };
        let mut claims = vec![Claim {
            what: Some(claim::What::Spi(spi)),
        }];
        if let Some(bl) = self.bl {
            claims.push(watches(1 << bl));
        }
        claims
    }

    fn on_pins(&mut self, levels: u64, _now_ns: u64) {
        if let Some(bl) = self.bl {
            let on = levels & (1 << bl) != 0;
            if self.backlight != on {
                self.backlight = on;
                self.repaint();
            }
        }
    }

    fn on_bus(&mut self, request: &BusRequest) -> Option<BusReply> {
        let Some(bus_request::Op::Spi(spi)) = &request.op else {
            return None;
        };
        let data = self.dc.is_some_and(|dc| spi.pin_levels & (1 << dc) != 0);
        for &byte in &spi.tx {
            if data {
                self.data(byte);
            } else {
                self.command(byte);
            }
        }
        (spi.rx_len != 0).then(|| BusReply {
            correlation_id: request.correlation_id,
            ack: true,
            data: (0..spi.rx_len).map(|_| self.read_byte()).collect(),
            op: BusOp::Spi as i32,
        })
    }

    fn on_input(&mut self, name: &str) {
        let Some((key, value)) = set_value(name) else {
            return;
        };
        let old = (self.width, self.height, self.col_offset, self.row_offset);
        match key {
            "panel-width" => self.width = (value as usize).clamp(1, GRAM_WIDTH - self.col_offset),
            "panel-height" => {
                self.height = (value as usize).clamp(1, GRAM_HEIGHT - self.row_offset)
            }
            "col-offset" => self.col_offset = (value as usize).min(GRAM_WIDTH - self.width),
            "row-offset" => self.row_offset = (value as usize).min(GRAM_HEIGHT - self.height),
            _ => return,
        }
        if old != (self.width, self.height, self.col_offset, self.row_offset) {
            self.repaint();
        }
    }

    fn state(&self) -> Option<State> {
        Some(
            State::new()
                .set("on", self.on)
                .set("sleeping", self.sleeping)
                .set("inverted", self.inverted)
                .set("backlight", self.backlight)
                .set("colmod", format!("0x{:02x}", self.colmod))
                .set("madctl", format!("0x{:02x}", self.madctl))
                .set("frames", self.frames),
        )
    }
}

// Full 240x320 RGB666 data plus protobuf overhead fits a single request.
esp_part::export_part!(St7789, buffer = 262144);

/// Address of packed RGBA8888 pixels; allocation stays fixed across geometry changes.
#[no_mangle]
pub extern "C" fn ebl_fb_ptr() -> u32 {
    __ESP_PART.with(|p| p.device.rgba.as_ptr() as u32)
}

#[no_mangle]
pub extern "C" fn ebl_fb_width() -> u32 {
    __ESP_PART.with(|p| p.device.width as u32)
}

#[no_mangle]
pub extern "C" fn ebl_fb_height() -> u32 {
    __ESP_PART.with(|p| p.device.height as u32)
}

#[no_mangle]
pub extern "C" fn ebl_fb_seq() -> u32 {
    __ESP_PART.with(|p| p.device.seq)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DC: u64 = 1 << 16;
    const BL: u64 = 1 << 21;

    fn display() -> St7789 {
        let mut display = St7789::default();
        let pins = [("CS", 41), ("DC", 16), ("SCK", 11), ("MOSI", 9), ("BL", 21)]
            .map(|(key, value)| (key.to_string(), value))
            .into();
        display.configure(&PartConfig {
            pins,
            ..Default::default()
        });
        display.on_pins(BL, 0);
        display
    }

    fn request(bytes: &[u8], data: bool, rx_len: u32) -> BusRequest {
        BusRequest {
            correlation_id: 42,
            op: Some(bus_request::Op::Spi(SpiTransfer {
                tx: bytes.to_vec(),
                pin_levels: BL | if data { DC } else { 0 },
                rx_len,
                ..Default::default()
            })),
        }
    }

    fn send(display: &mut St7789, data: bool, bytes: &[u8]) {
        assert!(display.on_bus(&request(bytes, data, 0)).is_none());
    }

    fn command(display: &mut St7789, command: u8, params: &[u8]) {
        send(display, false, &[command]);
        send(display, true, params);
    }

    fn ready(display: &mut St7789) {
        command(display, 0x11, &[]);
        command(display, 0x29, &[]);
        command(display, 0x3a, &[0x55]);
    }

    fn window(display: &mut St7789, x0: u16, x1: u16, y0: u16, y1: u16) {
        command(
            display,
            0x2a,
            &[x0.to_be_bytes(), x1.to_be_bytes()].concat(),
        );
        command(
            display,
            0x2b,
            &[y0.to_be_bytes(), y1.to_be_bytes()].concat(),
        );
    }

    fn pixel(display: &St7789, x: usize, y: usize) -> [u8; 4] {
        let i = (y * display.width + x) * 4;
        display.rgba[i..i + 4].try_into().unwrap()
    }

    fn full_panel(display: &mut St7789) {
        display.on_input("set:col-offset=0");
        display.on_input("set:panel-width=240");
    }

    #[test]
    fn factory_style_init_and_window_produce_native_panel_rgba() {
        let mut d = display();
        command(&mut d, 0x01, &[]);
        command(&mut d, 0x11, &[]);
        command(&mut d, 0x13, &[]);
        for cmd in [
            0xb2, 0xb7, 0xbb, 0xc0, 0xc2, 0xc3, 0xc4, 0xc6, 0xd0, 0xe0, 0xe1, 0x35,
        ] {
            command(&mut d, cmd, &[0xff, 0x2c, 0x36, 0x55, 0xaa]);
        }
        command(&mut d, 0x3a, &[0x55]);
        command(&mut d, 0x36, &[0]);
        command(&mut d, 0x29, &[]);
        window(&mut d, 35, 36, 0, 1);
        command(
            &mut d,
            0x2c,
            &[0xf8, 0x00, 0x07, 0xe0, 0x00, 0x1f, 0xff, 0xff],
        );
        assert_eq!((d.width, d.height), (170, 320));
        assert_eq!(pixel(&d, 0, 0), [255, 0, 0, 255]);
        assert_eq!(pixel(&d, 1, 0), [0, 255, 0, 255]);
        assert_eq!(pixel(&d, 0, 1), [0, 0, 255, 255]);
        assert_eq!(pixel(&d, 1, 1), [255; 4]);
        assert_eq!(pixel(&d, 2, 0), [0, 0, 0, 255]);
        assert_eq!(d.frames, 1);
    }

    #[test]
    fn all_eight_address_orders_match_datasheet_figure_33() {
        // Four host pixels are A B / C D at logical (2,4)..(3,5).
        // Expected locations are literal physical GRAM coordinates, including
        // non-square dimensions, to catch mirroring on the wrong side of MV.
        let cases = [
            (0x00, [(2, 4), (3, 4), (2, 5), (3, 5)]),
            (0x80, [(2, 315), (3, 315), (2, 314), (3, 314)]),
            (0x40, [(237, 4), (236, 4), (237, 5), (236, 5)]),
            (0xc0, [(237, 315), (236, 315), (237, 314), (236, 314)]),
            (0x20, [(4, 2), (4, 3), (5, 2), (5, 3)]),
            (0xa0, [(4, 317), (4, 316), (5, 317), (5, 316)]),
            (0x60, [(235, 2), (235, 3), (234, 2), (234, 3)]),
            (0xe0, [(235, 317), (235, 316), (234, 317), (234, 316)]),
        ];
        for (madctl, positions) in cases {
            let mut d = display();
            full_panel(&mut d);
            ready(&mut d);
            command(&mut d, 0x36, &[madctl]);
            window(&mut d, 2, 3, 4, 5);
            command(&mut d, 0x2c, &[0xf8, 0, 0x07, 0xe0, 0, 0x1f, 0xff, 0xff]);
            for ((x, y), color) in positions.into_iter().zip([
                [255, 0, 0, 255],
                [0, 255, 0, 255],
                [0, 0, 255, 255],
                [255; 4],
            ]) {
                assert_eq!(pixel(&d, x, y), color, "MADCTL={madctl:02x}, ({x},{y})");
            }
        }
    }

    #[test]
    fn landscape_addresses_cover_all_320_columns_with_panel_offset_on_rows() {
        let mut d = display();
        ready(&mut d);
        command(&mut d, 0x36, &[MV | MX]);
        window(&mut d, 319, 319, 35, 35);
        command(&mut d, 0x2c, &[0xf8, 0]);
        assert_eq!(pixel(&d, 169, 319), [255, 0, 0, 255]);
    }

    #[test]
    fn parameter_and_rgb565_bytes_survive_arbitrary_spi_splitting() {
        let mut d = display();
        ready(&mut d);
        send(&mut d, false, &[0x2a]);
        for byte in [0, 35, 0, 36] {
            send(&mut d, true, &[byte]);
        }
        send(&mut d, false, &[0x2b]);
        send(&mut d, true, &[0, 2, 0]);
        send(&mut d, true, &[2]);
        send(&mut d, false, &[0x2c]);
        let before = d.seq;
        send(&mut d, true, &[0xf8]);
        assert_eq!(d.seq, before);
        send(&mut d, true, &[0, 0x07]);
        send(&mut d, true, &[0xe0]);
        assert_eq!(pixel(&d, 0, 2), [255, 0, 0, 255]);
        assert_eq!(pixel(&d, 1, 2), [0, 255, 0, 255]);
        assert!(d.seq > before);
    }

    #[test]
    fn ramwrc_continues_and_ramwr_restarts_and_window_wraps() {
        let mut d = display();
        ready(&mut d);
        window(&mut d, 35, 36, 0, 0);
        command(&mut d, 0x2c, &[0xf8, 0]);
        command(&mut d, 0x3c, &[0x07, 0xe0]);
        send(&mut d, true, &[0, 0x1f]); // wraps to first pixel
        assert_eq!(pixel(&d, 0, 0), [0, 0, 255, 255]);
        assert_eq!(pixel(&d, 1, 0), [0, 255, 0, 255]);
        command(&mut d, 0x2c, &[0xff, 0xff]);
        assert_eq!(pixel(&d, 0, 0), [255; 4]);
        assert_eq!(d.frames, 2);
    }

    #[test]
    fn rgb666_uses_six_high_bits_and_keeps_partial_pixels() {
        let mut d = display();
        ready(&mut d);
        command(&mut d, 0x3a, &[0x66]);
        window(&mut d, 35, 36, 0, 0);
        command(&mut d, 0x2c, &[0xff]);
        send(&mut d, true, &[0x83]);
        send(&mut d, true, &[0x07, 0, 0xfc]);
        send(&mut d, true, &[0xfc]);
        assert_eq!(pixel(&d, 0, 0), [255, 130, 4, 255]);
        assert_eq!(pixel(&d, 1, 0), [0, 255, 255, 255]);
    }

    #[test]
    fn inversion_and_bgr_update_existing_and_future_pixels() {
        let mut d = display();
        ready(&mut d);
        window(&mut d, 35, 35, 0, 0);
        command(&mut d, 0x2c, &[0xf8, 0]);
        command(&mut d, 0x21, &[]);
        assert_eq!(pixel(&d, 0, 0), [0, 255, 255, 255]);
        command(&mut d, 0x36, &[BGR]);
        assert_eq!(pixel(&d, 0, 0), [255, 255, 0, 255]);
        command(&mut d, 0x20, &[]);
        assert_eq!(pixel(&d, 0, 0), [0, 0, 255, 255]);
        command(&mut d, 0x2c, &[0, 0x1f]);
        assert_eq!(pixel(&d, 0, 0), [255, 0, 0, 255]);
    }

    #[test]
    fn display_sleep_and_backlight_hide_pixels_but_preserve_gram() {
        let mut d = display();
        ready(&mut d);
        window(&mut d, 35, 35, 0, 0);
        command(&mut d, 0x2c, &[0xff, 0xff]);
        for (off, on) in [(0x28, 0x29), (0x10, 0x11)] {
            let before = d.seq;
            command(&mut d, off, &[]);
            assert_eq!(pixel(&d, 0, 0), [0, 0, 0, 255]);
            assert!(d.seq > before);
            command(&mut d, on, &[]);
            assert_eq!(pixel(&d, 0, 0), [255; 4]);
        }
        d.on_pins(0, 1);
        assert_eq!(pixel(&d, 0, 0), [0, 0, 0, 255]);
        command(&mut d, 0x2c, &[0xf8, 0]);
        command(&mut d, 0x21, &[]);
        assert_eq!(
            pixel(&d, 0, 0),
            [0, 0, 0, 255],
            "inversion cannot illuminate BL-off panel"
        );
        d.on_pins(BL, 2);
        assert_eq!(pixel(&d, 0, 0), [0, 255, 255, 255]);
        command(&mut d, 0x01, &[]);
        assert_eq!(pixel(&d, 0, 0), [0, 0, 0, 255]);
        assert!(!d.on && d.sleeping && !d.inverted);
        assert_eq!((d.madctl, d.colmod), (0, 0x66));
    }

    #[test]
    fn sequence_tracks_actual_visible_changes_and_state_transitions() {
        let mut d = display();
        ready(&mut d);
        window(&mut d, 35, 35, 0, 0);
        let before = d.seq;
        command(&mut d, 0x2c, &[0xf8, 0]);
        assert_eq!(d.seq, before + 1);
        send(&mut d, true, &[0xf8, 0]);
        command(&mut d, 0x00, &[0xff, 0xff]);
        assert_eq!(
            d.seq,
            before + 1,
            "same color and ignored params change nothing"
        );
        command(&mut d, 0x28, &[]);
        let off_seq = d.seq;
        command(&mut d, 0x2c, &[0x07, 0xe0]);
        assert_eq!(
            d.seq, off_seq,
            "hidden GRAM writes do not change the exported image"
        );
        command(&mut d, 0x29, &[]);
        assert!(d.seq > off_seq);
        assert_eq!(pixel(&d, 0, 0), [0, 255, 0, 255]);
        d.seq = u32::MAX;
        command(&mut d, 0x28, &[]);
        assert_eq!(d.seq, 0);
    }

    #[test]
    fn refresh_direction_flags_do_not_change_memory_addressing() {
        let mut d = display();
        ready(&mut d);
        command(&mut d, 0x36, &[0x10 | 0x04]); // ML, MH
        window(&mut d, 35, 35, 0, 0);
        command(&mut d, 0x2c, &[0xf8, 0]);
        assert_eq!(pixel(&d, 0, 0), [255, 0, 0, 255]);
        assert_eq!(d.state().unwrap().get("madctl"), Some("0x14"));
    }

    #[test]
    fn reads_answer_exact_length_with_id_status_and_registers() {
        let mut d = display();
        command(&mut d, 0x04, &[]);
        let reply = d.on_bus(&request(&[], true, 5)).unwrap();
        assert_eq!(
            (reply.correlation_id, reply.op, reply.ack),
            (42, BusOp::Spi as i32, true)
        );
        assert_eq!(reply.data, [0x85, 0x85, 0x52, 0, 0]);
        for (cmd, expected) in [
            (0xda, 0x85),
            (0xdb, 0x85),
            (0xdc, 0x52),
            (0x0c, 0x66),
            (0xfe, 0),
        ] {
            command(&mut d, cmd, &[]);
            assert_eq!(d.on_bus(&request(&[], true, 1)).unwrap().data, [expected]);
        }
        command(&mut d, 0x04, &[]);
        assert_eq!(d.on_bus(&request(&[], true, 1)).unwrap().data, [0x85]);
        assert_eq!(d.on_bus(&request(&[], true, 2)).unwrap().data, [0x85, 0x52]);
        ready(&mut d);
        command(&mut d, 0x09, &[]);
        assert_eq!(
            d.on_bus(&request(&[], true, 4)).unwrap().data,
            [0, 0x90, 4, 0]
        );
    }

    #[test]
    fn claims_plain_gpio_cs_bus_pads_and_backlight_watch() {
        let d = display();
        assert_eq!(
            d.claims(),
            [
                Claim {
                    what: Some(claim::What::Spi(SpiClaim {
                        cs_pin: Some(41),
                        clk_pin: Some(11),
                        mosi_pin: Some(9),
                        cs_active_high: Some(false),
                        ..Default::default()
                    }))
                },
                watches(BL),
            ]
        );
    }

    #[test]
    fn dc_uses_transfer_snapshot_rather_than_end_of_pass_pins() {
        let mut d = display();
        ready(&mut d);
        d.on_pins(BL | DC, 100); // every on_pins sample may have D/C high
        window(&mut d, 35, 35, 0, 0);
        command(&mut d, 0x2c, &[0xf8, 0]);
        assert_eq!(pixel(&d, 0, 0), [255, 0, 0, 255]);
    }

    #[test]
    fn geometry_inputs_repack_panel_without_reallocating_and_reject_bad_windows() {
        let mut d = display();
        let ptr = d.rgba.as_ptr();
        ready(&mut d);
        window(&mut d, 35, 36, 0, 0);
        command(&mut d, 0x2c, &[0xf8, 0, 0x07, 0xe0]);
        d.on_input("set:panel-width=1");
        d.on_input("set:panel-height=1");
        d.on_input("set:col-offset=36");
        assert_eq!((d.width, d.height), (1, 1));
        assert_eq!(pixel(&d, 0, 0), [0, 255, 0, 255]);
        assert_eq!(d.rgba.as_ptr(), ptr);
        for range in [(65_535, 65_535, 0, 0), (36, 35, 0, 0), (36, 36, 5, 4)] {
            window(&mut d, range.0, range.1, range.2, range.3);
            command(&mut d, 0x2c, &[0, 0x1f]);
            assert_eq!(pixel(&d, 0, 0), [0, 255, 0, 255]);
        }
        d.on_input("set:panel-width=999999");
        d.on_input("set:row-offset=999999");
        d.on_input("set:panel-height=-1");
        assert!(d.width + d.col_offset <= GRAM_WIDTH);
        assert!(d.height + d.row_offset <= GRAM_HEIGHT);
    }
}
