use super::*;
fn wired() -> Pn532 {
    let mut p = Pn532::default();
    p.configure(&PartConfig {
        pins: [
            ("SCL".into(), 18),
            ("SDA".into(), 8),
            ("IRQ".into(), 17),
            ("RST".into(), 45),
        ]
        .into(),
        ..Default::default()
    });
    p
}
fn tx(p: &mut Pn532, write: &[u8], n: u32) -> BusReply {
    p.on_bus(&BusRequest {
        correlation_id: 99,
        op: Some(bus_request::Op::I2c(I2cTransaction {
            addr: 0x24,
            write: write.into(),
            read_len: n,
            ..Default::default()
        })),
    })
    .unwrap()
}
fn cmd(p: &mut Pn532, code: u8, args: &[u8]) -> Vec<u8> {
    let mut data = vec![0xd4, code];
    data.extend(args);
    assert!(tx(p, &encode(&data), 0).ack);
    assert_eq!(tx(p, &[], 7).data, [&[1][..], ACK].concat());
    let n = p.queue.front().unwrap().len() as u32 + 1;
    let response = tx(p, &[], n).data;
    let decoded = decode(&response[1..]).unwrap();
    assert_eq!(&decoded[..2], &[0xd5, code + 1]);
    decoded[2..].into()
}
fn ntag(kind: &str) -> String {
    format!("Filetype: Flipper NFC device\nVersion: 4\nDevice type: Mifare Ultralight\nUID: 04 10 20 30 40 50 60\nATQA: 00 44\nSAK: 00\nNTAG/Ultralight type: {kind}\nPage 4: 01 02 03 04\nPage 5: 05 06 07 08\n")
}
fn load(p: &mut Pn532, text: &str) {
    p.on_input(&format!("load-nfc:{text}"));
    assert!(p.last_error.is_empty(), "{}", p.last_error);
}
fn activate(p: &mut Pn532) {
    assert_eq!(cmd(p, 0x4a, &[1, 0])[0], 1);
}
fn exchange(p: &mut Pn532, data: &[u8]) -> Vec<u8> {
    let mut args = vec![1];
    args.extend(data);
    cmd(p, 0x40, &args)
}
#[test]
fn normal_extended_frames_checksums_and_truncation() {
    assert_eq!(encode(&[0xd4, 2]), [0, 0, 255, 2, 254, 0xd4, 2, 0x2a, 0]);
    for len in [2, 254, 255, 264] {
        let data = vec![0x32; len];
        let frame = encode(&data);
        assert_eq!(decode(&frame), Ok(data.as_slice()));
        for cut in 0..frame.len() {
            assert!(decode(&frame[..cut]).is_err());
        }
        for index in [if len < 255 { 4 } else { 7 }, frame.len() - 2] {
            let mut bad = frame.clone();
            bad[index] ^= 1;
            assert!(decode(&bad).is_err());
        }
    }
}
#[test]
fn i2c_ready_ack_irq_partial_reads_retransmit_and_reset() {
    let mut p = wired();
    assert_eq!(p.claims().len(), 3);
    assert_eq!(p.poll(0), Some(drive(17, true, 0)));
    assert_eq!(tx(&mut p, &[], 1).data, [0]);
    tx(&mut p, &encode(&[0xd4, 2]), 0);
    assert_eq!(p.poll(1), Some(drive(17, false, 1)));
    assert_eq!(tx(&mut p, &[], 1).data, [1]); // status reads do not consume ACK
    assert_eq!(tx(&mut p, &[], 7).data, [&[1][..], ACK].concat());
    assert_eq!(p.poll(2), None);
    let head = tx(&mut p, &[], 6).data;
    let tail = tx(&mut p, &[], 9).data;
    let response = [&head[1..], &tail[1..]].concat();
    assert_eq!(decode(&response).unwrap(), [0xd5, 3, 0x32, 1, 6, 7]);
    assert_eq!(p.poll(3), Some(drive(17, true, 3)));
    tx(&mut p, NACK, 0);
    assert_eq!(p.poll(4), Some(drive(17, false, 4)));
    assert_eq!(tx(&mut p, &[], 14).data[1..], response);
    tx(&mut p, &encode(&[0xd4, 2]), 0);
    tx(&mut p, ACK, 0);
    assert!(p.queue.is_empty());
    tx(&mut p, &encode(&[0xd4, 2]), 0);
    p.on_pins(u64::MAX ^ (1 << 45), 5);
    assert!(!tx(&mut p, &[], 1).ack);
    assert!(p.queue.is_empty());
    p.on_pins(u64::MAX, 6);
    assert_eq!(cmd(&mut p, 2, &[]), [0x32, 1, 6, 7]);
}
#[test]
fn malformed_nack_and_unsupported_error() {
    let mut p = wired();
    let mut bad = encode(&[0xd4, 2]);
    bad[7] ^= 1;
    tx(&mut p, &bad, 0);
    assert_eq!(&tx(&mut p, &[], 7).data[1..], NACK);
    tx(&mut p, &encode(&[0xd4, 0xfe]), 0);
    tx(&mut p, &[], 7);
    assert_eq!(&tx(&mut p, &[], 9).data[1..], ERROR);
    tx(&mut p, &encode(&[0xd5, 2]), 0);
    assert_eq!(&tx(&mut p, &[], 9).data[1..], ERROR);
}
#[test]
fn configuration_registers_power_target_and_no_tag_commands() {
    let mut p = wired();
    assert_eq!(cmd(&mut p, 2, &[]), [0x32, 1, 6, 7]);
    assert!(cmd(&mut p, 0x14, &[1, 20, 1]).is_empty());
    assert!(p.sam);
    assert!(cmd(&mut p, 0x12, &[0x34]).is_empty());
    assert_eq!(p.parameters, 0x34);
    assert!(cmd(&mut p, 0x08, &[0x63, 0x02, 0xab, 0x63, 0x03, 0xcd]).is_empty());
    assert_eq!(
        cmd(&mut p, 0x06, &[0x63, 2, 0x63, 3, 0x63, 4]),
        [0xab, 0xcd, 0]
    );
    cmd(&mut p, 0x32, &[1, 1]);
    assert!(p.field);
    cmd(&mut p, 0x32, &[1, 0]);
    assert!(!p.field);
    cmd(&mut p, 0x32, &[5, 0xff, 1, 2]);
    assert_eq!(cmd(&mut p, 0x4a, &[1, 0]), [0]);
    assert_eq!(exchange(&mut p, &[0x30, 4]), [1]);
    assert_eq!(cmd(&mut p, 0x42, &[0x30, 4]), [1]);
    assert_eq!(cmd(&mut p, 0x54, &[1]), [1]);
    assert_eq!(cmd(&mut p, 0x52, &[0]), [0]);
    assert_eq!(cmd(&mut p, 0x44, &[0]), [0]);
    assert_eq!(cmd(&mut p, 0x8c, &[0; 37]), [1]);
    assert_eq!(cmd(&mut p, 0x16, &[0x80]), [0]);
    assert!(p.powered_down);
    cmd(&mut p, 2, &[]);
    assert!(!p.powered_down);
}
#[test]
fn ntag_inventory_read_write_version_sig_fast_password_and_presence() {
    let mut p = wired();
    load(&mut p, &ntag("NTAG215"));
    assert_eq!(
        cmd(&mut p, 0x4a, &[1, 0]),
        [1, 1, 0, 0x44, 0, 7, 4, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60]
    );
    assert_eq!(
        &exchange(&mut p, &[0x30, 4])[..9],
        &[0, 1, 2, 3, 4, 5, 6, 7, 8]
    );
    assert_eq!(exchange(&mut p, &[0xa2, 4, 9, 10, 11, 12]), [0, 10]);
    assert_eq!(
        cmd(&mut p, 0x42, &[0x3a, 4, 5]),
        [0, 9, 10, 11, 12, 5, 6, 7, 8]
    );
    assert_eq!(exchange(&mut p, &[0x60]), [0, 0, 4, 4, 2, 1, 0, 0x11, 3]);
    assert_eq!(exchange(&mut p, &[0x3c, 0]), vec![0; 33]);
    assert_eq!(exchange(&mut p, &[0x1b, 1, 2, 3, 4]), [0, 0, 0]);
    assert_eq!(exchange(&mut p, &[0xa0, 6]), [0, 10]);
    assert_eq!(exchange(&mut p, &[0xaa; 16]), [0, 10]);
    let mut compat = vec![0xa0, 7];
    compat.extend([0xbb; 16]);
    assert_eq!(exchange(&mut p, &compat), [0, 10]);
    assert_eq!(
        exchange(&mut p, &[0x3a, 6, 7]),
        [0, 0xaa, 0xaa, 0xaa, 0xaa, 0xbb, 0xbb, 0xbb, 0xbb]
    );
    assert_eq!(exchange(&mut p, &[0x3a, 6, 255]), [0x10]);
    assert!(p.dump.contains("Page 4: 09 0A 0B 0C"));
    assert_eq!(p.writes, 3);
    assert_eq!(cmd(&mut p, 0x44, &[1]), [0]);
    assert_eq!(exchange(&mut p, &[0x60]), [1]);
    assert_eq!(cmd(&mut p, 0x54, &[1]), [0]);
    assert_eq!(exchange(&mut p, &[0x60])[7], 0x11);
    assert_eq!(cmd(&mut p, 0x52, &[1]), [0]);
    assert!(!p.field);
    p.on_input("tag-present:0");
    assert_eq!(cmd(&mut p, 0x4a, &[1, 0]), [0]);
    p.on_input("tag-present:1");
    activate(&mut p);
    p.on_input("tag-clear");
    assert!(p.dump.is_empty());
    assert_eq!(exchange(&mut p, &[0x60]), [1]);
}
fn classic(size: &str, trailer: usize) -> String {
    format!("Filetype: Flipper NFC device\nDevice type: Mifare Classic\nUID: DE AD BE EF\nATQA: 00 04\nSAK: 08\nMifare Classic type: {size}\nBlock {trailer}: FF FF FF FF FF FF FF 07 80 69 A0 A1 A2 A3 A4 A5\n")
}
fn auth(p: &mut Pn532, op: u8, block: u8, key: [u8; 6]) -> Vec<u8> {
    let mut data = vec![op, block];
    data.extend(key);
    data.extend([0xde, 0xad, 0xbe, 0xef]);
    exchange(p, &data)
}
#[test]
fn classic_auth_keys_sector_boundaries_read_write_and_trailer_updates() {
    for (size, block, trailer) in [("1K", 1, 3), ("4K", 128, 143), ("4K", 255, 255)] {
        let mut p = wired();
        load(&mut p, &classic(size, trailer));
        activate(&mut p);
        assert_eq!(exchange(&mut p, &[0x30, block]), [0x14]);
        assert_eq!(auth(&mut p, 0x60, block, [0; 6]), [0x14]);
        assert_eq!(auth(&mut p, 0x60, block, [0xff; 6]), [0]);
        let mut write = vec![0xa0, block];
        write.extend([0x42; 16]);
        assert_eq!(exchange(&mut p, &write), [0]);
        assert_eq!(
            exchange(&mut p, &[0x30, block]),
            [&[0][..], &[0x42; 16]].concat()
        );
        // Writing the trailer changes the keys used for future authentication.
        if usize::from(block) != trailer {
            assert_eq!(
                auth(&mut p, 0x61, block, [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5]),
                [0]
            );
        } else {
            assert_eq!(auth(&mut p, 0x61, block, [0x42; 6]), [0]);
        }
        let other = if block < 128 {
            block.wrapping_add(4)
        } else {
            block.wrapping_sub(16)
        };
        assert_eq!(exchange(&mut p, &[0x30, other]), [0x14]);
        assert_eq!(p.auths_failed, 1);
        assert_eq!(p.auths_ok, 2);
    }
}
#[test]
fn all_tag_flipper_round_trips_unknown_bytes_and_invalid_upload_is_atomic() {
    for kind in [
        "NTAG203",
        "NTAG213",
        "NTAG215",
        "NTAG216",
        "Mifare Ultralight",
    ] {
        let text = ntag(kind).replace("Page 5: 05 06 07 08", "Page 5: ?? 06 ?? 08");
        let t = Tag::parse(&text).unwrap();
        assert_eq!(Tag::parse(&t.dump()).unwrap(), t);
        if kind == "NTAG213" {
            assert_eq!(t.version().unwrap()[6], 0x0f);
        }
        if kind == "NTAG216" {
            assert_eq!(t.version().unwrap()[6], 0x13);
        }
    }
    for size in ["1K", "4K"] {
        let t = Tag::parse(&classic(size, 3)).unwrap();
        assert_eq!(Tag::parse(&t.dump()).unwrap(), t);
    }
    let text = "Filetype: Flipper NFC device\nDevice type: ISO14443-3A\nUID: 01 02 03 04\nATQA: 00 04\nSAK: 08\n";
    let t = Tag::parse(text).unwrap();
    assert_eq!(Tag::parse(&t.dump()).unwrap(), t);
    let mut p = wired();
    load(&mut p, &ntag("NTAG215"));
    let before = p.dump.clone();
    p.on_input("load-nfc:broken");
    assert!(!p.last_error.is_empty());
    assert_eq!(p.dump, before);
    for suffix in [
        "Pages total: 999999",
        "Page 135: 00 00 00 00",
        "Page 4: 00 00",
        "SAK: 00 01",
        "UID: ?? 01 02 03",
    ] {
        assert!(Tag::parse(&(ntag("NTAG215") + suffix)).is_err(), "{suffix}");
    }
}

