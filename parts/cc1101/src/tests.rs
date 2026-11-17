use super::*;
const CS: u64 = 1 << 12;
const GDO0: u64 = 1 << 3;
fn radio() -> Cc1101 {
    let mut d = Cc1101::default();
    d.configure(&PartConfig {
        pins: [
            ("CS", 12),
            ("SCK", 11),
            ("MOSI", 9),
            ("MISO", 10),
            ("GDO0", 3),
            ("GDO2", 38),
            ("SW1", 47),
            ("SW0", 48),
        ]
        .map(|(k, v)| (k.into(), v))
        .into(),
        ..Default::default()
    });
    d.on_pins(CS, 0);
    d.outputs.clear();
    d
}
fn transfer(d: &mut Cc1101, bytes: &[u8]) -> Vec<u8> {
    d.on_bus(&BusRequest {
        correlation_id: 42,
        op: Some(bus_request::Op::Spi(SpiTransfer {
            tx: bytes.to_vec(),
            rx_len: bytes.len() as u32,
            pin_levels: d.levels & !CS,
            ..Default::default()
        })),
    })
    .unwrap()
    .data
}
fn transaction(d: &mut Cc1101, bytes: &[u8]) -> Vec<u8> {
    d.on_pins(d.levels & !CS, d.now);
    let r = transfer(d, bytes);
    d.on_pins(d.levels | CS, d.now);
    r
}
fn write(d: &mut Cc1101, reg: u8, value: u8) {
    transaction(d, &[reg, value]);
}
fn read(d: &mut Cc1101, reg: u8) -> u8 {
    transaction(d, &[reg | if reg >= 0x30 { 0xc0 } else { 0x80 }, 0])[1]
}
fn strobe(d: &mut Cc1101, byte: u8) {
    transaction(d, &[byte]);
}
fn packet_radio() -> Cc1101 {
    let mut d = radio();
    transaction(&mut d, &[0x4d, 0x10, 0xb0, 0x71]);
    write(&mut d, 8, 5); // Variable length, CRC, no whitening.
    write(&mut d, 0x18, 0); // No autocal for deterministic packet tests.
    write(&mut d, 0x17, 0x0c); // RX after RX, IDLE after TX.
    write(&mut d, 2, 6);
    write(&mut d, 0, 7);
    d.outputs.clear();
    d
}
fn send_packet(d: &mut Cc1101, payload: &[u8]) -> String {
    let mut fifo = vec![0x7f, payload.len() as u8];
    fifo.extend(payload);
    transaction(d, &fifo);
    strobe(d, 0x35);
    d.captures.back().unwrap().clone()
}
#[test]
fn register_burst_status_and_gpio_cs_split_transfers() {
    let mut d = radio();
    assert_eq!(read(&mut d, 0x30), 0);
    assert_eq!(read(&mut d, 0x31), 0x14);
    assert_eq!(transaction(&mut d, &[0x4d, 0x10, 0xb0, 0x71])[0], 15);
    assert_eq!(transaction(&mut d, &[0xcd, 0, 0, 0]), [0, 0x10, 0xb0, 0x71]);
    d.on_pins(0, 0);
    assert_eq!(transfer(&mut d, &[0xf1]), [0]);
    assert_eq!(transfer(&mut d, &[0]), [0x14]);
    d.on_pins(CS, 0);
    assert_eq!(read(&mut d, 0x31), 0x14);
    write(&mut d, 0x09, 0xa5);
    assert_eq!(read(&mut d, 0x09), 0xa5);
    // The same address with B=0 executes SRES, not PARTNUM read.
    transaction(&mut d, &[0xb0]);
    assert_eq!(read(&mut d, 9), 0);
}
#[test]
fn patable_burst_and_fifo_status_counts() {
    let mut d = radio();
    transaction(&mut d, &[0x7e, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert_eq!(
        transaction(&mut d, &[0xfe, 0, 0, 0, 0, 0, 0, 0, 0]),
        [0, 1, 2, 3, 4, 5, 6, 7, 8]
    );
    let mut fifo = vec![0x7f];
    fifo.extend([0x55; 60]);
    transaction(&mut d, &fifo);
    assert_eq!(read(&mut d, 0x3a), 60);
    assert_eq!(transaction(&mut d, &[0x3d]), [4]);
    assert_eq!(transaction(&mut d, &[0xbd]), [0]);
    strobe(&mut d, 0x3b);
    assert_eq!(read(&mut d, 0x3a), 0);
}
#[test]
fn strobes_marcstate_calibration_sleep_underflow_and_flush() {
    let mut d = radio();
    strobe(&mut d, 0x33);
    assert_eq!(read(&mut d, 0x35), 5);
    assert_eq!(transaction(&mut d, &[0x3d])[0] >> 4, 4);
    d.poll(800_000);
    assert_eq!(read(&mut d, 0x35), 1);
    strobe(&mut d, 0x31);
    assert_eq!(read(&mut d, 0x35), 18);
    strobe(&mut d, 0x36);
    assert_eq!(read(&mut d, 0x35), 1);
    write(&mut d, 0x18, 0x14);
    strobe(&mut d, 0x34);
    assert_eq!(d.marc, 8);
    d.poll(1_600_000);
    assert_eq!(read(&mut d, 0x35), 13);
    strobe(&mut d, 0x36);
    strobe(&mut d, 0x35);
    d.poll(2_400_000);
    assert_eq!(read(&mut d, 0x35), 22);
    assert_eq!(read(&mut d, 0x3a), 0x80);
    strobe(&mut d, 0x3b);
    assert_eq!(read(&mut d, 0x35), 1);
    strobe(&mut d, 0x39);
    assert_eq!(d.name(), "SLEEP");
    assert_eq!(read(&mut d, 0x35), 1);
    strobe(&mut d, 0x32);
    assert_eq!(d.name(), "XOFF");
    assert_eq!(read(&mut d, 0x35), 1);
    write(&mut d, 0x18, 0);
    strobe(&mut d, 0x38);
    assert_eq!(d.name(), "RX");
    strobe(&mut d, 0x30);
    assert_eq!(d.regs, RESET);
}
#[test]
fn frequency_rate_bandwidth_modulation_and_band_switch() {
    let mut d = packet_radio();
    assert!(d.frequency().abs_diff(433_920_000) < 200);
    assert!((d.rate() - 115051.2695).abs() < 1.0);
    assert!((d.bandwidth() / 1000.0 - 203.125).abs() < 0.001);
    for (v, s) in [
        (0, "2-FSK"),
        (1, "GFSK"),
        (3, "ASK-OOK"),
        (4, "4-FSK"),
        (7, "MSK"),
    ] {
        write(&mut d, 0x12, v << 4);
        assert_eq!(d.modulation(), s);
    }
    for (mask, s) in [
        (1 << 47, "315"),
        ((1 << 47) | (1 << 48), "433"),
        (1 << 48, "868-915"),
        (0, "?"),
    ] {
        d.on_pins(CS | mask, d.now);
        assert_eq!(d.state().unwrap().get("band_switch"), Some(s));
    }
}
#[test]
fn packet_fifo_tx_capture_raw_injection_sync_crc_status_gdo() {
    let mut tx = packet_radio();
    let text = send_packet(&mut tx, &[0x12, 0x34, 0xa5]);
    assert_eq!(tx.tx_count, 1);
    assert_eq!(tx.marc, 19);
    assert!(tx.sync);
    let signal = Signal::parse(&text).unwrap();
    assert!(signal.raw.len() > 32);
    assert!(signal.frequency.abs_diff(433920000) < 200);
    tx.poll(50_000_000);
    assert_eq!(tx.marc, 1);
    assert!(!tx.sync);
    let mut rx = packet_radio();
    strobe(&mut rx, 0x34);
    rx.on_input(&format!("load-sub:{text}"));
    let first = rx.poll(1);
    assert!(rx.sync);
    assert_eq!(read(&mut rx, 0x38) & 8, 8);
    rx.poll(50_000_000);
    assert_eq!(rx.marc, 13);
    assert_eq!(read(&mut rx, 0x3b), 6);
    assert_eq!(read(&mut rx, 0x33) & 0x80, 0x80);
    assert_eq!(read(&mut rx, 0x34), 68);
    assert_eq!(read(&mut rx, 0x38) & 0x80, 0x80);
    assert!(first
        .iter()
        .chain(rx.outputs.iter())
        .any(|m| matches!(&m.payload,Some(esp_part::Payload::GpioDrive(g)) if g.pin==3&&g.level)));
    assert!(rx
        .outputs
        .iter()
        .any(|m| matches!(&m.payload,Some(esp_part::Payload::GpioDrive(g)) if g.pin==38&&g.level)));
    assert_eq!(
        transaction(&mut rx, &[0xff, 0, 0, 0, 0, 0, 0])[1..],
        [3, 0x12, 0x34, 0xa5, 68, 0x80]
    );
    assert_eq!(read(&mut rx, 0x3b), 0);
    assert_eq!(read(&mut rx, 0x33) & 0x80, 0x80);
    assert!(!rx.packet_ready);
    let mut bad = packet_radio();
    write(&mut bad, 4, 0x66);
    write(&mut bad, 5, 0x66);
    strobe(&mut bad, 0x34);
    bad.on_input(&format!("load-sub:{text}"));
    bad.poll(1);
    bad.poll(50_000_000);
    assert_eq!(bad.rx.len(), 0);
    assert!(bad.last_rx.contains("Rejected"));
}
#[test]
fn whitened_fixed_packet_roundtrip_and_crc_vector() {
    assert_eq!(Cc1101::crc(b"123456789"), [0xae, 0xe7]);
    let mut tx = packet_radio();
    write(&mut tx, 8, 0x44);
    write(&mut tx, 6, 3);
    transaction(&mut tx, &[0x7f, 0x13, 0x57, 0x9b]);
    strobe(&mut tx, 0x35);
    let mut rx = packet_radio();
    write(&mut rx, 8, 0x44);
    write(&mut rx, 6, 3);
    strobe(&mut rx, 0x34);
    rx.on_input(&format!("load-sub:{}", tx.captures.back().unwrap()));
    rx.poll(1);
    rx.poll(50_000_000);
    assert_eq!(
        rx.rx.iter().copied().take(3).collect::<Vec<_>>(),
        [0x13, 0x57, 0x9b]
    );
    assert!(rx.crc_ok);
}
#[test]
fn crc_autoflush_and_rx_overflow() {
    let mut tx = packet_radio();
    let text = send_packet(&mut tx, &[0x24, 0x42]);
    let mut rx = packet_radio();
    write(&mut rx, 7, 0x0c);
    strobe(&mut rx, 0x34);
    let mut s = Signal::parse(&text).unwrap();
    let n = s.raw.len();
    s.raw[n - 1] = -s.raw[n - 1];
    rx.on_input(&format!("load-sub:{}", s.text()));
    rx.poll(1);
    rx.poll(50_000_000);
    assert!(rx.rx.is_empty());
    rx.on_input(&format!("load-sub:{text}"));
    rx.rx.extend([0; 63]);
    rx.poll(50_000_001);
    rx.poll(100_000_000);
    assert_eq!(rx.marc, 17);
    assert_eq!(read(&mut rx, 0x3b), 0xc0);
    strobe(&mut rx, 0x3a);
    assert_eq!(read(&mut rx, 0x3b), 0);
    assert_eq!(rx.marc, 1);
}
#[test]
fn async_tx_watches_gdo0_and_does_not_drive_mcu_data() {
    let mut d = packet_radio();
    write(&mut d, 8, 0x30);
    write(&mut d, 2, 13);
    strobe(&mut d, 0x35);
    d.outputs.clear();
    d.on_pins(CS | GDO0, 100_000);
    d.on_pins(CS, 450_000);
    d.on_pins(CS | GDO0, 1_500_000);
    d.on_pins(CS, 2_550_000);
    d.advance(2_900_000);
    strobe(&mut d, 0x36);
    assert_eq!(
        Signal::parse(d.captures.back().unwrap()).unwrap().raw,
        [-100, 350, -1050, 1050, -350]
    );
    assert_eq!(d.tx_count, 1);
    assert!(!d
        .outputs
        .iter()
        .any(|m| matches!(&m.payload,Some(esp_part::Payload::GpioDrive(g)) if g.pin==3)));
}
#[test]
fn async_rx_schedules_exact_future_edges_progressively() {
    let mut d = packet_radio();
    write(&mut d, 8, 0x30);
    write(&mut d, 2, 0x2e);
    write(&mut d, 0, 13);
    strobe(&mut d, 0x34);
    d.outputs.clear();
    d.on_input("load-sub:Frequency: 433920000\nProtocol: RAW\nRAW_Data: 350 -1050 1050 -350");
    assert_eq!(d.poll(1000), Some(drive(38, true, 1000)));
    assert_eq!(d.poll(1000), Some(drive(38, false, 351000)));
    assert_eq!(d.poll(1000), Some(drive(38, true, 1401000)));
    assert_eq!(d.poll(1000), Some(drive(38, false, 2451000)));
    assert_eq!(d.poll(1000), Some(drive(38, false, 2801000)));
    assert_eq!(d.poll(1000), None);
    assert_eq!(d.poll(3000000), None);
}
#[test]
fn async_rx_lookahead_is_bounded_for_large_files() {
    let mut d = packet_radio();
    write(&mut d, 8, 0x30);
    write(&mut d, 2, 0x2e);
    write(&mut d, 0, 13);
    strobe(&mut d, 0x34);
    d.outputs.clear();
    let s = Signal {
        frequency: d.frequency(),
        preset: "test".into(),
        raw: (0..1000)
            .map(|i| if i % 2 == 0 { 10 } else { -10 })
            .collect(),
    };
    d.on_input(&format!("load-sub:{}", s.text()));
    let mut count = 0;
    while d.poll(0).is_some() {
        count += 1;
        assert!(count <= 33);
    }
    assert_eq!(count, 33); // Initial edge at now plus 32 future timestamps.
    assert!(d.playback.is_some());
}
#[test]
fn wrong_frequency_queue_clear_invalid_protocol_and_rssi_input() {
    let mut d = packet_radio();
    write(&mut d, 8, 0x30);
    strobe(&mut d, 0x34);
    d.on_input("load-sub:Frequency: 315000000\nProtocol: RAW\nRAW_Data: 350 -1050");
    d.poll(1);
    assert_eq!(d.air.len(), 1);
    assert!(d.playback.is_none());
    d.on_input("air-clear");
    assert!(d.air.is_empty());
    d.on_input("load-sub:Frequency: 433920000\nProtocol: Nice FLO");
    assert!(d.last_error.contains("Unsupported"));
    d.on_input("set:rssi=-60");
    assert_eq!(read(&mut d, 0x34), 28);
}
#[test]
fn capture_retention_and_state_contract() {
    let mut d = packet_radio();
    for _ in 0..20 {
        d.capture(vec![350, -1050]);
    }
    assert_eq!(d.captures.len(), 16);
    assert_eq!(d.tx_count, 20);
    let state = d.state().unwrap();
    for key in [
        "chip_state",
        "freq_hz",
        "modulation",
        "data_rate",
        "bandwidth_khz",
        "mode",
        "band_switch",
        "rx_pending",
        "tx_count",
        "last_tx",
        "last_rx",
        "last_error",
    ] {
        assert!(state.get(key).is_some(), "{key}");
    }
}
