//! TI BQ27220 register model. SPDX-License-Identifier: MIT OR Apache-2.0
//! Implements standard commands plus the factory driver's control and data-memory path.
use esp_part::prelude::*;
use std::collections::BTreeMap;
struct Bq27220 {
    scl: Option<u32>,
    sda: Option<u32>,
    addr: u32,
    pointer: u8,
    regs: [u8; 256],
    percent: u16,
    voltage_mv: u16,
    charging: bool,
    usb: bool,
    security: u16,
    cfg_update: bool,
    last_control: u16,
    selected: u16,
    memory: BTreeMap<u16, u8>,
}
impl Default for Bq27220 {
    fn default() -> Self {
        let mut part = Self {
            scl: None,
            sda: None,
            addr: 0x55,
            pointer: 0,
            regs: [0; 256],
            percent: 78,
            voltage_mv: 3950,
            charging: true,
            usb: true,
            security: 3,
            cfg_update: false,
            last_control: 0,
            selected: 0,
            memory: BTreeMap::new(),
        };
        part.refresh();
        part
    }
}
impl Bq27220 {
    fn word(&mut self, reg: usize, value: u16) {
        self.regs[reg..reg + 2].copy_from_slice(&value.to_le_bytes());
    }
    fn operation(&self) -> u16 {
        0x20 | (self.security << 1) | if self.cfg_update { 0x400 } else { 0 }
    }
    fn refresh(&mut self) {
        let charging = self.charging && self.usb && self.percent < 100;
        let current = if charging {
            500i16
        } else if self.usb {
            0
        } else {
            -150
        };
        self.word(0x06, 2981); // 298.1 K, in 0.1 K units
        self.word(0x08, self.voltage_mv);
        self.word(
            0x0a,
            0x4038 | u16::from(!self.usb) | if self.percent == 100 { 0x240 } else { 0 },
        );
        self.word(0x0c, current as u16);
        self.word(0x10, (1500u32 * u32::from(self.percent) / 100) as u16);
        self.word(0x12, 1500);
        self.word(0x14, current as u16);
        self.word(0x04, 0xffff);
        self.word(
            0x16,
            if current < 0 {
                self.percent * 6
            } else {
                0xffff
            },
        );
        self.word(
            0x18,
            if charging {
                (100 - self.percent) * 2
            } else {
                0xffff
            },
        );
        self.word(0x1a, (-10i16) as u16);
        self.word(0x1c, 9000);
        self.word(0x1e, (-500i16) as u16);
        self.word(0x20, self.percent * 2);
        self.word(0x22, (1500u32 * u32::from(self.percent) / 100) as u16);
        self.word(
            0x24,
            ((i32::from(current) * i32::from(self.voltage_mv)) / 1000) as u16,
        );
        self.word(0x28, 2981); // InternalTemperature; CycleCount is 0x2A on BQ27220.
        self.word(0x2a, 12);
        self.word(0x2c, self.percent);
        self.word(0x2e, 100);
        self.word(0x30, 4200);
        self.word(0x32, 500);
        self.word(0x3a, self.operation());
        self.word(0x3c, 1500);
        self.word(0x7a, current as u16);
        self.word(0x7c, self.voltage_mv);
        self.word(0x7e, 2981);
    }
    fn control(&mut self, command: u16) {
        let answer = match command {
            0x0001 => 0x0220,
            0x0002 => 0x0100,
            0x0003 => 0x0001,
            0x0030 => {
                self.security = 3;
                0
            }
            0x3672 if self.last_control == 0x0414 => {
                self.security = 2;
                0
            }
            0xffff if self.last_control == 0xffff && self.security != 3 => {
                self.security = 1;
                0
            }
            0x0041 => {
                self.cfg_update = false;
                0
            }
            0x0090 => {
                self.cfg_update = true;
                0
            }
            0x0091 | 0x0092 => {
                self.cfg_update = false;
                0
            }
            0x0054 => self.operation(),
            0x0056 => {
                if !self.usb {
                    0x40
                } else if self.percent == 100 {
                    0x0a
                } else {
                    0
                }
            }
            _ => 0,
        };
        self.last_control = command;
        self.word(0, answer);
        self.word(0x40, answer);
        self.regs[0x60] = 0xffu8
            .wrapping_sub(self.regs[0x40])
            .wrapping_sub(self.regs[0x41]);
        self.regs[0x61] = 6;
        self.refresh();
    }
    fn write(&mut self, start: u8, data: &[u8]) {
        for (offset, &value) in data.iter().enumerate() {
            self.regs[start.wrapping_add(offset as u8) as usize] = value;
        }
        if data.len() >= 2 && start == 0 {
            self.control(u16::from_le_bytes([data[0], data[1]]));
        }
        if data.len() >= 2 && start == 0x3e {
            self.selected = u16::from_le_bytes([data[0], data[1]]);
            if self.selected < 0x100 {
                self.control(self.selected);
            } else {
                for (i, &v) in data[2..].iter().enumerate() {
                    self.memory.insert(self.selected.wrapping_add(i as u16), v);
                }
                for i in 0..32 {
                    self.regs[0x40 + i] = *self
                        .memory
                        .get(&self.selected.wrapping_add(i as u16))
                        .unwrap_or(&0);
                }
                self.regs[0x60] = self.regs[0x3e..0x60]
                    .iter()
                    .fold(0xffu8, |sum, b| sum.wrapping_sub(*b));
                self.regs[0x61] = 36;
            }
        }
        self.refresh();
    }
}

