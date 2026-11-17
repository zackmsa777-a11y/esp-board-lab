#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use ebl_firmware::FirmwareInfo;
use tauri::ipc::{InvokeBody, Request};

fn inspect_bytes(bytes: &[u8]) -> Result<FirmwareInfo, String> {
    ebl_firmware::inspect(bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn inspect_firmware(request: Request<'_>) -> Result<FirmwareInfo, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => inspect_bytes(bytes),
        InvokeBody::Json(_) => Err(
            "inspect_firmware expects a raw binary body; pass a Uint8Array directly to invoke"
                .to_owned(),
        ),
    }
}

fn main() {
    tauri::Builder::default()
        // App commands are allowed by default; build.rs does not opt into an ACL manifest.
        .invoke_handler(tauri::generate_handler![inspect_firmware])
        .run(tauri::generate_context!())
        .expect("failed to run ESP Board Lab");
}

#[cfg(test)]
mod tests {
    use super::inspect_bytes;
    use ebl_firmware::Chip;

    #[test]
    fn inspects_synthetic_tembed_image() {
        let mut image = vec![0; 24];
        image[0] = 0xe9;
        image[1] = 1;
        image[3] = 0x40; // 16 MiB flash.
        image[12] = 9; // ESP32-S3, little endian.
        image.extend_from_slice(b"LilyGO T-Embed CC1101 TFT_eSPI");

        let info = inspect_bytes(&image).expect("synthetic ESP image should parse");
        assert_eq!(info.chip, Chip::Esp32S3);
        assert_eq!(info.flash_size, Some(16 * 1024 * 1024));
        assert!(!info.merged);
        assert!(info.hints.iter().any(|hint| hint == "LilyGO T-Embed"));
        assert!(info.hints.iter().any(|hint| hint == "CC1101"));
    }

    #[test]
    fn rejects_truncated_and_invalid_images() {
        assert!(inspect_bytes(&[])
            .unwrap_err()
            .contains("truncated image header"));
        let mut image = [0; 24];
        image[1] = 1;
        assert!(inspect_bytes(&image)
            .unwrap_err()
            .contains("invalid ESP image magic"));
    }
}
