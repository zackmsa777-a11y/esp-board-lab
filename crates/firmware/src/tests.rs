use crate::{inspect, Chip, FirmwareError};

fn image(chip_id: u16) -> Vec<u8> {
    let mut bytes = vec![0; 0x20 + 256];
    bytes[0] = 0xe9;
    bytes[1] = 3;
    bytes[2] = 2;
    bytes[3] = 0x4f;
    bytes[12..14].copy_from_slice(&chip_id.to_le_bytes());
    bytes
}

fn text(bytes: &mut [u8], offset: usize, value: &str) {
    bytes[offset..offset + value.len()].copy_from_slice(value.as_bytes());
}

fn descriptor(bytes: &mut [u8], app_offset: usize, project: &str) {
    let desc = &mut bytes[app_offset + 0x20..app_offset + 0x20 + 256];
    desc.fill(0);
    desc[..4].copy_from_slice(&0xabcd5432u32.to_le_bytes());
    text(desc, 16, "1.2.3");
    text(desc, 48, project);
    text(desc, 80, "12:34:56");
    text(desc, 96, "Nov 17 2026");
    text(desc, 112, "v5.4.2");
}

fn partition(bytes: &mut [u8], index: usize, kind: u8, subtype: u8, offset: u32, name: &str) {
    let entry = &mut bytes[0x8000 + index * 32..0x8000 + (index + 1) * 32];
    entry.fill(0);
    entry[..4].copy_from_slice(&[0xaa, 0x50, kind, subtype]);
    entry[4..8].copy_from_slice(&offset.to_le_bytes());
    entry[8..12].copy_from_slice(&0x1000u32.to_le_bytes());
    text(entry, 12, name);
}

fn merged() -> Vec<u8> {
    let mut bytes = image(9);
    bytes.resize(0x13000, 0xff);
    partition(&mut bytes, 0, 1, 2, 0x9000, "nvs");
    partition(&mut bytes, 1, 0, 0x10, 0x10000, "ota_0");
    partition(&mut bytes, 2, 0, 0, 0x11000, "factory");
    descriptor(&mut bytes, 0x10000, "ota project");
    descriptor(&mut bytes, 0x11000, "factory project");
    bytes
}

#[test]
fn app_only_header_and_descriptor() {
    let mut bytes = image(9);
    descriptor(&mut bytes, 0, "test app");
    let info = inspect(&bytes).unwrap();
    assert_eq!(info.chip, Chip::Esp32S3);
    assert_eq!(info.flash_size, Some(16 * 1024 * 1024));
    assert!(!info.merged);
    assert!(info.partitions.is_empty());
    let app = info.app.unwrap();
    assert_eq!(app.project_name, "test app");
    assert_eq!(app.version, "1.2.3");
    assert_eq!(app.time, "12:34:56");
    assert_eq!(app.date, "Nov 17 2026");
    assert_eq!(app.idf_ver, "v5.4.2");
}

#[test]
fn chip_ids_and_serialization() {
    let cases = [
        (0, Chip::Esp32, "esp32"),
        (2, Chip::Esp32S2, "esp32s2"),
        (5, Chip::Esp32C3, "esp32c3"),
        (9, Chip::Esp32S3, "esp32s3"),
        (12, Chip::Esp32C2, "esp32c2"),
        (13, Chip::Esp32C6, "esp32c6"),
        (16, Chip::Esp32H2, "esp32h2"),
        (18, Chip::Esp32P4, "esp32p4"),
        (65535, Chip::Unknown(65535), "unknown(65535)"),
    ];
    for (id, expected, name) in cases {
        let info = inspect(&image(id)).unwrap();
        assert_eq!(info.chip, expected);
        assert_eq!(serde_json::to_value(info).unwrap()["chip"], name);
    }
}

#[test]
fn all_flash_size_codes_and_unknown() {
    for code in 0..=15 {
        let mut bytes = image(0);
        bytes[3] = code << 4 | 0xf;
        let expected = if code <= 7 {
            Some((1 << 20) << code)
        } else {
            None
        };
        assert_eq!(inspect(&bytes).unwrap().flash_size, expected);
    }
}

