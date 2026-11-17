//! Original IR codecs from published wire formats, not remote-control library code.
//! SPDX-License-Identifier: MIT OR Apache-2.0
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Message {
    pub protocol: String,
    pub address: u32,
    pub command: u32,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Signal {
    pub name: String,
    pub frequency: u32,
    pub duty_cycle: f32,
    /// Alternating mark/space microseconds, beginning with a mark.
    pub data: Vec<u32>,
    pub parsed: Option<Message>,
}
fn limits(protocol: &str) -> Option<(u32, u32, u32)> {
    Some(match protocol {
        "NEC" => (0xff, 0xff, 38_000),
        // Flipper NECext exposes both transmitted 16-bit fields verbatim.
        "NECext" => (0xffff, 0xffff, 38_000),
        "Samsung32" => (0xff, 0xff, 38_000),
        "RC5" => (0x1f, 0x7f, 36_000),
        "RC6" => (0xff, 0xff, 36_000),
        "SIRC" => (0x1f, 0x7f, 40_000),
        "SIRC15" => (0xff, 0x7f, 40_000),
        "SIRC20" => (0x1fff, 0x7f, 40_000),
        "Kaseikyo" => (0x03ff_ffff, 0x3ff, 37_000),
        _ => return None,
    })
}
fn pulse_distance(data: &mut Vec<u32>, value: u64, count: usize, unit: u32) {
    for bit in 0..count {
        data.extend([unit, unit * if value & (1 << bit) == 0 { 1 } else { 3 }]);
    }
    data.push(unit);
}
fn run(runs: &mut Vec<(bool, u32)>, mark: bool, duration: u32) {
    if let Some((last, length)) = runs.last_mut() {
        if *last == mark {
            *length += duration;
            return;
        }
    }
    runs.push((mark, duration));
}
fn manchester(runs: &mut Vec<(bool, u32)>, bit: bool, unit: u32, one_mark_first: bool) {
    let first = bit == one_mark_first;
    run(runs, first, unit);
    run(runs, !first, unit);
}
fn timings(mut runs: Vec<(bool, u32)>) -> Vec<u32> {
    if runs.first().is_some_and(|r| !r.0) {
        runs.remove(0);
    }
    if runs.last().is_some_and(|r| !r.0) {
        runs.pop();
    }
    runs.into_iter().map(|r| r.1).collect()
}
pub fn encode(message: &Message) -> Result<Signal, String> {
    let (max_a, max_c, frequency) = limits(&message.protocol).ok_or("unsupported IR protocol")?;
    let (a, c) = (message.address, message.command);
    if a > max_a || c > max_c {
        return Err("address/command exceeds protocol width".into());
    }
    let mut data = Vec::new();
    match message.protocol.as_str() {
        "NEC" | "NECext" | "Samsung32" => {
            let samsung = message.protocol == "Samsung32";
            data.extend([if samsung { 4500 } else { 9000 }, 4500]);
            let word = if message.protocol == "NECext" {
                a | (c << 16)
            } else {
                a | (if samsung { a } else { a ^ 255 } << 8) | (c << 16) | ((c ^ 255) << 24)
            };
            // Half-microsecond NEC units rounded only at the event boundary.
            pulse_distance(&mut data, u64::from(word), 32, 563);
            for (i, t) in data.iter_mut().enumerate().skip(2) {
                *t = if i % 2 == 0 || *t == 563 { 563 } else { 1688 };
            }
        }
        "SIRC" | "SIRC15" | "SIRC20" => {
            data.extend([2400, 600]);
            let bits = match message.protocol.as_str() {
                "SIRC" => 12,
                "SIRC15" => 15,
                _ => 20,
            };
            // SIRC20's extension occupies bits 12..19; the file packs it above the five address bits.
            let value = c | (a << 7);
            for i in 0..bits {
                data.push(if value & (1 << i) == 0 { 600 } else { 1200 });
                if i + 1 < bits {
                    data.push(600);
                }
            }
        }
        "RC5" => {
            let word = (1 << 13) | (u32::from(c & 64 == 0) << 12) | (a << 6) | (c & 63);
            let mut runs = Vec::new();
            for bit in (0..14).rev() {
                manchester(&mut runs, word & (1 << bit) != 0, 889, false);
            }
            data = timings(runs);
        }
        "RC6" => {
            let mut runs = vec![(true, 2664), (false, 888)];
            for bit in [true, false, false, false] {
                manchester(&mut runs, bit, 444, true);
            }
            manchester(&mut runs, false, 888, true); // mode-0 double-width toggle
            let word = (a << 8) | c;
            for bit in (0..16).rev() {
                manchester(&mut runs, word & (1 << bit) != 0, 444, true);
            }
            data = timings(runs);
        }
        "Kaseikyo" => {
            let vendor = a & 0xffff;
            let parity = (vendor ^ (vendor >> 4) ^ (vendor >> 8) ^ (vendor >> 12)) & 15;
            let payload = parity | (((a >> 16) & 255) << 4) | (c << 12) | (((a >> 24) & 3) << 22);
            let check = (payload ^ (payload >> 8) ^ (payload >> 16)) & 255;
            let word = u64::from(vendor) | (u64::from(payload) << 16) | (u64::from(check) << 40);
            data.extend([3456, 1728]);
            pulse_distance(&mut data, word, 48, 432);
        }
        _ => unreachable!(),
    }
    Ok(Signal {
        name: "signal".into(),
        frequency,
        duty_cycle: 0.33,
        data,
        parsed: Some(message.clone()),
    })
}
fn near(actual: u32, ideal: u32) -> bool {
    actual.abs_diff(ideal) <= ideal / 4 + 60
}
fn distance(data: &[u32], bits: usize, unit: u32) -> Option<u64> {
    if data.len() != bits * 2 + 3 || !near(data[bits * 2 + 2], unit) {
        return None;
    }
    let mut value = 0;
    for (i, pair) in data[2..bits * 2 + 2].as_chunks::<2>().0.iter().enumerate() {
        if !near(pair[0], unit) {
            return None;
        }
        if near(pair[1], unit * 3) {
            value |= 1 << i;
        } else if !near(pair[1], unit) {
            return None;
        }
    }
    Some(value)
}
fn halves(data: &[u32], unit: u32) -> Option<Vec<bool>> {
    let mut out = Vec::new();
    for (i, &duration) in data.iter().enumerate() {
        let n = (duration + unit / 2) / unit;
        if !(1..=4).contains(&n) || !near(duration, n * unit) {
            return None;
        }
        out.extend(std::iter::repeat_n(i % 2 == 0, n as usize));
    }
    Some(out)
}
fn bit(halves: &[bool], cursor: &mut usize, width: usize, mark_first: bool) -> Option<bool> {
    let slice = halves.get(*cursor..*cursor + 2 * width)?;
    if !slice[..width].iter().all(|h| *h == slice[0])
        || !slice[width..].iter().all(|h| *h != slice[0])
    {
        return None;
    }
    *cursor += 2 * width;
    Some(slice[0] == mark_first)
}
pub fn decode(data: &[u32]) -> Option<Message> {
    let (&leader, tail) = data.split_first()?;
    let &space = tail.first()?;
    let result = |protocol: &str, address, command| {
        Some(Message {
            protocol: protocol.into(),
            address,
            command,
        })
    };
    if (near(leader, 9000) || near(leader, 4500)) && near(space, 4500) {
        let value = distance(data, 32, 563)? as u32;
        let b = value.to_le_bytes();
        if near(leader, 4500) {
            return (b[0] == b[1] && b[2] == !b[3]).then(|| Message {
                protocol: "Samsung32".into(),
                address: u32::from(b[0]),
                command: u32::from(b[2]),
            });
        }
        if b[0] == !b[1] && b[2] == !b[3] {
            return result("NEC", u32::from(b[0]), u32::from(b[2]));
        }
        return result("NECext", value & 65535, value >> 16);
    }
    if near(leader, 3456) && near(space, 1728) && data.len() == 99 {
        let word = distance(data, 48, 432)?;
        let vendor = word as u32 & 65535;
        let payload = (word >> 16) as u32 & 0xff_ffff;
        let parity = (vendor ^ (vendor >> 4) ^ (vendor >> 8) ^ (vendor >> 12)) & 15;
        if payload & 15 != parity
            || (payload ^ (payload >> 8) ^ (payload >> 16)) & 255 != (word >> 40) as u32
        {
            return None;
        }
        return result(
            "Kaseikyo",
            vendor | (((payload >> 4) & 255) << 16) | (((payload >> 22) & 3) << 24),
            (payload >> 12) & 1023,
        );
    }
    if near(leader, 2400) && near(space, 600) && [25, 31, 41].contains(&data.len()) {
        let bits = (data.len() - 1) / 2;
        let mut value = 0;
        for i in 0..bits {
            let mark = data[2 + i * 2];
            if near(mark, 1200) {
                value |= 1 << i;
            } else if !near(mark, 600) {
                return None;
            }
            if i + 1 < bits && !near(data[3 + i * 2], 600) {
                return None;
            }
        }
        return result(
            match bits {
                12 => "SIRC",
                15 => "SIRC15",
                _ => "SIRC20",
            },
            value >> 7,
            value & 127,
        );
    }
    if leader > 2100 && near(leader, 2664) && near(space, 888) {
        let mut h = halves(&data[2..], 444)?;
        // The physical final space merges with idle and is not part of a capture.
        if h.len() == 43 {
            h.push(false);
        }
        if h.len() != 44 {
            return None;
        }
        let mut cursor = 0;
        for expected in [true, false, false, false] {
            if bit(&h, &mut cursor, 1, true)? != expected {
                return None;
            }
        }
        bit(&h, &mut cursor, 2, true)?;
        let mut value = 0;
        for _ in 0..16 {
            value = (value << 1) | u32::from(bit(&h, &mut cursor, 1, true)?);
        }
        return result("RC6", value >> 8, value & 255);
    }
    // RC5 starts with the unobservable idle half of start bit S1.
    let mut h = vec![false];
    h.extend(halves(data, 889)?);
    if h.len() == 27 {
        h.push(false);
    }
    if h.len() != 28 {
        return None;
    }
    let mut cursor = 0;
    let mut value = 0;
    for _ in 0..14 {
        value = (value << 1) | u32::from(bit(&h, &mut cursor, 1, false)?);
    }
    if value & (1 << 13) == 0 {
        return None;
    }
    result(
        "RC5",
        (value >> 6) & 31,
        (value & 63) | (u32::from(value & (1 << 12) == 0) << 6),
    )
}
fn hex(value: u32) -> String {
    value
        .to_le_bytes()
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}
fn parse_hex(text: &str) -> Result<u32, String> {
    let bytes = text
        .split_whitespace()
        .map(|b| {
            if b.len() == 2 {
                u8::from_str_radix(b, 16).map_err(|_| "invalid hex byte")
            } else {
                Err("expected space-separated hex bytes")
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    if bytes.is_empty() || bytes.len() > 4 {
        return Err("expected 1..4 little-endian bytes".into());
    }
    Ok(bytes
        .iter()
        .enumerate()
        .fold(0, |v, (i, b)| v | (u32::from(*b) << (i * 8))))
}
impl Signal {
    pub fn raw_text(&self) -> String {
        format!("Filetype: IR signals file\nVersion: 1\n#\nname: {}\ntype: raw\nfrequency: {}\nduty_cycle: {:.6}\ndata: {}\n", self.name, self.frequency, self.duty_cycle, self.data.iter().map(u32::to_string).collect::<Vec<_>>().join(" "))
    }
    pub fn parsed_text(&self) -> Option<String> {
        let p = self.parsed.as_ref()?;
        Some(format!("Filetype: IR signals file\nVersion: 1\n#\nname: {}\ntype: parsed\nprotocol: {}\naddress: {}\ncommand: {}\n", self.name, p.protocol, hex(p.address), hex(p.command)))
    }
}
/// Accept one signal block, with or without its file header. Reject multi-signal uploads.
pub fn parse(text: &str) -> Result<Signal, String> {
    if text.len() > 60_000 {
        return Err("signal text too large".into());
    }
    let mut fields = BTreeMap::new();
    for line in text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
    {
        let (key, value) = line.split_once(':').ok_or("expected key: value")?;
        if fields.insert(key.trim(), value.trim()).is_some() {
            return Err("duplicate field; select one signal block".into());
        }
    }
    if fields
        .get("Filetype")
        .is_some_and(|v| *v != "IR signals file")
        || fields.get("Version").is_some_and(|v| *v != "1")
    {
        return Err("unsupported .ir header".into());
    }
    let get = |key| {
        fields
            .get(key)
            .copied()
            .ok_or_else(|| format!("missing {key}"))
    };
    let name = fields.get("name").unwrap_or(&"signal").to_string();
    if name.is_empty() || name.len() > 128 || !name.bytes().all(|b| (32..=126).contains(&b)) {
        return Err("name must be 1..128 printable ASCII characters".into());
    }
    match get("type")? {
        "parsed" => {
            let mut s = encode(&Message {
                protocol: get("protocol")?.into(),
                address: parse_hex(get("address")?)?,
                command: parse_hex(get("command")?)?,
            })?;
            s.name = name;
            Ok(s)
        }
        "raw" => {
            let frequency = get("frequency")?
                .parse::<u32>()
                .map_err(|_| "invalid frequency")?;
            let duty_cycle = get("duty_cycle")?
                .parse::<f32>()
                .map_err(|_| "invalid duty cycle")?;
            if !(10_000..=1_000_000).contains(&frequency)
                || !duty_cycle.is_finite()
                || duty_cycle <= 0.0
                || duty_cycle >= 1.0
            {
                return Err("invalid carrier".into());
            }
            let data = get("data")?
                .split_whitespace()
                .map(|s| s.parse::<u32>().map_err(|_| "invalid duration"))
                .collect::<Result<Vec<_>, _>>()?;
            if data.is_empty()
                || data.len() > 1024
                || data.iter().any(|t| *t == 0 || *t > 1_000_000)
                || data.iter().map(|t| u64::from(*t)).sum::<u64>() > 30_000_000
            {
                return Err("invalid or excessive timings".into());
            }
            Ok(Signal {
                name,
                frequency,
                duty_cycle,
                data,
                parsed: None,
            })
        }
        _ => Err("type must be parsed or raw".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_protocols_round_trip_and_tolerate_clock_error() {
        for (p, a, c) in [
            ("NEC", 0x20, 0xa5),
            ("NECext", 0x1234, 0xed12),
            ("Samsung32", 7, 2),
            ("RC5", 17, 119),
            ("RC6", 0x81, 0x92),
            ("SIRC", 17, 42),
            ("SIRC15", 0xe7, 0x6a),
            ("SIRC20", 0x1a23, 0x4d),
            ("Kaseikyo", 0x02ab_2002, 0x2a5),
        ] {
            let message = Message {
                protocol: p.into(),
                address: a,
                command: c,
            };
            let s = encode(&message).unwrap();
            assert_eq!(decode(&s.data), Some(message.clone()), "{p}: {:?}", s.data);
            let skew = s
                .data
                .iter()
                .enumerate()
                .map(|(i, t)| {
                    if i % 2 == 0 {
                        t * 110 / 100
                    } else {
                        t * 93 / 100
                    }
                })
                .collect::<Vec<_>>();
            assert_eq!(decode(&skew), Some(message), "skew {p}");
        }
    }
    #[test]
    fn manchester_all_values_and_final_half_polarity() {
        for p in ["RC5", "RC6"] {
            for a in [0, 1, 17, 31] {
                for c in 0..128 {
                    let m = Message {
                        protocol: p.into(),
                        address: a,
                        command: c,
                    };
                    assert_eq!(decode(&encode(&m).unwrap().data), Some(m));
                }
            }
        }
    }
    #[test]
    fn nec_known_vector_and_checksum_gates() {
        let s = encode(&Message {
            protocol: "NEC".into(),
            address: 0,
            command: 1,
        })
        .unwrap();
        assert_eq!(&s.data[..6], &[9000, 4500, 563, 563, 563, 563]);
        assert_eq!(&s.data[18..22], &[563, 1688, 563, 1688]);
        let mut samsung = encode(&Message {
            protocol: "Samsung32".into(),
            address: 7,
            command: 2,
        })
        .unwrap();
        samsung.data[19] = 563;
        assert!(decode(&samsung.data).is_none());
        let mut k = encode(&Message {
            protocol: "Kaseikyo".into(),
            address: 0x2002,
            command: 3,
        })
        .unwrap();
        k.data[35] = if k.data[35] == 432 { 1296 } else { 432 };
        assert!(decode(&k.data).is_none());
    }
    #[test]
    fn flipper_parse_write_and_validation() {
        let m = Message {
            protocol: "NEC".into(),
            address: 0x42,
            command: 0x17,
        };
        let mut s = encode(&m).unwrap();
        s.name = "Power".into();
        assert_eq!(parse(&s.parsed_text().unwrap()).unwrap(), s);
        let raw = parse(&s.raw_text()).unwrap();
        assert_eq!(raw.data, s.data);
        assert_eq!(raw.parsed, None);
        assert_eq!(parse(&raw.raw_text()).unwrap(), raw);
        assert!(
            parse("type: parsed\nprotocol: NEC\naddress: FF 01 00 00\ncommand: 01 00 00 00")
                .is_err()
        );
        assert!(parse("type: raw\nfrequency: 38000\nduty_cycle: NaN\ndata: 1 2").is_err());
        assert!(parse("name: a\nname: b\ntype: raw").is_err());
    }
}