#[test]
fn extended_command_and_fast_read_response_are_valid_on_the_bus() {
    let mut p = wired();
    let mut command = vec![0xd4, 0x08];
    for i in 0..86u8 {
        command.extend([0x63, i, i]);
    }
    let frame = encode(&command);
    assert_eq!(&frame[3..5], &[0xff, 0xff]);
    tx(&mut p, &frame, 0);
    assert_eq!(&tx(&mut p, &[], 7).data[1..], ACK);
    assert_eq!(decode(&tx(&mut p, &[], 10).data[1..]).unwrap(), [0xd5, 9]);
    assert_eq!(cmd(&mut p, 6, &[0x63, 85]), [85]);
    load(&mut p, &ntag("NTAG216"));
    activate(&mut p);
    let response = exchange(&mut p, &[0x3a, 0, 70]);
    assert_eq!(response.len(), 285);
    assert_eq!(&p.last_frame[3..5], &[255, 255]);
    let data = &p.last_frame[8..p.last_frame.len() - 2];
    assert_eq!(checksum(data), p.last_frame[p.last_frame.len() - 2]);
}

#[test]
fn legacy_atqa_is_normalized_and_current_dump_has_the_flipper_device_name() {
    let current = Tag::parse(&ntag("NTAG215")).unwrap();
    let legacy = Tag::parse(
        &ntag("NTAG215")
            .replace("Version: 4", "Version: 2")
            .replace("ATQA: 00 44", "ATQA: 44 00"),
    )
    .unwrap();
    assert_eq!(current, legacy);
    assert!(current.dump().contains("Device type: NTAG/Ultralight\n"));
    assert!(current.dump().contains("ATQA: 00 44\n"));
}

