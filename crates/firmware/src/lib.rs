//! Inspect ESP images without executing firmware. Fingerprints are heuristic hints.
//!
//! This inspects metadata, not image checksums, signatures, or bootability.

use serde::{Serialize, Serializer};
use thiserror::Error;

#[cfg(test)]
mod tests;

const TABLE_OFFSET: usize = 0x8000;
const TABLE_LENGTH: usize = 0xc00;

#[derive(Debug, Clone, Serialize)]
pub struct FirmwareInfo {
    pub chip: Chip,
    pub flash_size: Option<u32>,
    pub merged: bool,
    pub partitions: Vec<PartitionInfo>,
    pub app: Option<AppDesc>,
    pub hints: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Chip {
    Esp32,
    Esp32S2,
    Esp32S3,
    Esp32C3,
    Esp32C2,
    Esp32C6,
    Esp32H2,
    Esp32P4,
    Unknown(u16),
}

impl Serialize for Chip {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let name = match self {
            Self::Esp32 => "esp32",
            Self::Esp32S2 => "esp32s2",
            Self::Esp32S3 => "esp32s3",
            Self::Esp32C3 => "esp32c3",
            Self::Esp32C2 => "esp32c2",
            Self::Esp32C6 => "esp32c6",
            Self::Esp32H2 => "esp32h2",
            Self::Esp32P4 => "esp32p4",
            Self::Unknown(id) => return serializer.serialize_str(&format!("unknown({id})")),
        };
        serializer.serialize_str(name)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PartitionInfo {
    pub name: String,
    pub type_: String,
    pub subtype: String,
    pub offset: u32,
    pub size: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppDesc {
    pub project_name: String,
    pub version: String,
    pub idf_ver: String,
    pub date: String,
    pub time: String,
}

#[derive(Debug, Error)]
pub enum FirmwareError {
    #[error("truncated {section} at offset {offset:#x}")]
    Truncated {
        section: &'static str,
        offset: usize,
    },
    #[error("invalid ESP image magic {0:#04x}, expected 0xe9")]
    InvalidMagic(u8),
    #[error("invalid ESP image segment count {0}, expected 1..=16")]
    InvalidSegmentCount(u8),
    #[error("invalid partition entry at offset {0:#x}")]
    InvalidPartition(usize),
}

struct ImageHeader {
    chip: Chip,
    flash_size: Option<u32>,
    _segment_count: u8,
    _flash_mode: u8,
    _flash_frequency: u8,
}

impl ImageHeader {
    fn parse(bytes: &[u8]) -> Result<Self, FirmwareError> {
        let header = bytes.get(..24).ok_or(FirmwareError::Truncated {
            section: "image header",
            offset: 0,
        })?;
        if header[0] != 0xe9 {
            return Err(FirmwareError::InvalidMagic(header[0]));
        }
        if !(1..=16).contains(&header[1]) {
            return Err(FirmwareError::InvalidSegmentCount(header[1]));
        }
        let chip = match u16::from_le_bytes([header[12], header[13]]) {
            0 => Chip::Esp32,
            2 => Chip::Esp32S2,
            5 => Chip::Esp32C3,
            9 => Chip::Esp32S3,
            12 => Chip::Esp32C2,
            13 => Chip::Esp32C6,
            16 => Chip::Esp32H2,
            18 => Chip::Esp32P4,
            id => Chip::Unknown(id),
        };
        let size_code = header[3] >> 4;
        Ok(Self {
            chip,
            flash_size: (size_code <= 7).then(|| (1 << 20) << size_code),
            _segment_count: header[1],
            _flash_mode: header[2],
            _flash_frequency: header[3] & 0xf,
        })
    }
}

/// Inspect an image beginning with an ESP header at offset zero.
///
/// A partition entry at `0x8000` identifies a merged image. Absent application
/// metadata (including an app partition outside a partial dump) yields `None`.
pub fn inspect(bytes: &[u8]) -> Result<FirmwareInfo, FirmwareError> {
    let header = ImageHeader::parse(bytes)?;
    let merged = bytes.get(TABLE_OFFSET..TABLE_OFFSET + 2) == Some(&[0xaa, 0x50]);
    let partitions = if merged {
        partitions(bytes)?
    } else {
        Vec::new()
    };
    let app = if merged {
        partitions
            .iter()
            .find(|p| p.type_ == "app" && p.subtype == "factory")
            .or_else(|| {
                partitions
                    .iter()
                    .find(|p| p.type_ == "app" && p.subtype == "ota_0")
            })
            .and_then(|p| {
                let start = p.offset as usize;
                let end = start.checked_add(p.size as usize)?.min(bytes.len());
                app_desc(bytes.get(start..end)?)
            })
    } else {
        app_desc(bytes)
    };
    let mut hints = Vec::new();
    for &(marker, hint) in MARKERS {
        if bytes.windows(marker.len()).any(|window| window == marker)
            && !hints.iter().any(|existing| existing == hint)
        {
            hints.push(hint.to_owned());
        }
    }
    Ok(FirmwareInfo {
        chip: header.chip,
        flash_size: header.flash_size,
        merged,
        partitions,
        app,
        hints,
    })
}

fn partitions(bytes: &[u8]) -> Result<Vec<PartitionInfo>, FirmwareError> {
    let mut result = Vec::new();
    for offset in (TABLE_OFFSET..TABLE_OFFSET + TABLE_LENGTH).step_by(32) {
        let magic = bytes
            .get(offset..offset + 2)
            .ok_or(FirmwareError::Truncated {
                section: "partition table",
                offset,
            })?;
        if magic == [0xeb, 0xeb] || magic == [0xff, 0xff] {
            break;
        }
        if magic != [0xaa, 0x50] {
            return Err(FirmwareError::InvalidPartition(offset));
        }
        let entry = bytes
            .get(offset..offset + 32)
            .ok_or(FirmwareError::Truncated {
                section: "partition entry",
                offset,
            })?;
        let type_ = match entry[2] {
            0 => "app".to_owned(),
            1 => "data".to_owned(),
            other => format!("0x{other:02x}"),
        };
        let subtype = match (entry[2], entry[3]) {
            (0, 0) => "factory".to_owned(),
            (0, n @ 0x10..=0x1f) => format!("ota_{}", n - 0x10),
            (0, 0x20) => "test".to_owned(),
            (1, 0) => "ota".to_owned(),
            (1, 1) => "phy".to_owned(),
            (1, 2) => "nvs".to_owned(),
            (1, 3) => "coredump".to_owned(),
            (1, 4) => "nvs_keys".to_owned(),
            (1, 5) => "efuse".to_owned(),
            (1, 0x80) => "esphttpd".to_owned(),
            (1, 0x81) => "fat".to_owned(),
            (1, 0x82) => "spiffs".to_owned(),
            (1, 0x83) => "littlefs".to_owned(),
            (_, n) => format!("0x{n:02x}"),
        };
        result.push(PartitionInfo {
            name: c_string(&entry[12..28]),
            type_,
            subtype,
            offset: le_u32(&entry[4..8]),
            size: le_u32(&entry[8..12]),
        });
    }
    Ok(result)
}

fn app_desc(image: &[u8]) -> Option<AppDesc> {
    let desc = image.get(0x20..0x20 + 256)?;
    if le_u32(&desc[..4]) != 0xabcd5432 {
        return None;
    }
    Some(AppDesc {
        version: c_string(&desc[16..48]),
        project_name: c_string(&desc[48..80]),
        time: c_string(&desc[80..96]),
        date: c_string(&desc[96..112]),
        idf_ver: c_string(&desc[112..144]),
    })
}

fn le_u32(bytes: &[u8]) -> u32 {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn c_string(bytes: &[u8]) -> String {
    let end = bytes
        .iter()
        .position(|&byte| byte == 0)
        .unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

// Literal ASCII markers and their public hint, kept together for easy extension.
const MARKERS: &[(&[u8], &str)] = &[
    (b"arduino-esp32", "arduino-esp32"),
    (b"esp32-hal", "arduino-esp32"),
    (b"TFT_eSPI", "TFT_eSPI"),
    (b"LovyanGFX", "LovyanGFX"),
    (b"lvgl", "LVGL"),
    (b"LVGL", "LVGL"),
    (b"Bruce", "Bruce"),
    (b"BRUCE", "Bruce"),
    (b"bruce.computer", "Bruce"),
    (b"Marauder", "Marauder"),
    (b"CC1101", "CC1101"),
    (b"PN532", "PN532"),
    (b"T-Embed", "LilyGO T-Embed"),
    (b"T_Embed", "LilyGO T-Embed"),
    (b"RadioLib", "RadioLib"),
    (b"NimBLE", "NimBLE"),
    (b"esp_wifi", "WiFi"),
];
