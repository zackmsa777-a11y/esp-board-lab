//! Original Flipper NFC text reader/writer; unknown bytes survive round trips.
use std::collections::BTreeMap;
use std::fmt::Write;
#[derive(Debug, PartialEq)]
pub struct Tag {
    pub kind: String,
    pub uid: Vec<u8>,
    pub atqa: [u8; 2],
    pub sak: u8,
    pub memory: Vec<Option<u8>>,
    pub signature: [u8; 32],
}
pub fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}
fn bytes(s: &str) -> Result<Vec<Option<u8>>, String> {
    s.split_whitespace()
        .map(|v| {
            if v == "??" {
                Ok(None)
            } else {
                if v.len() != 2 {
                    return Err(format!("invalid hex byte {v}"));
                }
                u8::from_str_radix(v, 16)
                    .map(Some)
                    .map_err(|_| format!("invalid hex byte {v}"))
            }
        })
        .collect()
}
fn known(s: &str) -> Result<Vec<u8>, String> {
    bytes(s)?
        .into_iter()
        .map(|v| v.ok_or_else(|| "unknown identity byte".into()))
        .collect()
}
impl Tag {
    pub fn is_classic(&self) -> bool {
        self.kind.starts_with("Mifare Classic")
    }
    pub fn sector(block: usize) -> usize {
        if block < 128 {
            block / 4
        } else {
            32 + (block - 128) / 16
        }
    }
    pub fn trailer(block: usize) -> usize {
        if block < 128 {
            block / 4 * 4 + 3
        } else {
            (block - 128) / 16 * 16 + 143
        }
    }
    pub fn read(&self, start: usize, len: usize) -> Vec<u8> {
        self.memory[start..start + len]
            .iter()
            .map(|v| v.unwrap_or(0))
            .collect()
    }
    pub fn write(&mut self, start: usize, data: &[u8]) {
        for (slot, byte) in self.memory[start..start + data.len()].iter_mut().zip(data) {
            *slot = Some(*byte);
        }
    }
    pub fn version(&self) -> Option<[u8; 8]> {
        let size = match self.kind.as_str() {
            "NTAG213" => 0x0f,
            "NTAG215" => 0x11,
            "NTAG216" => 0x13,
            _ => return None,
        };
        Some([0, 4, 4, 2, 1, 0, size, 3])
    }
    pub fn parse(text: &str) -> Result<Self, String> {
        if text.len() > 65500 {
            return Err("NFC file exceeds upload limit".into());
        }
        let mut fields = BTreeMap::new();
        for line in text
            .lines()
            .map(str::trim)
            .filter(|s| !s.starts_with('#') && !s.is_empty())
        {
            let (k, v) = line
                .split_once(':')
                .ok_or_else(|| format!("missing colon: {line}"))?;
            fields.insert(k.trim(), v.trim());
        }
        let get = |key| {
            fields
                .get(key)
                .copied()
                .ok_or_else(|| format!("missing {key}"))
        };
        if get("Filetype")? != "Flipper NFC device" {
            return Err("not a Flipper NFC device".into());
        }
        let device = get("Device type")?;
        let kind = match device {
            "Mifare Classic" => match get("Mifare Classic type")? {
                "1K" => "Mifare Classic 1K",
                "4K" => "Mifare Classic 4K",
                _ => return Err("unsupported Classic size".into()),
            },
            "Mifare Classic 1K" | "Mifare Classic 4K" | "NTAG203" | "NTAG213" | "NTAG215"
            | "NTAG216" | "ISO14443-3A" => device,
            "Mifare Ultralight" | "NTAG/Ultralight" => fields
                .get("NTAG/Ultralight type")
                .copied()
                .unwrap_or("Mifare Ultralight"),
            _ => return Err(format!("unsupported Device type {device}")),
        };
        let default_pages = match kind {
            "NTAG203" => 42,
            "NTAG213" => 45,
            "NTAG215" => 135,
            "NTAG216" => 231,
            "Mifare Ultralight" => 16,
            "Mifare Classic 1K" | "Mifare Classic 4K" | "ISO14443-3A" => 0,
            _ => return Err(format!("unsupported tag type {kind}")),
        };
        let uid = known(get("UID")?)?;
        if ![4, 7, 10].contains(&uid.len()) {
            return Err("UID must contain 4, 7 or 10 bytes".into());
        }
        let mut atqa: [u8; 2] = known(get("ATQA")?)?
            .try_into()
            .map_err(|_| "ATQA must contain two bytes")?;
        // File versions 1/2 stored ATQA least significant byte first.
        if fields
            .get("Version")
            .is_some_and(|v| *v == "1" || *v == "2")
        {
            atqa.swap(0, 1);
        }
        let sak = known(get("SAK")?)?;
        if sak.len() != 1 {
            return Err("SAK must contain one byte".into());
        }
        let classic = kind.starts_with("Mifare Classic");
        let pages = fields
            .get("Pages total")
            .map(|s| {
                s.parse::<usize>()
                    .map_err(|_| "invalid Pages total".to_string())
            })
            .transpose()?
            .unwrap_or(default_pages);
        if pages > 256 || (default_pages > 0 && pages != default_pages) {
            return Err("Pages total does not match tag capacity".into());
        }
        let count = if kind == "Mifare Classic 1K" {
            64
        } else if kind == "Mifare Classic 4K" {
            256
        } else {
            pages
        };
        let unit = if classic { 16 } else { 4 };
        let mut tag = Self {
            kind: kind.into(),
            uid,
            atqa,
            sak: sak[0],
            memory: vec![None; count * unit],
            signature: [0; 32],
        };
        for (key, value) in &fields {
            let prefix = if classic { "Block " } else { "Page " };
            if let Some(index) = key.strip_prefix(prefix) {
                let index = index
                    .parse::<usize>()
                    .map_err(|_| "invalid block/page index")?;
                let b = bytes(value)?;
                if index >= count || b.len() != unit {
                    return Err(format!("invalid {key} length/index"));
                }
                tag.memory[index * unit..(index + 1) * unit].copy_from_slice(&b);
            }
        }
        if let Some(sig) = fields.get("Signature") {
            tag.signature = known(sig)?
                .try_into()
                .map_err(|_| "signature must be 32 bytes")?;
        }
        Ok(tag)
    }
    pub fn dump(&self) -> String {
        let device = if self.is_classic() {
            "Mifare Classic"
        } else if self.memory.is_empty() {
            "ISO14443-3A"
        } else {
            "NTAG/Ultralight"
        };
        let mut s = format!("Filetype: Flipper NFC device\nVersion: 4\nDevice type: {device}\nUID: {}\nATQA: {}\nSAK: {:02X}\n", hex(&self.uid), hex(&self.atqa), self.sak);
        let (unit, label) = if self.is_classic() {
            let _ = writeln!(
                s,
                "Mifare Classic type: {}\nData format version: 2",
                if self.memory.len() == 4096 {
                    "4K"
                } else {
                    "1K"
                }
            );
            (16, "Block")
        } else if !self.memory.is_empty() {
            let _ = writeln!(
                s,
                "NTAG/Ultralight type: {}\nData format version: 2\nSignature: {}",
                self.kind,
                hex(&self.signature)
            );
            if let Some(version) = self.version() {
                let _ = writeln!(s, "Mifare version: {}", hex(&version));
            } else {
                let _ = writeln!(s, "Mifare version: 00 00 00 00 00 00 00 00");
            }
            for counter in 0..3 {
                let _ = writeln!(s, "Counter {counter}: 0\nTearing {counter}: 00");
            }
            let _ = writeln!(
                s,
                "Pages total: {}\nPages read: {}",
                self.memory.len() / 4,
                self.memory
                    .chunks(4)
                    .filter(|p| p.iter().all(Option::is_some))
                    .count()
            );
            (4, "Page")
        } else {
            return s;
        };
        for (i, chunk) in self.memory.chunks(unit).enumerate() {
            let data = chunk
                .iter()
                .map(|v| v.map(|b| format!("{b:02X}")).unwrap_or_else(|| "??".into()))
                .collect::<Vec<_>>()
                .join(" ");
            let _ = writeln!(s, "{label} {i}: {data}");
        }
        if !self.is_classic() {
            let _ = writeln!(s, "Failed authentication attempts: 0");
        }
        s
    }
}
