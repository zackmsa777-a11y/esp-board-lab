//! IR LED carrier demodulator and capture. SPDX-License-Identifier: MIT OR Apache-2.0
use esp_part::prelude::*;
pub mod protocol;
use protocol::{decode, Signal};
const GAP_NS: u64 = 12_000_000;
const CARRIER_GAP_NS: u64 = 100_000;

#[derive(Default)]
struct IrTx {
    pin: Option<u32>,
    level: bool,
    initialized: bool,
    last_rise: Option<u64>,
    last_fall: u64,
    period: u64,
    high: u64,
    period_samples: Vec<u64>,
    high_samples: Vec<u64>,
    sample_index: usize,
    mark: Option<u64>,
    end: Option<u64>,
    data: Vec<u32>,
    overflow: bool,
    pwm: bool,
    pending_pwm: Option<PwmState>,
    count: u32,
    last: Option<Signal>,
}
impl IrTx {
    fn median(samples: &[u64], fallback: u64) -> u64 {
        if samples.is_empty() {
            return fallback;
        }
        let mut sorted = samples.to_vec();
        sorted.sort_unstable();
        sorted[sorted.len() / 2]
    }
    fn sample(samples: &mut Vec<u64>, index: usize, value: u64) {
        if samples.len() < 128 {
            samples.push(value);
        } else {
            samples[index % 128] = value;
        }
    }
    fn finish(&mut self) {
        if !self.data.is_empty() && !self.overflow {
            // A final carrier pulse is commonly cut short when its mark ends.
            // Estimate the carrier from a window, never just that final pulse.
            let period = Self::median(&self.period_samples, self.period);
            let high = Self::median(&self.high_samples, self.high);
            let data = std::mem::take(&mut self.data);
            let parsed = decode(&data);
            self.last = Some(Signal {
                name: format!("capture_{}", self.count + 1),
                frequency: 1_000_000_000u64.checked_div(period).unwrap_or(38_000) as u32,
                duty_cycle: if period > 0 {
                    high as f32 / period as f32
                } else {
                    0.33
                },
                data,
                parsed,
            });
            self.count = self.count.wrapping_add(1);
        }
        self.data.clear();
        self.overflow = false;
        self.end = None;
        self.period_samples.clear();
        self.high_samples.clear();
        self.sample_index = 0;
    }
    fn append(&mut self, ns: u64) {
        if self.data.len() < 1023 {
            self.data.push(((ns + 500) / 1000).max(1) as u32);
        } else {
            self.overflow = true;
        }
    }
    fn start_mark(&mut self, now: u64) {
        if self.mark.is_some() {
            return;
        }
        if let Some(end) = self.end {
            if now.saturating_sub(end) > GAP_NS {
                self.finish();
            } else {
                self.append(now.saturating_sub(end));
            }
        }
        self.mark = Some(now);
    }
    fn end_mark(&mut self, now: u64) {
        if let Some(start) = self.mark.take() {
            if now > start {
                self.append(now - start);
                self.end = Some(now);
            }
        }
    }
    fn edge_end(&self) -> u64 {
        self.last_fall
            + if self.period > 0 && self.high < self.period {
                self.period - self.high
            } else {
                0
            }
    }
}
impl Device for IrTx {
    const NAME: &'static str = "ir_tx";
    const ON_MESSAGE: bool = true;
    fn configure(&mut self, config: &PartConfig) {
        self.pin = config.pins.get("LED").copied().filter(|p| *p < 64);
    }
    fn claims(&self) -> Vec<Claim> {
        self.pin
            .map(|p| Claim {
                what: Some(claim::What::Gpio(GpioClaim {
                    drive_pins: 0,
                    watch_pins: 1 << p,
                    pwm_pins: 1 << p,
                })),
            })
            .into_iter()
            .collect()
    }
    fn on_pins(&mut self, levels: u64, now: u64) {
        let Some(pin) = self.pin else {
            return;
        };
        let level = levels & (1 << pin) != 0;
        if !self.initialized {
            self.initialized = true;
            self.level = level;
            return;
        }
        if level == self.level {
            return;
        }
        self.level = level;
        if self.pwm {
            return;
        }
        if level {
            if self.mark.is_some() && now.saturating_sub(self.last_fall) > CARRIER_GAP_NS {
                self.end_mark(self.edge_end());
            }
            if let Some(previous) = self.last_rise {
                let period = now.saturating_sub(previous);
                if (10_000..=100_000).contains(&period) {
                    self.period = period;
                    Self::sample(&mut self.period_samples, self.sample_index, period);
                }
            }
            self.start_mark(now);
            self.last_rise = Some(now);
        } else {
            self.last_fall = now;
            if let Some(rise) = self.last_rise {
                let high = now.saturating_sub(rise);
                if high < CARRIER_GAP_NS {
                    self.high = high;
                    Self::sample(&mut self.high_samples, self.sample_index, high);
                    self.sample_index = self.sample_index.wrapping_add(1);
                }
            }
        }
    }
    fn on_pwm(&mut self, state: &PwmState) {
        if self.pin == Some(state.pin) {
            self.pending_pwm = Some(*state);
        }
    }
    fn poll(&mut self, now: u64) -> Option<EmulatorMessage> {
        // on_pwm has no time parameter in this SDK. The ABI host immediately polls
        // with the message timestamp, so apply the waveform change here.
        if let Some(state) = self.pending_pwm.take() {
            let active =
                state.period_ns > 0 && state.high_ns > 0 && state.high_ns < state.period_ns;
            if active {
                self.period = state.period_ns;
                self.high = state.high_ns;
                if !self.pwm {
                    self.start_mark(now);
                }
            } else if self.pwm {
                self.end_mark(now);
            }
            self.pwm = active;
        }
        if !self.pwm
            && !self.level
            && self.mark.is_some()
            && now.saturating_sub(self.last_fall) > CARRIER_GAP_NS
        {
            self.end_mark(self.edge_end());
        }
        if self.mark.is_none() && self.end.is_some_and(|end| now.saturating_sub(end) > GAP_NS) {
            self.finish();
        }
        None
    }
    fn state(&self) -> Option<State> {
        let parsed = self.last.as_ref().and_then(|s| s.parsed.as_ref());
        Some(
            State::new()
                .set("tx_count", self.count)
                .set(
                    "last_protocol",
                    parsed.map_or(if self.last.is_some() { "RAW" } else { "" }, |p| {
                        &p.protocol
                    }),
                )
                .set(
                    "last_address",
                    parsed
                        .map(|p| format!("0x{:X}", p.address))
                        .unwrap_or_default(),
                )
                .set(
                    "last_command",
                    parsed
                        .map(|p| format!("0x{:X}", p.command))
                        .unwrap_or_default(),
                )
                .set(
                    "last_raw",
                    self.last.as_ref().map(Signal::raw_text).unwrap_or_default(),
                )
                .set(
                    "last_parsed",
                    self.last
                        .as_ref()
                        .and_then(Signal::parsed_text)
                        .unwrap_or_default(),
                ),
        )
    }
}
esp_part::export_part!(IrTx, buffer = 65536);

