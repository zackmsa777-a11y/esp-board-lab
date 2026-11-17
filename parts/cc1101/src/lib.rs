//! TI CC1101 digital radio model. Source: SWRS061I sections 10, 12–17,
//! 19, 26–27 and 29: https://www.ti.com/lit/ds/symlink/cc1101.pdf
//! RF is represented by signed baseband RAW durations, not analog waveforms.
mod sub;
#[cfg(test)]
mod tests;
use esp_part::prelude::*;
use std::collections::VecDeque;
use sub::{pulse, Signal};
const XTAL: f64 = 26_000_000.0;
const RESET: [u8; 47] = [
    0x29, 0x2e, 0x3f, 0x07, 0xd3, 0x91, 0xff, 0x04, 0x45, 0x00, 0x00, 0x0f, 0x00, 0x1e, 0xc4, 0xec,
    0x8c, 0x22, 0x02, 0x22, 0xf8, 0x47, 0x07, 0x30, 0x04, 0x36, 0x6c, 0x03, 0x40, 0x91, 0x87, 0x6b,
    0xf8, 0x56, 0x10, 0xa9, 0x0a, 0x20, 0x0d, 0x41, 0x00, 0x59, 0x7f, 0x3f, 0x88, 0x31, 0x0b,
];
#[derive(Clone, Copy)]
struct Access {
    address: u8,
    read: bool,
    burst: bool,
    index: usize,
}
struct Playback {
    signal: Signal,
    index: usize,
    at: u64,
    scheduled: VecDeque<u64>,
}
struct Reception {
    bytes: Vec<u8>,
    crc_ok: bool,
    end: u64,
}
struct Cc1101 {
    pins: std::collections::HashMap<String, u32>,
    regs: [u8; 47],
    pa: [u8; 8],
    rx: VecDeque<u8>,
    tx: VecDeque<u8>,
    marc: u8,
    transition: Option<(u64, u8)>,
    access: Option<Access>,
    now: u64,
    levels: u64,
    rssi: f64,
    crc_ok: bool,
    packet_ready: bool,
    sync: bool,
    rx_overflow: bool,
    tx_underflow: bool,
    sleeping: Option<u8>,
    air: VecDeque<Signal>,
    playback: Option<Playback>,
    reception: Option<Reception>,
    outputs: VecDeque<EmulatorMessage>,
    gdo: [Option<bool>; 2],
    captures: VecDeque<String>,
    tx_count: u32,
    async_raw: Vec<i64>,
    async_edge: u64,
    async_level: bool,
    last_rx: String,
    last_error: String,
}
impl Default for Cc1101 {
    fn default() -> Self {
        Self {
            pins: Default::default(),
            regs: RESET,
            pa: [0; 8],
            rx: VecDeque::new(),
            tx: VecDeque::new(),
            marc: 1,
            transition: None,
            access: None,
            now: 0,
            levels: u64::MAX,
            rssi: -40.0,
            crc_ok: false,
            packet_ready: false,
            sync: false,
            rx_overflow: false,
            tx_underflow: false,
            sleeping: None,
            air: VecDeque::new(),
            playback: None,
            reception: None,
            outputs: VecDeque::new(),
            gdo: [None; 2],
            captures: VecDeque::new(),
            tx_count: 0,
            async_raw: Vec::new(),
            async_edge: 0,
            async_level: false,
            last_rx: String::new(),
            last_error: String::new(),
        }
    }
}
impl Cc1101 {
    fn pin(&self, name: &str) -> Option<u32> {
        self.pins.get(name).copied()
    }
    fn high(&self, name: &str, levels: u64) -> bool {
        self.pin(name).is_some_and(|p| levels & (1 << p) != 0)
    }
    fn asynchronous(&self) -> bool {
        self.regs[8] & 0x30 == 0x30
    }
    fn rate(&self) -> f64 {
        (256.0 + f64::from(self.regs[0x11])) * 2f64.powi(i32::from(self.regs[0x10] & 15)) * XTAL
            / 268_435_456.0
    }
    fn bandwidth(&self) -> f64 {
        XTAL / (8.0
            * (4.0 + f64::from((self.regs[0x10] >> 4) & 3))
            * 2f64.powi(i32::from(self.regs[0x10] >> 6)))
    }
    fn frequency(&self) -> u64 {
        let word = (u32::from(self.regs[0x0d]) << 16)
            | (u32::from(self.regs[0x0e]) << 8)
            | u32::from(self.regs[0x0f]);
        let channel = XTAL / 262144.0
            * (256.0 + f64::from(self.regs[0x14]))
            * 2f64.powi(i32::from(self.regs[0x13] & 3))
            * f64::from(self.regs[0x0a]);
        (f64::from(word) * XTAL / 65536.0 + channel).round() as u64
    }
    fn modulation(&self) -> &'static str {
        match (self.regs[0x12] >> 4) & 7 {
            0 => "2-FSK",
            1 => "GFSK",
            3 => "ASK-OOK",
            4 => "4-FSK",
            7 => "MSK",
            _ => "reserved",
        }
    }
    fn name(&self) -> &'static str {
        match self.marc {
            0 => "SLEEP",
            1 => "IDLE",
            2 => "XOFF",
            5 => "MANCAL",
            8 => "STARTCAL",
            9 => "BWBOOST",
            10 => "FS_LOCK",
            12 => "ENDCAL",
            13 => "RX",
            14 => "RX_END",
            17 => "RXFIFO_OVERFLOW",
            18 => "FSTXON",
            19 => "TX",
            20 => "TX_END",
            22 => "TXFIFO_UNDERFLOW",
            _ => "SETTLING",
        }
    }
    fn status(&self, read: bool) -> u8 {
        let state = match self.marc {
            13..=15 => 1,
            19..=21 => 2,
            18 => 3,
            3..=8 | 12 => 4,
            9..=11 | 16 => 5,
            17 => 6,
            22 => 7,
            _ => 0,
        };
        (state << 4)
            | (if read {
                self.rx.len()
            } else {
                64 - self.tx.len()
            })
            .min(15) as u8
    }
    fn rssi_byte(&self) -> u8 {
        ((self.rssi + 74.0) * 2.0).round().clamp(-128.0, 127.0) as i8 as u8
    }
    fn gdo_value(&self, cfg: u8) -> bool {
        match cfg & 0x3f {
            0 => self.rx.len() >= 4 * (usize::from(self.regs[3] & 15) + 1),
            1 => !self.rx.is_empty(),
            2 => self.tx.len() >= 61 - 4 * usize::from(self.regs[3] & 15),
            3 => self.tx.len() == 64,
            4 => self.rx_overflow,
            5 => self.tx_underflow,
            6 => self.sync,
            7 => self.packet_ready,
            15 => self.crc_ok,
            9 => self.playback.is_none() && self.reception.is_none(),
            10 | 0x2b => !matches!(self.marc, 0 | 2),
            14 => self.marc == 13 && (self.playback.is_some() || self.reception.is_some()),
            _ => false,
        }
    }
    fn update_gdo(&mut self) {
        for (i, name, reg) in [(0, "GDO0", 2), (1, "GDO2", 0)] {
            let cfg = self.regs[reg];
            // Claims reserve against other parts, not MCU output direction.
            // GDO0 is data IN during async TX: never drive it in that mode.
            if cfg & 0x3f == 0x2e
                || (self.asynchronous() && self.marc == 19 && i == 0)
                || cfg & 0x3f == 13
            {
                continue;
            }
            let value = self.gdo_value(cfg) ^ (cfg & 0x40 != 0);
            if self.gdo[i] != Some(value) {
                if let Some(pin) = self.pin(name) {
                    self.outputs.push_back(drive(pin, value, self.now));
                }
                self.gdo[i] = Some(value);
            }
        }
    }
    fn read(&mut self, address: u8, index: usize) -> u8 {
        match address {
            0..=0x2e => self.regs[usize::from(address)],
            0x30 => 0,
            0x31 => 0x14,
            0x32 => 0,
            0x33 => {
                if self.crc_ok {
                    0x80
                } else {
                    0
                }
            }
            0x34 => self.rssi_byte(),
            0x35 => self.marc,
            0x38 => {
                (u8::from(self.crc_ok) << 7)
                    | (u8::from(self.gdo_value(14)) << 6)
                    | (u8::from(self.gdo_value(9)) << 4)
                    | (u8::from(self.sync && self.marc == 13) << 3)
                    | (u8::from(self.gdo_value(self.regs[0])) << 2)
                    | u8::from(self.gdo_value(self.regs[2]))
            }
            0x39 => 0x94,
            0x3a => self.tx.len() as u8 | if self.tx_underflow { 0x80 } else { 0 },
            0x3b => self.rx.len() as u8 | if self.rx_overflow { 0x80 } else { 0 },
            0x3c => self.regs[0x27],
            0x3d => self.regs[0x28],
            0x3e => self.pa[index % 8],
            0x3f => {
                self.packet_ready = false;
                self.rx.pop_front().unwrap_or(0)
            }
            _ => 0,
        }
    }
    fn write(&mut self, address: u8, index: usize, value: u8) {
        match address {
            0..=0x2e => self.regs[usize::from(address)] = value,
            0x3e => self.pa[index % 8] = value,
            0x3f if self.tx.len() < 64 => self.tx.push_back(value),
            _ => {}
        }
    }
    fn capture(&mut self, raw: Vec<i64>) {
        if raw.is_empty() {
            return;
        }
        let preset = if self.modulation() == "ASK-OOK" {
            "FuriHalSubGhzPresetOok650Async"
        } else {
            "FuriHalSubGhzPreset2FSKDev238Async"
        };
        let signal = Signal {
            frequency: self.frequency(),
            preset: preset.into(),
            raw,
        };
        if self.captures.len() == 16 {
            self.captures.pop_front();
        }
        self.captures.push_back(signal.text());
        self.tx_count = self.tx_count.wrapping_add(1);
    }
    fn finish_async(&mut self) {
        if self.now > self.async_edge {
            pulse(
                &mut self.async_raw,
                self.async_level,
                ((self.now - self.async_edge) / 1000).min(10_000_000) as i64,
            );
        }
        let raw = std::mem::take(&mut self.async_raw);
        self.capture(raw);
    }
    fn reset(&mut self) {
        self.regs = RESET;
        self.pa = [0; 8];
        self.rx.clear();
        self.tx.clear();
        self.rx_overflow = false;
        self.tx_underflow = false;
        self.crc_ok = false;
        self.packet_ready = false;
        self.sync = false;
        self.marc = 1;
        self.transition = None;
        self.sleeping = None;
        self.playback = None;
        self.reception = None;
        self.async_raw.clear();
        self.outputs.clear();
        self.gdo = [None; 2];
    }
    fn enter(&mut self, target: u8) {
        self.transition = None;
        if self.regs[0x18] & 0x30 == 0x10 && self.marc == 1 {
            self.marc = 8;
            self.transition = Some((self.now + 800_000, target));
        } else {
            self.marc = target;
            self.started(target);
        }
    }
    fn started(&mut self, target: u8) {
        if target == 19 {
            if self.asynchronous() {
                self.async_raw.clear();
                self.async_edge = self.now;
                self.async_level = self.high("GDO0", self.levels);
            } else {
                self.packet_tx();
            }
        }
    }
    fn strobe(&mut self, byte: u8) {
        if self.marc == 19 && self.asynchronous() && !matches!(byte, 0x35 | 0x3d) {
            self.finish_async();
        }
        match byte {
            0x30 => self.reset(),
            0x31 => self.enter(18),
            0x32 => self.sleeping = Some(2),
            0x33 => {
                self.marc = 5;
                self.transition = Some((self.now + 800_000, 1));
            }
            0x34 | 0x38 => {
                self.crc_ok = false;
                self.packet_ready = false;
                self.sync = false;
                self.enter(13);
            }
            0x35 if self.marc != 19 => self.enter(19),
            0x36 => {
                self.marc = 1;
                self.transition = None;
                self.sync = false;
                self.playback = None;
                self.reception = None;
            }
            0x39 => self.sleeping = Some(0),
            0x3a if matches!(self.marc, 1 | 17) => {
                self.rx.clear();
                self.rx_overflow = false;
                self.marc = 1;
            }
            0x3b if matches!(self.marc, 1 | 22) => {
                self.tx.clear();
                self.tx_underflow = false;
                self.marc = 1;
            }
            _ => {}
        }
        self.update_gdo();
    }
    fn clock(&mut self, byte: u8) -> u8 {
        if matches!(self.marc, 0 | 2) {
            self.marc = 1;
        }
        let Some(mut a) = self.access else {
            let address = byte & 0x3f;
            let read = byte & 0x80 != 0;
            let status = self.status(read);
            if (0x30..=0x3d).contains(&address) && byte & 0x40 == 0 {
                self.strobe(address);
            } else {
                self.access = Some(Access {
                    address,
                    read,
                    burst: byte & 0x40 != 0,
                    index: 0,
                });
            }
            return status;
        };
        let result = if a.read {
            self.read(a.address, a.index)
        } else {
            let status = self.status(false);
            self.write(a.address, a.index, byte);
            status
        };
        a.index += 1;
        if a.burst && a.address < 0x2f {
            a.address += 1;
        }
        self.access = if a.burst && !(0x30..=0x3d).contains(&a.address) {
            Some(a)
        } else {
            None
        };
        self.update_gdo();
        result
    }
    fn bits(bytes: &[u8]) -> Vec<bool> {
        bytes
            .iter()
            .flat_map(|b| (0..8).rev().map(move |i| b & (1 << i) != 0))
            .collect()
    }
    fn crc(bytes: &[u8]) -> [u8; 2] {
        let mut crc = 0xffffu16;
        for byte in bytes {
            crc ^= u16::from(*byte) << 8;
            for _ in 0..8 {
                crc = if crc & 0x8000 != 0 {
                    (crc << 1) ^ 0x8005
                } else {
                    crc << 1
                };
            }
        }
        crc.to_be_bytes()
    }
    fn whiten(bytes: &mut [u8]) {
        let mut lfsr = 0x1ffu16;
        for byte in bytes {
            let mut mask = 0;
            for bit in 0..8 {
                mask |= ((lfsr & 1) as u8) << bit;
                let feedback = (lfsr ^ (lfsr >> 5)) & 1;
                lfsr = (lfsr >> 1) | (feedback << 8);
            }
            *byte ^= mask;
        }
    }
    fn after_packet(&self, tx: bool) -> u8 {
        match if tx {
            self.regs[0x17] & 3
        } else {
            (self.regs[0x17] >> 2) & 3
        } {
            0 => 1,
            1 => 18,
            2 => 19,
            _ => 13,
        }
    }
    fn packet_tx(&mut self) {
        let needed = match self.regs[8] & 3 {
            1 => self.tx.front().map_or(1, |b| usize::from(*b) + 1),
            2 => self.tx.len(),
            _ => usize::from(self.regs[6]),
        };
        if needed > self.tx.len() || needed == 0 {
            self.tx_underflow = true;
            self.marc = 22;
            self.sync = false;
            return;
        }
        let mut data: Vec<u8> = self.tx.drain(..needed).collect();
        if self.regs[8] & 4 != 0 {
            data.extend(Self::crc(&data));
        }
        if self.regs[8] & 0x40 != 0 {
            Self::whiten(&mut data);
        }
        let preamble = [2, 3, 4, 6, 8, 12, 16, 24][usize::from((self.regs[0x13] >> 4) & 7)];
        let mut bytes = vec![0xaa; preamble];
        let sync_mode = self.regs[0x12] & 7;
        if !matches!(sync_mode, 0 | 4) {
            bytes.extend([self.regs[4], self.regs[5]]);
            if sync_mode & 3 == 3 {
                bytes.extend([self.regs[4], self.regs[5]]);
            }
        }
        bytes.extend(data);
        let mut bits = Self::bits(&bytes);
        if self.regs[0x12] & 8 != 0 {
            bits = bits.iter().flat_map(|b| [!*b, *b]).collect();
        }
        let mut raw = Vec::new();
        let bit_us = 1_000_000.0 / self.rate();
        for (i, bit) in bits.iter().enumerate() {
            pulse(
                &mut raw,
                *bit,
                (((i + 1) as f64 * bit_us).round() - (i as f64 * bit_us).round()) as i64,
            );
        }
        self.capture(raw);
        self.sync = true;
        self.transition = Some((
            self.now + (bits.len() as f64 * bit_us * 1000.0) as u64,
            self.after_packet(true),
        ));
    }
    fn matches_frequency(&self, signal: &Signal) -> bool {
        self.frequency().abs_diff(signal.frequency) <= (self.bandwidth() / 2.0).max(10_000.0) as u64
    }
    fn decode_packet(&mut self, signal: &Signal) -> Option<Reception> {
        let bit_us = 1_000_000.0 / self.rate();
        let mut bits = Vec::new();
        for duration in &signal.raw {
            let count = (duration.unsigned_abs() as f64 / bit_us).round() as usize;
            if bits.len().saturating_add(count) > 1_048_576 {
                self.last_error = "RAW bit stream too long".into();
                return None;
            }
            bits.extend(std::iter::repeat_n(*duration > 0, count));
        }
        if self.regs[0x12] & 8 != 0 {
            let mut decoded = Vec::new();
            for pair in bits.as_chunks::<2>().0 {
                if pair[0] == pair[1] {
                    return None;
                }
                decoded.push(pair[1]);
            }
            bits = decoded;
        }
        let sync_mode = self.regs[0x12] & 7;
        let start = if matches!(sync_mode, 0 | 4) {
            0
        } else {
            let mut sync = Self::bits(&[self.regs[4], self.regs[5]]);
            if sync_mode & 3 == 3 {
                sync.extend(Self::bits(&[self.regs[4], self.regs[5]]));
            }
            let tolerance = if sync_mode & 3 == 1 {
                1
            } else if sync_mode & 3 == 3 {
                2
            } else {
                0
            };
            bits.windows(sync.len())
                .position(|w| w.iter().zip(&sync).filter(|(a, b)| a != b).count() <= tolerance)?
                + sync.len()
        };
        let mut bytes: Vec<u8> = bits[start..]
            .as_chunks::<8>()
            .0
            .iter()
            .map(|b| b.iter().fold(0, |v, bit| (v << 1) | u8::from(*bit)))
            .collect();
        if self.regs[8] & 0x40 != 0 {
            Self::whiten(&mut bytes);
        }
        let variable = self.regs[8] & 3 == 1;
        let needed = if variable {
            let length = usize::from(*bytes.first()?);
            if length > usize::from(self.regs[6]) {
                self.last_rx = "Rejected: packet length".into();
                return None;
            }
            length + 1
        } else if self.regs[8] & 3 == 2 {
            bytes.len()
        } else {
            usize::from(self.regs[6])
        };
        if bytes.len() < needed {
            return None;
        }
        let check = self.regs[7] & 3;
        if check != 0 {
            let addr = *bytes.get(usize::from(variable))?;
            if addr != self.regs[9] && !(check >= 2 && addr == 0) && !(check == 3 && addr == 255) {
                self.last_rx = "Rejected: address".into();
                return None;
            }
        }
        let crc_ok = self.regs[8] & 4 == 0
            || bytes
                .get(needed..needed + 2)
                .is_some_and(|crc| crc == Self::crc(&bytes[..needed]));
        if !crc_ok && self.regs[7] & 8 != 0 {
            self.last_rx = "Rejected: CRC".into();
            return None;
        }
        bytes.truncate(needed);
        if self.regs[7] & 4 != 0 {
            bytes.extend([self.rssi_byte(), if crc_ok { 0x80 } else { 0 }]);
        }
        let duration: u64 = signal.raw.iter().map(|p| p.unsigned_abs() * 1000).sum();
        Some(Reception {
            bytes,
            crc_ok,
            end: self.now + duration,
        })
    }
    fn advance(&mut self, now: u64) {
        self.now = now;
        if let Some((at, target)) = self.transition {
            if now >= at {
                let calibrating = matches!(self.marc, 3..=12);
                self.transition = None;
                self.marc = target;
                self.sync = false;
                if target == 19 && (calibrating || self.asynchronous()) {
                    self.started(target);
                } else if target == 19 && !self.tx.is_empty() {
                    self.packet_tx();
                }
            }
        }
        if self.reception.as_ref().is_some_and(|r| now >= r.end) {
            let r = self.reception.take().unwrap();
            self.crc_ok = r.crc_ok;
            self.packet_ready = r.crc_ok;
            self.sync = false;
            self.last_rx = format!(
                "{} bytes at {} Hz, CRC {}",
                r.bytes.len(),
                self.frequency(),
                if r.crc_ok { "OK" } else { "failed" }
            );
            for b in r.bytes {
                if self.rx.len() == 64 {
                    self.rx_overflow = true;
                    self.marc = 17;
                    break;
                }
                self.rx.push_back(b);
            }
            if !self.rx_overflow {
                self.marc = self.after_packet(false);
            }
        }
        if self.marc == 13 && self.playback.is_none() && self.reception.is_none() {
            if let Some(i) = self.air.iter().position(|s| self.matches_frequency(s)) {
                let signal = self.air.remove(i).unwrap();
                if self.asynchronous() {
                    self.last_rx = format!(
                        "Async: {} pulses at {} Hz",
                        signal.raw.len(),
                        signal.frequency
                    );
                    self.playback = Some(Playback {
                        signal,
                        index: 0,
                        at: now,
                        scheduled: VecDeque::new(),
                    });
                } else if let Some(r) = self.decode_packet(&signal) {
                    self.sync = true;
                    self.reception = Some(r);
                } else if self.last_rx.is_empty() {
                    self.last_rx = "Rejected: no matching sync/complete packet".into();
                }
            }
        }
        self.update_gdo();
    }
}
impl Device for Cc1101 {
    const NAME: &'static str = "cc1101";
    const ON_BUS: bool = true;
    fn configure(&mut self, config: &PartConfig) {
        self.pins = config
            .pins
            .iter()
            .filter(|(_, p)| **p < 64)
            .map(|(n, p)| (n.clone(), *p))
            .collect();
    }
    fn claims(&self) -> Vec<Claim> {
        let mask = |names: &[&str]| {
            names
                .iter()
                .filter_map(|n| self.pin(n))
                .fold(0, |m, p| m | (1 << p))
        };
        vec![
            Claim {
                what: Some(claim::What::Spi(SpiClaim {
                    cs_pin: self.pin("CS"),
                    clk_pin: self.pin("SCK"),
                    mosi_pin: self.pin("MOSI"),
                    miso_pin: self.pin("MISO"),
                    cs_active_high: Some(false),
                    ..Default::default()
                })),
            },
            watches(mask(&["CS", "GDO0", "GDO2", "SW0", "SW1"])),
            drives(mask(&["GDO0", "GDO2"])),
        ]
    }
    fn on_pins(&mut self, levels: u64, now_ns: u64) {
        self.advance(now_ns);
        if self.high("CS", levels) && !self.high("CS", self.levels) {
            self.access = None;
            if let Some(state) = self.sleeping.take() {
                self.marc = state;
            }
        }
        if !self.high("CS", levels) && self.high("CS", self.levels) && matches!(self.marc, 0 | 2) {
            self.marc = 1;
        }
        if self.marc == 19 && self.asynchronous() {
            let level = self.high("GDO0", levels);
            if level != self.async_level {
                pulse(
                    &mut self.async_raw,
                    self.async_level,
                    ((now_ns.saturating_sub(self.async_edge)) / 1000).min(10_000_000) as i64,
                );
                self.async_edge = now_ns;
                self.async_level = level;
            }
        }
        self.levels = levels;
    }
    fn on_bus(&mut self, request: &BusRequest) -> Option<BusReply> {
        let Some(bus_request::Op::Spi(spi)) = &request.op else {
            return None;
        };
        for phase in [&spi.cmd, &spi.addr].into_iter().flatten() {
            for byte in &phase.data {
                self.clock(*byte);
            }
        }
        let mut data = Vec::new();
        for i in 0..spi.tx.len().max(spi.rx_len as usize) {
            let result = self.clock(spi.tx.get(i).copied().unwrap_or(0));
            if i < spi.rx_len as usize {
                data.push(result);
            }
        }
        (spi.rx_len > 0).then_some(BusReply {
            correlation_id: request.correlation_id,
            ack: true,
            data,
            op: BusOp::Spi as i32,
        })
    }
    fn poll(&mut self, now_ns: u64) -> Option<EmulatorMessage> {
        self.advance(now_ns);
        if let Some(message) = self.outputs.pop_front() {
            return Some(message);
        }
        let mut p = self.playback.take()?;
        // Heartbeats are 1ms apart and part-driven GPIO edges are not echoed.
        // Keep 5ms lookahead, capped at 32 timestamps (64 pin edges), so short
        // pulses remain exact without filling the emulator's scheduled queue.
        while p.scheduled.front().is_some_and(|at| *at <= now_ns) {
            p.scheduled.pop_front();
        }
        if p.index > p.signal.raw.len() {
            if now_ns < p.at {
                self.playback = Some(p);
            }
            return None;
        }
        if p.at > now_ns.saturating_add(5_000_000) || p.scheduled.len() >= 32 {
            self.playback = Some(p);
            return None;
        }
        let next = p.signal.raw.get(p.index).copied();
        let level = next.is_some_and(|d| d > 0);
        for (i, name, reg) in [(0, "GDO0", 2), (1, "GDO2", 0)] {
            if self.regs[reg] & 0x3f == 13 {
                let value = level ^ (self.regs[reg] & 0x40 != 0);
                if let Some(pin) = self.pin(name) {
                    self.outputs.push_back(drive(pin, value, p.at));
                    self.gdo[i] = Some(value);
                }
            }
        }
        p.scheduled.push_back(p.at);
        p.index += 1;
        if let Some(duration) = next {
            p.at += duration.unsigned_abs() * 1000;
        }
        self.playback = Some(p);
        self.outputs.pop_front()
    }
    fn on_input(&mut self, name: &str) {
        if let Some(text) = name.strip_prefix("load-sub:") {
            match Signal::parse(text) {
                Ok(s) if self.air.len() < 32 => {
                    self.air.push_back(s);
                    self.last_error.clear();
                }
                Ok(_) => self.last_error = "Air queue full (32 signals)".into(),
                Err(e) => self.last_error = e,
            }
        } else if name == "air-clear" {
            self.air.clear();
            self.playback = None;
            self.reception = None;
            self.sync = false;
        } else if let Some(("rssi", value)) = set_value(name) {
            self.rssi = value.clamp(-138.0, -10.5);
        }
    }
    fn state(&self) -> Option<State> {
        let band = match (self.high("SW1", self.levels), self.high("SW0", self.levels)) {
            (true, false) => "315",
            (true, true) => "433",
            (false, true) => "868-915",
            _ => "?",
        };
        Some(
            State::new()
                .set("chip_state", self.name())
                .set("freq_hz", self.frequency())
                .set("modulation", self.modulation())
                .set("data_rate", format!("{:.3}", self.rate()))
                .set("bandwidth_khz", format!("{:.3}", self.bandwidth() / 1000.0))
                .set(
                    "mode",
                    if self.asynchronous() {
                        "async"
                    } else {
                        "packet"
                    },
                )
                .set("band_switch", band)
                .set("rx_pending", self.air.len())
                .set("tx_count", self.tx_count)
                .set(
                    "last_tx",
                    self.captures.back().map(String::as_str).unwrap_or(""),
                )
                .set("last_rx", &self.last_rx)
                .set("last_error", &self.last_error),
        )
    }
}
esp_part::export_part!(Cc1101, buffer = 262144);
/// Retained captures, oldest-first indices; state tx_count is lifetime count.
#[no_mangle]
pub extern "C" fn ebl_tx_count() -> u32 {
    __ESP_PART.with(|p| p.device.captures.len() as u32)
}
#[no_mangle]
pub extern "C" fn ebl_tx_ptr(i: u32) -> u32 {
    __ESP_PART.with(|p| {
        p.device
            .captures
            .get(i as usize)
            .map_or(0, |s| s.as_ptr() as u32)
    })
}
#[no_mangle]
pub extern "C" fn ebl_tx_len(i: u32) -> u32 {
    __ESP_PART.with(|p| {
        p.device
            .captures
            .get(i as usize)
            .map_or(0, |s| s.len() as u32)
    })
}
