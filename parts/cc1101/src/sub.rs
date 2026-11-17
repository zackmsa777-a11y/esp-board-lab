//! Original Flipper SubGhz text interchange; durations are signed microseconds.
use std::fmt::Write;
pub const MAX_PULSES: usize = 16384;
#[derive(Clone, Debug, PartialEq)]
pub struct Signal {
    pub frequency: u64,
    pub preset: String,
    pub raw: Vec<i64>,
}
impl Signal {
    pub fn parse(text: &str) -> Result<Self, String> {
        let mut frequency = None;
        let mut preset = "FuriHalSubGhzPresetOok650Async".to_string();
        let mut protocol = "";
        let mut raw = Vec::new();
        let (mut key, mut bits, mut te) = (None, 0, 0i64);
        for line in text.lines() {
            let Some((name, value)) = line.trim().split_once(':') else {
                continue;
            };
            let value = value.trim();
            match name {
                "Frequency" => frequency = value.parse::<u64>().ok(),
                "Preset" => {
                    if value.len() > 128 {
                        return Err("Preset name too long".into());
                    }
                    preset = value.to_string();
                }
                "Protocol" => protocol = value,
                "Bit" => bits = value.parse::<u32>().map_err(|_| "Invalid Bit")?,
                "TE" => te = value.parse::<i64>().map_err(|_| "Invalid TE")?,
                "Key" => {
                    key =
                        u64::from_str_radix(&value.split_whitespace().collect::<String>(), 16).ok()
                }
                "RAW_Data" => {
                    for token in value.split_whitespace() {
                        let p = token
                            .parse::<i64>()
                            .map_err(|_| "Invalid RAW_Data duration")?;
                        if p == 0 || p.unsigned_abs() > 10_000_000 {
                            return Err(
                                "RAW_Data duration must be nonzero and at most 10 seconds".into()
                            );
                        }
                        if raw.len() == MAX_PULSES {
                            return Err("Too many RAW_Data durations".into());
                        }
                        raw.push(p);
                    }
                }
                _ => {}
            }
        }
        let frequency = frequency
            .filter(|f| *f > 0)
            .ok_or("Missing/invalid Frequency")?;
        match protocol {
            "RAW" => {}
            "Princeton" => {
                let key = key.ok_or("Missing/invalid Key")?;
                if !(1..=64).contains(&bits) || !(1..=100_000).contains(&te) {
                    return Err("Princeton requires Bit 1..64 and TE 1..100000".into());
                }
                raw.clear();
                for bit in (0..bits).rev() {
                    raw.extend(if key & (1 << bit) == 0 {
                        [te, -3 * te]
                    } else {
                        [3 * te, -te]
                    });
                }
                raw.extend([te, -31 * te]);
            }
            other => return Err(format!("Unsupported .sub Protocol: {other}")),
        }
        if raw.is_empty() {
            return Err("No RAW_Data durations".into());
        }
        Ok(Self {
            frequency,
            preset,
            raw,
        })
    }
    pub fn text(&self) -> String {
        let mut out = format!("Filetype: Flipper SubGhz RAW File\nVersion: 1\nFrequency: {}\nPreset: {}\nProtocol: RAW\n", self.frequency, self.preset);
        for chunk in self.raw.chunks(512) {
            out.push_str("RAW_Data:");
            for p in chunk {
                let _ = write!(out, " {p}");
            }
            out.push('\n');
        }
        out
    }
}
pub fn pulse(raw: &mut Vec<i64>, level: bool, us: i64) {
    if us <= 0 {
        return;
    }
    let mut remaining = us;
    if let Some(last) = raw.last_mut().filter(|p| p.is_positive() == level) {
        let added = remaining.min(10_000_000 - last.abs());
        *last += if level { added } else { -added };
        remaining -= added;
    }
    while remaining > 0 && raw.len() < MAX_PULSES {
        let added = remaining.min(10_000_000);
        raw.push(if level { added } else { -added });
        remaining -= added;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn long_equal_level_runs_still_round_trip_within_abi_buffer() {
        let mut raw = vec![9_000_000];
        pulse(&mut raw, true, 9_000_000);
        assert_eq!(raw, [10_000_000, 8_000_000]);
        let signal = Signal {
            frequency: 433920000,
            preset: "test".into(),
            raw,
        };
        assert_eq!(Signal::parse(&signal.text()).unwrap(), signal);
        let largest = Signal {
            frequency: 433920000,
            preset: "x".repeat(128),
            raw: (0..MAX_PULSES)
                .map(|i| if i % 2 == 0 { 10_000_000 } else { -10_000_000 })
                .collect(),
        };
        assert!(largest.text().len() + 1024 < 262144);
        assert_eq!(Signal::parse(&largest.text()).unwrap(), largest);
    }
    #[test]
    fn raw_round_trip_and_line_limit() {
        let s = Signal {
            frequency: 433920000,
            preset: "FuriHalSubGhzPresetOok650Async".into(),
            raw: (0..1030)
                .map(|i| if i % 2 == 0 { 400 } else { -1200 })
                .collect(),
        };
        let text = s.text();
        assert_eq!(Signal::parse(&text).unwrap(), s);
        assert_eq!(
            text.lines().filter(|l| l.starts_with("RAW_Data:")).count(),
            3
        );
        assert!(text
            .lines()
            .filter(|l| l.starts_with("RAW_Data:"))
            .all(|l| l.split_whitespace().count() <= 513));
    }
    #[test]
    fn princeton_and_rejection() {
        let s =
            Signal::parse("Frequency: 433920000\nProtocol: Princeton\nBit: 2\nKey: 00 02\nTE: 350")
                .unwrap();
        assert_eq!(s.raw, [1050, -350, 350, -1050, 350, -10850]);
        assert!(
            Signal::parse("Frequency: 433920000\nProtocol: CAME\nKey: 01")
                .unwrap_err()
                .contains("Unsupported")
        );
        for bad in ["0", "-9223372036854775808", "NaN"] {
            assert!(
                Signal::parse(&format!("Frequency: 1\nProtocol: RAW\nRAW_Data: {bad}")).is_err()
            );
        }
    }
}