#[cfg(test)]
mod tests {
    use super::*;
    use protocol::{encode, Message};
    fn part() -> IrTx {
        let mut p = IrTx::default();
        p.configure(&PartConfig {
            pins: [("LED".into(), 2)].into(),
            ..Default::default()
        });
        p.on_pins(0, 0);
        p
    }
    #[test]
    fn carrier_edges_demodulate_nec_and_split_frames() {
        let mut p = part();
        let m = Message {
            protocol: "NEC".into(),
            address: 0x42,
            command: 0x19,
        };
        let signal = encode(&m).unwrap();
        let period = 26_316;
        let high = 8_772;
        let mut now = 1_000_000;
        for _ in 0..2 {
            for (i, duration) in signal.data.iter().enumerate() {
                if i % 2 == 0 {
                    let cycles = (u64::from(*duration) * 1000 + period / 2) / period;
                    for cycle in 0..cycles {
                        let t = now + cycle * period;
                        p.on_pins(4, t);
                        p.poll(t);
                        let pulse_high = if cycle + 1 == cycles { high / 3 } else { high };
                        p.on_pins(0, t + pulse_high);
                        p.poll(t + pulse_high);
                    }
                    now += cycles * period;
                } else {
                    now += u64::from(*duration) * 1000;
                }
            }
            now += 20_000_000;
            p.poll(now);
        }
        assert_eq!(p.count, 2);
        let last = p.last.unwrap();
        assert_eq!(last.parsed, Some(m));
        assert!((last.frequency as i32 - 38000).abs() < 2);
        assert!((last.duty_cycle - 1.0 / 3.0).abs() < 0.001);
    }
    #[test]
    fn pwm_states_demodulate_and_ignore_sampled_carrier_edges() {
        let mut p = part();
        let m = Message {
            protocol: "RC6".into(),
            address: 0x23,
            command: 0x17,
        };
        let signal = encode(&m).unwrap();
        let mut now = 1_000_000;
        for (i, d) in signal.data.iter().enumerate() {
            p.on_pwm(&PwmState {
                pin: 2,
                period_ns: 27_778,
                high_ns: if i % 2 == 0 { 9_259 } else { 0 },
            });
            p.poll(now);
            if i % 2 == 0 {
                p.on_pins(4, now + 1);
                p.on_pins(0, now + 9259);
            }
            now += u64::from(*d) * 1000;
        }
        p.on_pwm(&PwmState {
            pin: 2,
            period_ns: 0,
            high_ns: 0,
        });
        p.poll(now);
        p.poll(now + 20_000_000);
        assert_eq!(p.count, 1);
        assert_eq!(p.last.unwrap().parsed, Some(m));
    }
}
