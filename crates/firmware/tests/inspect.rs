use ebl_firmware::{inspect, Chip};

#[test]
#[ignore = "set EBL_TEMBED_FW to a downloaded T-Embed CC1101 factory .bin"]
fn local_tembed_factory_firmware() {
    let bytes = std::fs::read(r"D:\esp-board-lab\vendor-dl\fw\tembed_factory.bin").unwrap();
    let info = inspect(&bytes).unwrap();
    assert_eq!(info.chip, Chip::Esp32S3);
    assert!(info.merged);
    assert!(info.partitions.iter().any(|p| p.name == "nvs"));
    assert!(info.hints.iter().any(|hint| hint == "arduino-esp32"));
    assert!(info.app.is_some());
}