#[test]
fn merged_partitions_prefer_factory_then_ota_zero() {
    let mut bytes = merged();
    let info = inspect(&bytes).unwrap();
    assert!(info.merged);
    assert_eq!(info.partitions.len(), 3);
    let nvs = &info.partitions[0];
    assert_eq!(nvs.name, "nvs");
    assert_eq!(nvs.type_, "data");
    assert_eq!(nvs.subtype, "nvs");
    assert_eq!(nvs.offset, 0x9000);
    assert_eq!(nvs.size, 0x1000);
    assert_eq!(info.app.unwrap().project_name, "factory project");
    partition(&mut bytes, 2, 0, 0x11, 0x11000, "ota_1");
    assert_eq!(
        inspect(&bytes).unwrap().app.unwrap().project_name,
        "ota project"
    );
}

#[test]
fn table_terminators_and_unknown_partition_types() {
    for terminator in [[0xff, 0xff], [0xeb, 0xeb]] {
        let mut bytes = merged();
        bytes[0x8020..0x8022].copy_from_slice(&terminator);
        assert_eq!(inspect(&bytes).unwrap().partitions.len(), 1);
    }
    let mut bytes = merged();
    partition(&mut bytes, 1, 0x40, 0xfe, 0x10000, "custom");
    let info = inspect(&bytes).unwrap();
    assert_eq!(info.partitions[1].type_, "0x40");
    assert_eq!(info.partitions[1].subtype, "0xfe");
}

#[test]
fn fingerprints_deduplicate_and_preserve_hint_names() {
    let mut bytes = image(9);
    bytes.extend_from_slice(b"arduino-esp32 esp32-hal TFT_eSPI LovyanGFX lvgl LVGL Bruce BRUCE bruce.computer Marauder CC1101 PN532 T-Embed T_Embed RadioLib NimBLE esp_wifi");
    let hints = inspect(&bytes).unwrap().hints;
    assert_eq!(
        hints,
        [
            "arduino-esp32",
            "TFT_eSPI",
            "LovyanGFX",
            "LVGL",
            "Bruce",
            "Marauder",
            "CC1101",
            "PN532",
            "LilyGO T-Embed",
            "RadioLib",
            "NimBLE",
            "WiFi"
        ]
    );
}

#[test]
fn malformed_and_truncated_input_returns_errors() {
    for len in 0..24 {
        assert!(matches!(
            inspect(&image(9)[..len]),
            Err(FirmwareError::Truncated { .. })
        ));
    }
    let mut bytes = image(9);
    bytes[0] = 0;
    assert!(matches!(
        inspect(&bytes),
        Err(FirmwareError::InvalidMagic(0))
    ));
    bytes[0] = 0xe9;
    for count in [0, 17, 255] {
        bytes[1] = count;
        assert!(matches!(
            inspect(&bytes),
            Err(FirmwareError::InvalidSegmentCount(_))
        ));
    }
    let mut bytes = merged();
    bytes[0x8020] = 0;
    assert!(matches!(
        inspect(&bytes),
        Err(FirmwareError::InvalidPartition(0x8020))
    ));
    let mut bytes = merged();
    bytes.truncate(0x8002);
    assert!(matches!(
        inspect(&bytes),
        Err(FirmwareError::Truncated { .. })
    ));
}

#[test]
fn missing_truncated_or_out_of_bounds_app_metadata_is_optional() {
    assert!(inspect(&image(9)).unwrap().app.is_none());
    let mut bytes = image(9);
    descriptor(&mut bytes, 0, "app");
    bytes.pop();
    assert!(inspect(&bytes).unwrap().app.is_none());
    let mut bytes = merged();
    partition(&mut bytes, 2, 0, 0, u32::MAX, "factory");
    assert!(inspect(&bytes).unwrap().app.is_none());
    partition(&mut bytes, 2, 0, 0, 0x11000, "factory");
    bytes[0x8048..0x804c].copy_from_slice(&32u32.to_le_bytes());
    assert!(inspect(&bytes).unwrap().app.is_none());
}

#[test]
fn lossy_strings_and_full_width_labels_are_safe() {
    let mut bytes = merged();
    bytes[0x800c..0x801c].fill(b'x');
    bytes[0x11020 + 48] = 0xff;
    let info = inspect(&bytes).unwrap();
    assert_eq!(info.partitions[0].name, "xxxxxxxxxxxxxxxx");
    assert!(info.app.unwrap().project_name.starts_with('\u{fffd}'));
}
