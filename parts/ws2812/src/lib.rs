//! WS2812 800 kHz NRZ receiver. SPDX-License-Identifier: MIT OR Apache-2.0
use esp_part::prelude::*;

struct Ws2812 {
    pin: Option<u32>,
    level: bool,
    initialized: bool,
    edge: u64,
    rise: Option<u64>,
    bits: Vec<bool>,
    invalid: bool,
    rgba: Vec<u8>,
    frames: u32,
}
impl Default for Ws2812 {
    fn default() -> Self {
        Self {
            pin: None,
            level: false,
            initialized: false,
            edge: 0,
            rise: None,
            bits: Vec::new(),
            invalid: false,
            rgba: [0, 0, 0, 255].repeat(8),
            frames: 0,
        }
    }
}
impl Ws2812 {
    fn latch(&mut self) {
        if !self.invalid && self.bits.len() >= 24 {
            for (i, bits) in self
                .bits
                .as_chunks::<24>()
                .0
                .iter()
                .take(self.rgba.len() / 4)
                .enumerate()
            {
                let byte = |offset| {
                    bits[offset..offset + 8]
                        .iter()
                        .fold(0u8, |v, &b| (v << 1) | u8::from(b))
                };
                self.rgba[i * 4..i * 4 + 4].copy_from_slice(&[byte(8), byte(0), byte(16), 255]);
            }
            self.frames = self.frames.wrapping_add(1);
        }
        self.bits.clear();
        self.invalid = false;
    }
    fn reset_if_due(&mut self, now: u64) {
        if self.initialized && !self.level && now.saturating_sub(self.edge) > 50_000 {
            self.latch();
            self.rise = None;
        }
    }
}
impl Device for Ws2812 {
    const NAME: &'static str = "ws2812";
    fn configure(&mut self, config: &PartConfig) {
        self.pin = config.pins.get("DIN").copied().filter(|p| *p < 64);
    }
    fn claims(&self) -> Vec<Claim> {
        self.pin.map(|p| watches(1 << p)).into_iter().collect()
    }
    fn on_pins(&mut self, levels: u64, now: u64) {
        let Some(pin) = self.pin else { return };
        let high = levels & (1 << pin) != 0;
        self.reset_if_due(now);
        if !self.initialized {
            self.initialized = true;
            self.level = high;
            self.edge = now;
            return;
        }
        if high == self.level {
            return;
        }
        if high {
            if let Some(previous) = self.rise {
                let period = now.saturating_sub(previous);
                if !(900..=1600).contains(&period) {
                    self.invalid = true;
                }
            }
            self.rise = Some(now);
        } else if let Some(rise) = self.rise {
            let width = now.saturating_sub(rise);
            if !(200..=1000).contains(&width) {
                self.invalid = true;
            }
            if self.bits.len() < 24 * 1024 {
                self.bits.push(width >= 600);
            } else {
                self.invalid = true;
            }
        }
        self.level = high;
        self.edge = now;
    }
    fn poll(&mut self, now: u64) -> Option<EmulatorMessage> {
        self.reset_if_due(now);
        None
    }
    fn on_input(&mut self, input: &str) {
        if let Some(("count", count)) = set_value(input) {
            self.rgba = [0, 0, 0, 255].repeat((count as usize).clamp(1, 1024));
            self.bits.clear();
            self.invalid = false;
        }
    }
    fn state(&self) -> Option<State> {
        let colors = self
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .map(|p| format!("#{:02x}{:02x}{:02x}", p[0], p[1], p[2]))
            .collect::<Vec<_>>()
            .join(",");
        Some(
            State::new()
                .set("count", self.rgba.len() / 4)
                .set("frames", self.frames)
                .set("colors", colors),
        )
    }
}
esp_part::export_part!(Ws2812, buffer = 65536);
#[no_mangle]
pub extern "C" fn ebl_led_ptr() -> u32 {
    __ESP_PART.with(|p| p.device.rgba.as_ptr() as u32)
}
#[no_mangle]
pub extern "C" fn ebl_led_count() -> u32 {
    __ESP_PART.with(|p| (p.device.rgba.len() / 4) as u32)
}
#[no_mangle]
pub extern "C" fn ebl_led_seq() -> u32 {
    __ESP_PART.with(|p| p.device.frames)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn part() -> Ws2812 {
        let mut p = Ws2812::default();
        p.configure(&PartConfig {
            pins: [("DIN".into(), 14)].into(),
            ..Default::default()
        });
        p.on_pins(0, 0);
        p
    }
    fn send(p: &mut Ws2812, bytes: &[u8], zero: u64, one: u64, start: u64) -> u64 {
        let mut t = start;
        for &byte in bytes {
            for bit in (0..8).rev() {
                p.on_pins(1 << 14, t);
                p.on_pins(0, t + if byte & (1 << bit) != 0 { one } else { zero });
                t += 1250;
            }
        }
        t
    }
    #[test]
    fn grb_exact_timings_and_latch_strictly_above_50us() {
        let mut p = part();
        let end = send(&mut p, &[0x34, 0x12, 0x56], 400, 800, 100_000);
        let fall = p.edge;
        p.poll(fall + 50_000);
        assert_eq!(p.frames, 0);
        p.poll(fall + 50_001);
        assert_eq!(p.frames, 1);
        assert_eq!(&p.rgba[..4], &[0x12, 0x34, 0x56, 255]);
        p.poll(end + 1_000_000);
        assert_eq!(p.frames, 1);
    }
    #[test]
    fn tolerance_reset_discards_incomplete_and_rejects_bad_pulses() {
        let mut p = part();
        send(&mut p, &[0xff], 250, 950, 100_000);
        p.poll(200_000);
        assert_eq!(p.frames, 0);
        send(&mut p, &[0x55, 0xaa, 0xff], 250, 950, 300_000);
        p.poll(400_000);
        assert_eq!(p.frames, 1);
        assert_eq!(&p.rgba[..4], &[0xaa, 0x55, 0xff, 255]);
        send(&mut p, &[0, 0, 0], 100, 800, 500_000);
        p.poll(600_000);
        assert_eq!(p.frames, 1);
    }
    #[test]
    fn latch_before_next_frame_and_count() {
        let mut p = part();
        p.on_input("set:count=2");
        send(&mut p, &[1, 2, 3, 4, 5, 6], 400, 800, 100_000);
        send(&mut p, &[7, 8, 9], 400, 800, 300_000);
        assert_eq!(p.frames, 1);
        p.poll(400_000);
        assert_eq!(p.rgba, [8, 7, 9, 255, 5, 4, 6, 255]);
        assert_eq!(p.claims(), [watches(1 << 14)]);
    }
}
