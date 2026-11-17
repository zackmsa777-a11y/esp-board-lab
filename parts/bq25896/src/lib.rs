//! TI BQ25896 register model. SPDX-License-Identifier: MIT OR Apache-2.0
//! Register behavior follows TI's BQ25896 and XPowersLib PowersBQ25896 (MIT).
use esp_part::prelude::*;
struct Bq25896 {
    scl: Option<u32>,
    sda: Option<u32>,
    addr: u32,
    pointer: u8,
    regs: [u8; 21],
    percent: u16,
    voltage_mv: u16,
    charging: bool,
    usb: bool,
}
impl Default for Bq25896 {
    fn default() -> Self {
        let mut part = Self {
            scl: None,
            sda: None,
            addr: 0x6b,
            pointer: 0,
            regs: [
                0x48, 0x06, 0x1d, 0x1a, 0x20, 0x13, 0x5e, 0x9d, 0x03, 0x44, 0x93, 0, 0, 0x12, 0, 0,
                0, 0, 0, 0, 2,
            ],
            percent: 78,
            voltage_mv: 3950,
            charging: true,
            usb: true,
        };
        part.refresh();
        part
    }
}
impl Bq25896 {
    fn refresh(&mut self) {
        let charging = self.usb && self.charging && self.percent < 100 && self.regs[3] & 0x10 != 0;
        self.regs[0x0b] = if self.usb {
            0x24 | if self.percent == 100 {
                0x18
            } else if charging {
                0x10
            } else {
                0
            }
        } else {
            0
        };
        self.regs[0x0e] = ((self.voltage_mv.saturating_sub(2304) / 20).min(127)) as u8;
        self.regs[0x0f] = ((self.voltage_mv.max(3500).saturating_sub(2304) / 20).min(127)) as u8;
        self.regs[0x10] = 38; // About 40% of REGN: normal thermistor temperature.
        self.regs[0x11] = if self.usb { 0x80 | 24 } else { 0 }; // 5000 mV
        self.regs[0x12] = if charging { 10 } else { 0 }; // 500 mA, 50 mA/LSB
        self.regs[0x14] = 2; // PN=000 (BQ25896), DEV_REV=10 (XPowersLib identity).
    }
    fn write(&mut self, start: u8, data: &[u8]) {
        for (offset, &value) in data.iter().enumerate() {
            let reg = start as usize + offset;
            if reg == 0x14 && value & 0x80 != 0 {
                self.regs = Self::default().regs;
            } else if let Some(slot) = self.regs.get_mut(reg) {
                *slot = match reg {
                    2 => value & !0x80,
                    3 => value & !0x40,
                    _ => value,
                };
            }
        }
        self.refresh();
    }
}

impl Device for Bq25896 {
    const NAME: &'static str = "bq25896";
    const ON_BUS: bool = true;
    fn configure(&mut self, config: &PartConfig) {
        self.scl = config.pins.get("SCL").copied();
        self.sda = config.pins.get("SDA").copied();
        self.addr = if config.addr == 0 { 0x6b } else { config.addr };
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
esp_part::export_part!(Bq25896, buffer = 1024);

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
    fn transfer(p: &mut Bq25896, write: &[u8], n: u32) -> Vec<u8> {
        let r = p.on_bus(&request(p.addr, write, n)).unwrap();
        assert!(r.ack);
        assert_eq!(r.correlation_id, 42);
        assert_eq!(r.op, BusOp::I2c as i32);
        r.data
    }
    #[test]
    fn claims_configured_address_and_both_pads_and_nacks_other_address() {
        let mut p = Bq25896::default();
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
        let mut p = Bq25896::default();
        transfer(&mut p, &[0, 0x12, 0x34], 0);
        assert_eq!(transfer(&mut p, &[0], 1), [0x12]);
        let mut req = request(p.addr, &[], 1);
        if let Some(bus_request::Op::I2c(tx)) = &mut req.op {
            tx.continues = true;
        }
        assert_eq!(p.on_bus(&req).unwrap().data, [0x34]);
    }
    #[test]
    fn defaults_and_inputs_are_exposed_and_clamped() {
        let mut p = Bq25896::default();
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

    #[test]
    fn xpowers_identity_status_adc_and_charge_enable() {
        let mut p = Bq25896::default();
        assert_eq!(transfer(&mut p, &[0x14], 1), [2]);
        assert_eq!(transfer(&mut p, &[0x0b], 1), [0x34]);
        assert_eq!(transfer(&mut p, &[0x0e], 2), [82, 82]);
        assert_eq!(transfer(&mut p, &[0x11], 2), [0x98, 10]);
        transfer(&mut p, &[3, 0], 0);
        assert_eq!(transfer(&mut p, &[0x12], 1), [0]);
        p.on_input("set:voltage-mv=4100");
        p.on_input("set:usb=0");
        assert_eq!(transfer(&mut p, &[0x0e], 1), [89]);
        assert_eq!(transfer(&mut p, &[0x0b], 1), [0]);
        assert_eq!(transfer(&mut p, &[0x11], 1), [0]);
        transfer(&mut p, &[0x14, 0x80], 0);
        assert_eq!(transfer(&mut p, &[0x14], 1), [2]);
        transfer(&mut p, &[2, 0xc0], 0);
        assert_eq!(transfer(&mut p, &[2], 1), [0x40]);
    }
}