#[test]
fn split_physical_i2c_reads_include_ready_exactly_once() {
    let mut p = wired();
    tx(&mut p, &encode(&[0xd4, 2]), 0);
    // Real factory trace: a 7-byte ACK read is delivered as 6 bytes plus
    // the final byte (which the master NACKs). Some drivers use 1+6 too.
    let first = p.host_read(6, false);
    assert_eq!(first, [1, 0, 0, 255, 0, 255]);
    assert_eq!(p.host_read(1, true), [0]);
    let ready = tx(&mut p, &[], 1).data;
    assert_eq!(ready, [1]);
    assert_eq!(p.host_read(1, false), [1]);
    let remaining = p.queue.front().unwrap().len();
    let request = BusRequest {
        correlation_id: 100,
        op: Some(bus_request::Op::I2c(I2cTransaction {
            addr: 0x24,
            read_len: remaining as u32,
            continues: true,
            ..Default::default()
        })),
    };
    let reply = p.on_bus(&request).unwrap();
    assert!(reply.ack);
    assert_eq!(reply.correlation_id, 100);
    assert_eq!(decode(&reply.data).unwrap(), [0xd5, 3, 0x32, 1, 6, 7]);
    assert!(p.queue.is_empty());
}

#[test]
fn ntag_read_rolls_over_at_physical_end_and_signature_is_loaded() {
    let mut p = wired();
    let text = ntag("NTAG213")
        + "Page 44: AA BB CC DD\nPage 0: 04 10 20 30\nSignature: "
        + &tag::hex(&[0x5a; 32])
        + "\n";
    load(&mut p, &text);
    activate(&mut p);
    assert_eq!(
        &exchange(&mut p, &[0x30, 44])[..9],
        &[0, 0xaa, 0xbb, 0xcc, 0xdd, 4, 0x10, 0x20, 0x30]
    );
    assert_eq!(
        exchange(&mut p, &[0x3c, 0]),
        [&[0][..], &[0x5a; 32]].concat()
    );
    assert_eq!(exchange(&mut p, &[0xa2, 45, 0, 0, 0, 0]), [0x10]);
    assert_eq!(Tag::parse(&p.dump).unwrap(), *p.tag.as_ref().unwrap());
}