impl Device for Bq27220 {
    const NAME: &'static str = "bq27220";
    const ON_BUS: bool = true;
    fn configure(&mut self, config: &PartConfig) {
        self.scl = config.pins.get("SCL").copied();
        self.sda = config.pins.get("SDA").copied();
        self.addr = if config.addr == 0 { 0x55 } else { config.addr };
    }
    fn claims(&self) -> Vec<Claim> {
        vec![Claim {
            what: Some(claim::What::I2c(I2cClaim {
                addr: self.addr,
                scl_pin: self.scl,
                sda_pin: self.sda,
            })),
        }]
    }
    fn on_input(&mut self, input: &str) {
        if let Some((key, value)) = set_value(input) {
            match key {
                "percent" => self.percent = value.clamp(0.0, 100.0) as u16,
                "voltage-mv" => self.voltage_mv = value.clamp(0.0, 65535.0) as u16,
                "charging" => self.charging = value != 0.0,
                "usb" => self.usb = value != 0.0,
                _ => return,
            }
            self.refresh();
        }
    }
    fn state(&self) -> Option<State> {
        Some(
            State::new()
                .set("percent", self.percent)
                .set("voltage_mv", self.voltage_mv)
                .set("charging", self.charging)
                .set("usb", self.usb),
        )
    }
    fn on_bus(&mut self, request: &BusRequest) -> Option<BusReply> {
        let mut reply = BusReply {
            correlation_id: request.correlation_id,
            op: BusOp::I2c as i32,
            ..Default::default()
        };
        let Some(bus_request::Op::I2c(tx)) = &request.op else {
            return Some(reply);
        };
        if tx.addr != self.addr {
            return Some(reply);
        }
        if let Some((&reg, data)) = tx.write.split_first() {
            self.pointer = reg;
            self.write(reg, data);
            if !data.is_empty() {
                self.pointer = reg.wrapping_add(data.len() as u8);
            }
        }
        for _ in 0..tx.read_len {
            reply.data.push(
                self.regs
                    .get(self.pointer as usize)
                    .copied()
                    .unwrap_or(0xff),
            );
            self.pointer = self.pointer.wrapping_add(1);
        }
        reply.ack = true;
        Some(reply)
    }
}
esp_part::export_part!(Bq27220, buffer = 1024);

