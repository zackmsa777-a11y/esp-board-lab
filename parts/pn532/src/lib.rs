//! PN532 V1.6 I2C initiator and virtual ISO14443A tags.
//! SPDX-License-Identifier: MIT OR Apache-2.0
mod tag;
use esp_part::prelude::*;
use std::collections::{BTreeMap, VecDeque};
use tag::Tag;

const ACK: &[u8] = &[0, 0, 255, 0, 255, 0];
const NACK: &[u8] = &[0, 0, 255, 255, 0, 0];
const ERROR: &[u8] = &[0, 0, 255, 1, 255, 127, 129, 0];
fn checksum(bytes: &[u8]) -> u8 {
    0u8.wrapping_sub(bytes.iter().fold(0u8, |a, b| a.wrapping_add(*b)))
}
fn encode(data: &[u8]) -> Vec<u8> {
    let mut out = vec![0, 0, 255];
    if data.len() < 255 {
        let len = data.len() as u8;
        out.extend([len, 0u8.wrapping_sub(len)]);
    } else {
        let len = (data.len() as u16).to_be_bytes();
        out.extend([255, 255, len[0], len[1], checksum(&len)]);
    }
    out.extend(data);
    out.extend([checksum(data), 0]);
    out
}
fn decode(frame: &[u8]) -> Result<&[u8], &'static str> {
    let start = frame
        .windows(3)
        .position(|v| v == [0, 0, 255])
        .ok_or("missing start code")?;
    let f = &frame[start..];
    if f.len() < 7 {
        return Err("short frame");
    }
    let (offset, len) = if f[3..5] == [255, 255] {
        if f.len() < 10 || f[5].wrapping_add(f[6]).wrapping_add(f[7]) != 0 {
            return Err("extended LCS");
        }
        (8, usize::from(u16::from_be_bytes([f[5], f[6]])))
    } else {
        if f[3].wrapping_add(f[4]) != 0 {
            return Err("LCS");
        }
        (5, usize::from(f[3]))
    };
    if len == 0 || f.len() < offset + len + 2 {
        return Err("invalid frame length");
    }
    let data = &f[offset..offset + len];
    if checksum(data) != f[offset + len] || f[offset + len + 1] != 0 {
        return Err("DCS/postamble");
    }
    Ok(data)
}
struct Pn532 {
    scl: Option<u32>,
    sda: Option<u32>,
    irq: Option<u32>,
    rst: Option<u32>,
    addr: u32,
    reset: bool,
    irq_reported: Option<bool>,
    queue: VecDeque<Vec<u8>>,
    offset: usize,
    last_frame: Vec<u8>,
    registers: BTreeMap<u16, u8>,
    sam: bool,
    field: bool,
    parameters: u8,
    powered_down: bool,
    tag: Option<Tag>,
    present: bool,
    selected: bool,
    authenticated: Option<usize>,
    compatibility_page: Option<usize>,
    reads: u64,
    writes: u64,
    auths_ok: u64,
    auths_failed: u64,
    last_command: &'static str,
    last_error: String,
    dump: String,
}
impl Default for Pn532 {
    fn default() -> Self {
        Self {
            scl: None,
            sda: None,
            irq: None,
            rst: None,
            addr: 0x24,
            reset: false,
            irq_reported: None,
            queue: VecDeque::new(),
            offset: 0,
            last_frame: Vec::new(),
            registers: BTreeMap::new(),
            sam: false,
            field: false,
            parameters: 0x14,
            powered_down: false,
            tag: None,
            present: false,
            selected: false,
            authenticated: None,
            compatibility_page: None,
            reads: 0,
            writes: 0,
            auths_ok: 0,
            auths_failed: 0,
            last_command: "none",
            last_error: String::new(),
            dump: String::new(),
        }
    }
}
impl Pn532 {
    fn refresh_dump(&mut self) {
        self.dump = self.tag.as_ref().map(Tag::dump).unwrap_or_default();
    }
    fn deactivate(&mut self) {
        self.selected = false;
        self.authenticated = None;
        self.compatibility_page = None;
    }
    fn host_write(&mut self, bytes: &[u8]) {
        if bytes == ACK {
            self.queue.clear();
            self.offset = 0;
            return;
        }
        if bytes == NACK {
            if !self.last_frame.is_empty() {
                self.queue.clear();
                self.queue.push_back(self.last_frame.clone());
                self.offset = 0;
            }
            return;
        }
        self.queue.clear();
        self.offset = 0;
        match decode(bytes) {
            Ok(data) if (2..=264).contains(&data.len()) && data[0] == 0xd4 => {
                self.powered_down = false;
                self.last_error.clear();
                let response = self.command(data[1], &data[2..]);
                self.queue.push_back(ACK.to_vec());
                self.queue.push_back(response);
            }
            Ok(_) => {
                self.last_error = "invalid TFI/command".into();
                self.queue.push_back(ERROR.to_vec());
            }
            Err(error) => {
                self.last_error = error.into();
                self.queue.push_back(NACK.to_vec());
            }
        }
    }
    fn command(&mut self, cmd: u8, args: &[u8]) -> Vec<u8> {
        self.last_command = match cmd {
            0x02 => "GetFirmwareVersion",
            0x06 => "ReadRegister",
            0x08 => "WriteRegister",
            0x12 => "SetParameters",
            0x14 => "SAMConfiguration",
            0x16 => "PowerDown",
            0x32 => "RFConfiguration",
            0x4a => "InListPassiveTarget",
            0x40 => "InDataExchange",
            0x42 => "InCommunicateThru",
            0x52 => "InRelease",
            0x54 => "InSelect",
            0x44 => "InDeselect",
            0x8c => "TgInitAsTarget",
            _ => "unknown",
        };
        let payload = match cmd {
            0x02 => vec![0x32, 1, 6, 7],
            0x06 if !args.is_empty() && args.len().is_multiple_of(2) => args
                .as_chunks::<2>()
                .0
                .iter()
                .map(|a| {
                    *self
                        .registers
                        .get(&u16::from_be_bytes([a[0], a[1]]))
                        .unwrap_or(&0)
                })
                .collect(),
            0x08 if !args.is_empty() && args.len().is_multiple_of(3) => {
                for a in args.as_chunks::<3>().0 {
                    self.registers
                        .insert(u16::from_be_bytes([a[0], a[1]]), a[2]);
                }
                vec![]
            }
            0x12 if args.len() == 1 => {
                self.parameters = args[0];
                vec![]
            }
            0x14 if !args.is_empty() => {
                self.sam = true;
                vec![]
            }
            0x16 if !args.is_empty() => {
                self.powered_down = true;
                self.field = false;
                self.deactivate();
                vec![0]
            }
            0x32 if !args.is_empty() => {
                if args[0] == 1 && args.len() >= 2 {
                    self.field = args[1] & 1 != 0;
                    if !self.field {
                        self.deactivate();
                    }
                }
                vec![]
            }
            0x4a if args.len() >= 2 => {
                self.field = true;
                self.deactivate();
                if let Some(tag) = self
                    .tag
                    .as_ref()
                    .filter(|_| args[0] != 0 && args[1] == 0 && self.present)
                {
                    self.selected = true;
                    // Both current Flipper files and PN532 SENS_RES use MSB first.
                    let mut p = vec![1, 1, tag.atqa[0], tag.atqa[1], tag.sak, tag.uid.len() as u8];
                    p.extend(&tag.uid);
                    p
                } else {
                    vec![0]
                }
            }
            0x40 if !args.is_empty() => {
                if args[0] & 0x3f != 1 {
                    vec![0x27]
                } else {
                    self.exchange(&args[1..])
                }
            }
            0x42 => self.exchange(args),
            0x52 | 0x44 if args.len() == 1 => {
                let status = if args[0] > 1 { 0x27 } else { 0 };
                self.deactivate();
                if cmd == 0x52 {
                    self.field = false;
                }
                vec![status]
            }
            0x54 if args.len() == 1 => {
                self.selected = args[0] == 1 && self.present && self.tag.is_some();
                self.authenticated = None;
                if self.selected {
                    self.field = true;
                    vec![0]
                } else {
                    vec![1]
                }
            }
            0x8c => vec![1],
            _ => {
                self.last_error = format!("unsupported command/arguments 0x{cmd:02X}");
                return ERROR.to_vec();
            }
        };
        let mut data = vec![0xd5, cmd.wrapping_add(1)];
        data.extend(payload);
        encode(&data)
    }
    fn exchange(&mut self, data: &[u8]) -> Vec<u8> {
        if !self.present || !self.selected || !self.field {
            return vec![1];
        }
        let Some(tag) = self.tag.as_mut() else {
            return vec![1];
        };
        if let Some(page) = self.compatibility_page.take() {
            if data.len() != 16 {
                return vec![0x10];
            }
            tag.write(page * 4, &data[..4]);
            self.writes += 1;
            self.refresh_dump();
            return vec![0, 0x0a];
        }
        let Some(&op) = data.first() else {
            return vec![0x10];
        };
        let block = usize::from(data.get(1).copied().unwrap_or(0));
        if tag.is_classic() {
            if data.len() < 2 || block * 16 >= tag.memory.len() {
                return vec![0x10];
            }
            let sector = Tag::sector(block);
            if op == 0x60 || op == 0x61 {
                let key_start = Tag::trailer(block) * 16 + if op == 0x60 { 0 } else { 10 };
                let valid = data.len() == 12
                    && data[8..] == tag.uid[tag.uid.len() - 4..]
                    && tag.memory[key_start..key_start + 6]
                        .iter()
                        .zip(&data[2..8])
                        .all(|(a, b)| *a == Some(*b));
                if valid {
                    self.authenticated = Some(sector);
                    self.auths_ok += 1;
                    return vec![0];
                }
                self.authenticated = None;
                self.auths_failed += 1;
                return vec![0x14];
            }
            if self.authenticated != Some(sector) {
                return vec![0x14];
            }
            match op {
                0x30 if data.len() == 2 => {
                    self.reads += 1;
                    let mut p = vec![0];
                    p.extend(tag.read(block * 16, 16));
                    p
                }
                0xa0 if data.len() == 18 => {
                    tag.write(block * 16, &data[2..]);
                    self.writes += 1;
                    self.refresh_dump();
                    vec![0]
                }
                _ => vec![0x10],
            }
        } else if tag.memory.is_empty() {
            vec![1]
        } else {
            let mut out = vec![0];
            match op {
                0x30 if data.len() == 2 && block * 4 < tag.memory.len() => {
                    for page in block..block + 4 {
                        out.extend(tag.read((page * 4) % tag.memory.len(), 4));
                    }
                    self.reads += 1;
                }
                0xa2 if data.len() == 6 && block >= 2 && block * 4 < tag.memory.len() => {
                    tag.write(block * 4, &data[2..]);
                    self.writes += 1;
                    out.push(0x0a);
                    self.refresh_dump();
                }
                0xa0 if (data.len() == 2 || data.len() == 18)
                    && block >= 2
                    && block * 4 < tag.memory.len() =>
                {
                    if data.len() == 18 {
                        tag.write(block * 4, &data[2..6]);
                        self.writes += 1;
                        self.refresh_dump();
                    } else {
                        self.compatibility_page = Some(block);
                    }
                    out.push(0x0a);
                }
                0x60 if data.len() == 1 && tag.version().is_some() => {
                    out.extend(tag.version().unwrap())
                }
                0x3c if data == [0x3c, 0] => out.extend(tag.signature),
                0x3a if data.len() == 3
                    && block <= usize::from(data[2])
                    && usize::from(data[2]) * 4 < tag.memory.len() =>
                {
                    out.extend(tag.read(block * 4, (usize::from(data[2]) - block + 1) * 4));
                    self.reads += 1;
                }
                0x1b if data.len() == 5 => {
                    let n = tag.memory.len();
                    out.extend(tag.read(n.saturating_sub(4), 2));
                }
                _ => return vec![0x10],
            }
            out
        }
    }
    fn host_read(&mut self, count: usize, continues: bool) -> Vec<u8> {
        if count == 0 {
            return vec![];
        }
        let mut out = vec![0; count];
        if let Some(frame) = self.queue.front() {
            // The ESP I2C peripheral can split one physical read into ABI
            // pieces (ACK bytes then the final NACK byte). RDY is sent once
            // per physical read, never again on a `continues` piece.
            let prefix = usize::from(!continues);
            if prefix != 0 {
                out[0] = 1;
            }
            let n = (count - prefix).min(frame.len() - self.offset);
            out[prefix..n + prefix].copy_from_slice(&frame[self.offset..self.offset + n]);
            self.offset += n;
            if self.offset == frame.len() {
                self.last_frame = self.queue.pop_front().unwrap();
                self.offset = 0;
            }
        }
        out
    }
}
impl Device for Pn532 {
    const NAME: &'static str = "pn532";
    const ON_BUS: bool = true;
    fn configure(&mut self, c: &PartConfig) {
        self.scl = c.pins.get("SCL").copied();
        self.sda = c.pins.get("SDA").copied();
        self.irq = c.pins.get("IRQ").copied();
        self.rst = c.pins.get("RST").copied();
        self.addr = if c.addr == 0 { 0x24 } else { c.addr };
    }
    fn claims(&self) -> Vec<Claim> {
        let mut c = vec![Claim {
            what: Some(claim::What::I2c(I2cClaim {
                addr: self.addr,
                scl_pin: self.scl,
                sda_pin: self.sda,
            })),
        }];
        if let Some(p) = self.irq {
            c.push(drives(1 << p));
        }
        if let Some(p) = self.rst {
            c.push(watches(1 << p));
        }
        c
    }
    fn on_pins(&mut self, levels: u64, _: u64) {
        let reset = self.rst.is_some_and(|p| levels & (1 << p) == 0);
        if reset && !self.reset {
            self.queue.clear();
            self.offset = 0;
            self.last_frame.clear();
            self.sam = false;
            self.field = false;
            self.powered_down = false;
            self.parameters = 0x14;
            self.registers.clear();
            self.deactivate();
        }
        self.reset = reset;
    }
    fn poll(&mut self, now: u64) -> Option<EmulatorMessage> {
        let high = self.queue.is_empty() || self.reset;
        if self.irq_reported == Some(high) {
            return None;
        }
        self.irq_reported = Some(high);
        Some(drive(self.irq?, high, now))
    }
    fn on_bus(&mut self, request: &BusRequest) -> Option<BusReply> {
        let mut r = BusReply {
            correlation_id: request.correlation_id,
            op: BusOp::I2c as i32,
            ..Default::default()
        };
        if let Some(bus_request::Op::I2c(tx)) = &request.op {
            if tx.addr == self.addr && !self.reset {
                r.ack = true;
                if !tx.write.is_empty() {
                    self.host_write(&tx.write);
                }
                r.data = self.host_read(tx.read_len.min(65536) as usize, tx.continues);
            }
        }
        Some(r)
    }
    fn on_input(&mut self, input: &str) {
        if let Some(text) = input.strip_prefix("load-nfc:") {
            match Tag::parse(text) {
                Ok(tag) => {
                    self.tag = Some(tag);
                    self.present = true;
                    self.last_error.clear();
                    self.deactivate();
                    self.refresh_dump();
                }
                Err(e) => self.last_error = e,
            }
        } else {
            match input {
                "tag-present:1" => self.present = self.tag.is_some(),
                "tag-present:0" => {
                    self.present = false;
                    self.deactivate();
                }
                "tag-clear" => {
                    self.tag = None;
                    self.present = false;
                    self.deactivate();
                    self.refresh_dump();
                }
                _ => {}
            }
        }
    }
    fn state(&self) -> Option<State> {
        Some(
            State::new()
                .set("firmware", "PN532 v1.6")
                .set("sam_configured", self.sam)
                .set("field", if self.field { "on" } else { "off" })
                .set(
                    "tag",
                    self.tag
                        .as_ref()
                        .filter(|_| self.present)
                        .map(|t| format!("{} {}", t.kind, tag::hex(&t.uid)))
                        .unwrap_or_else(|| "none".into()),
                )
                .set("last_command", self.last_command)
                .set("reads", self.reads)
                .set("writes", self.writes)
                .set("auths_ok", self.auths_ok)
                .set("auths_failed", self.auths_failed)
                .set("last_error", &self.last_error),
        )
    }
}
esp_part::export_part!(Pn532, buffer = 65536);
/// Pointer remains valid until the next input or tag write. Read ptr/len together.
#[no_mangle]
pub extern "C" fn ebl_dump_ptr() -> u32 {
    __ESP_PART.with(|p| p.device.dump.as_ptr() as u32)
}
#[no_mangle]
pub extern "C" fn ebl_dump_len() -> u32 {
    __ESP_PART.with(|p| p.device.dump.len() as u32)
}
#[cfg(test)]
mod tests;