#[cfg(test)]
mod tests {
    use super::*;
    fn request(addr: u32, write: &[u8], read_len: u32) -> BusRequest {
        BusRequest {
            correlation_id: 42,
            op: Some(bus_request::Op::I2c(I2cTransaction {
                bus: 0,
                addr,
                write: write.to_vec(),
                read_len,
                continues: false,
            })),
        }
    }
    fn transfer(p: &mut Bq27220, write: &[u8], n: u32) -> Vec<u8> {
        let r = p.on_bus(&request(p.addr, write, n)).unwrap();
        assert!(r.ack);
        assert_eq!(r.correlation_id, 42);
        assert_eq!(r.op, BusOp::I2c as i32);
        r.data
    }
    #[test]
    fn claims_configured_address_and_both_pads_and_nacks_other_address() {
        let mut p = Bq27220::default();
        p.configure(&PartConfig {
            addr: 0x42,
            pins: [("SCL".into(), 18), ("SDA".into(), 8)].into(),
            ..Default::default()
        });
        assert_eq!(
            p.claims(),
            vec![Claim {
                what: Some(claim::What::I2c(I2cClaim {
                    addr: 0x42,
                    scl_pin: Some(18),
                    sda_pin: Some(8),
                }))
            }]
        );
        assert!(!p.on_bus(&request(0x43, &[], 1)).unwrap().ack);
        assert!(p.on_bus(&request(0x42, &[], 0)).unwrap().ack);
    }
    #[test]
    fn register_writes_and_reads_auto_increment_even_across_transactions() {
        let mut p = Bq27220::default();
        transfer(&mut p, &[0x34, 0x12, 0x34], 0);
        assert_eq!(transfer(&mut p, &[0x34], 1), [0x12]);
        let mut req = request(p.addr, &[], 1);
        if let Some(bus_request::Op::I2c(tx)) = &mut req.op {
            tx.continues = true;
        }
        assert_eq!(p.on_bus(&req).unwrap().data, [0x34]);
    }
    #[test]
    fn defaults_and_inputs_are_exposed_and_clamped() {
        let mut p = Bq27220::default();
        let state = p.state().unwrap();
        assert_eq!(state.get("percent"), Some("78"));
        assert_eq!(state.get("voltage_mv"), Some("3950"));
        assert_eq!(state.get("charging"), Some("true"));
        assert_eq!(state.get("usb"), Some("true"));
        p.on_input("set:percent=110");
        p.on_input("set:voltage-mv=4200");
        p.on_input("set:usb=0");
        p.on_input("set:charging=0");
        assert_eq!(
            (p.percent, p.voltage_mv, p.usb, p.charging),
            (100, 4200, false, false)
        );
        p.on_input("set:percent=-8");
        p.on_input("set:voltage-mv=bad");
        assert_eq!((p.percent, p.voltage_mv), (0, 4200));
    }

    fn word(p: &mut Bq27220, reg: u8) -> u16 {
        let b = transfer(p, &[reg], 2);
        u16::from_le_bytes([b[0], b[1]])
    }
    #[test]
    fn standard_words_match_factory_driver_and_inputs() {
        let mut p = Bq27220::default();
        for (reg, expected) in [
            (6, 2981),
            (8, 3950),
            (0x0c, 500),
            (0x10, 1170),
            (0x12, 1500),
            (0x14, 500),
            (0x28, 2981),
            (0x2a, 12),
            (0x2c, 78),
            (0x2e, 100),
            (0x30, 4200),
            (0x32, 500),
            (0x3c, 1500),
        ] {
            assert_eq!(word(&mut p, reg), expected, "register {reg:02x}");
        }
        p.on_input("set:percent=50");
        p.on_input("set:voltage-mv=3700");
        p.on_input("set:usb=0");
        assert_eq!(word(&mut p, 8), 3700);
        assert_eq!(word(&mut p, 0x10), 750);
        assert_eq!(word(&mut p, 0x2c), 50);
        assert_eq!(word(&mut p, 0x0c) as i16, -150);
        assert_eq!(word(&mut p, 0x0a) & 1, 1);
    }
    #[test]
    fn control_mac_identity_security_config_and_data_memory_round_trip() {
        let mut p = Bq27220::default();
        transfer(&mut p, &[0, 1, 0], 0);
        assert_eq!(word(&mut p, 0x40), 0x0220);
        transfer(&mut p, &[0, 2, 0], 0);
        assert_eq!(word(&mut p, 0x40), 0x0100);
        assert_eq!(word(&mut p, 0x3a), 0x26);
        transfer(&mut p, &[0, 0x14, 4], 0);
        transfer(&mut p, &[0, 0x72, 0x36], 0);
        assert_eq!(word(&mut p, 0x3a), 0x24);
        transfer(&mut p, &[0, 0xff, 0xff], 0);
        transfer(&mut p, &[0, 0xff, 0xff], 0);
        assert_eq!(word(&mut p, 0x3a), 0x22);
        transfer(&mut p, &[0x3e, 0x90, 0], 0);
        assert_eq!(word(&mut p, 0x3a), 0x422);
        transfer(&mut p, &[0x3e, 0x34, 0x92, 0xab, 0xcd], 0);
        transfer(&mut p, &[0x60, 0, 6], 0);
        transfer(&mut p, &[0x3e, 0x34, 0x92], 0);
        assert_eq!(transfer(&mut p, &[0x40], 2), [0xab, 0xcd]);
        transfer(&mut p, &[0, 0x91, 0], 0);
        assert_eq!(word(&mut p, 0x3a), 0x22);
        transfer(&mut p, &[0, 0x30, 0], 0);
        assert_eq!(word(&mut p, 0x3a), 0x26);
    }
}
