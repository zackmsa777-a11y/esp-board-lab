//! Demodulated IR receiver output. SPDX-License-Identifier: MIT OR Apache-2.0
use esp_part::prelude::*;
use std::collections::VecDeque;
// One original codec implementation for both parts; no dependency on the TX ABI.
#[path = "../../ir_tx/src/protocol.rs"]
pub mod protocol;
use protocol::{parse, Signal};

const LOOKAHEAD_NS: u64 = 5_000_000;
struct Playback {
    signal: Signal,
    repeats: u32,
    index: usize,
    next: u64,
    completed_at: Option<u64>,
}
#[derive(Default)]
struct IrRx {
    pin: Option<u32>,
    initialized: bool,
    queue: VecDeque<(Signal, u32)>,
    playing: Option<Playback>,
    loaded: Option<Signal>,
    sent: u32,
    last_sent: String,
    last_error: String,
    scheduled: VecDeque<u64>,
}
impl IrRx {
    fn enqueue(&mut self, signal: Signal, count: u32) {
        if self.queue.len() >= 16 {
            self.last_error = "receiver queue full".into();
            return;
        }
        self.queue.push_back((signal, count));
        self.last_error.clear();
    }
}
impl Device for IrRx {
    const NAME: &'static str = "ir_rx";
    fn configure(&mut self, config: &PartConfig) {
        self.pin = config.pins.get("OUT").copied().filter(|p| *p < 64);
    }
    fn claims(&self) -> Vec<Claim> {
        self.pin.map(|p| drives(1 << p)).into_iter().collect()
    }
    fn on_input(&mut self, input: &str) {
        if let Some(text) = input.strip_prefix("load-ir:") {
            match parse(text) {
                Ok(signal) => {
                    self.loaded = Some(signal.clone());
                    self.enqueue(signal, 1);
                }
                Err(error) => self.last_error = error,
            }
        } else if let Some(count) = input.strip_prefix("repeat:") {
            match (count.parse::<u32>(), self.loaded.clone()) {
                (Ok(n), Some(signal)) if (1..=100).contains(&n) => self.enqueue(signal, n),
                _ => self.last_error = "repeat needs a loaded signal and count 1..100".into(),
            }
        }
    }
    fn poll(&mut self, now: u64) -> Option<EmulatorMessage> {
        let pin = self.pin?;
        while self.scheduled.front().is_some_and(|at| *at <= now) {
            self.scheduled.pop_front();
        }
        if !self.initialized {
            self.initialized = true;
            return Some(drive(pin, true, now));
        }
        if let Some(play) = &mut self.playing {
            if let Some(end) = play.completed_at {
                if now < end {
                    return None;
                }
                self.sent = self.sent.wrapping_add(1);
                self.last_sent = play.signal.name.clone();
                if play.repeats > 1 {
                    play.repeats -= 1;
                    play.index = 0;
                    play.next = end + 40_000_000;
                    play.completed_at = None;
                } else {
                    self.playing = None;
                }
            }
        }
        if self.playing.is_none() {
            let (signal, repeats) = self.queue.pop_front()?;
            self.playing = Some(Playback {
                signal,
                repeats,
                index: 0,
                next: now + 1_000_000,
                completed_at: None,
            });
        }
        let play = self.playing.as_mut()?;
        if play.completed_at.is_some()
            || play.next > now.saturating_add(LOOKAHEAD_NS)
            || self.scheduled.len() >= 32
        {
            return None;
        }
        // A bounded-draining host calls poll repeatedly until None. Only a small
        // window is queued ahead, capped at 32 edges; future events keep their
        // original absolute timestamps. Extremely short raw pulses also need a
        // sufficiently small host quantum; surface underruns rather than hide them.
        let at = play.next;
        if at < now {
            self.last_error = "playback timing underrun: reduce host quantum".into();
        }
        let high = play.index % 2 == 1 || play.index == play.signal.data.len();
        if let Some(duration) = play.signal.data.get(play.index) {
            play.next += u64::from(*duration) * 1000;
            play.index += 1;
        } else {
            play.completed_at = Some(at);
        }
        self.scheduled.push_back(at);
        Some(drive(pin, high, at))
    }
    fn state(&self) -> Option<State> {
        Some(
            State::new()
                .set("sent", self.sent)
                .set("last_sent", &self.last_sent)
                .set("last_error", &self.last_error),
        )
    }
}
esp_part::export_part!(IrRx, buffer = 65536);

#[cfg(test)]
mod tests {
    use super::*;
    use esp_part::Payload;
    fn part() -> IrRx {
        let mut p = IrRx::default();
        p.configure(&PartConfig {
            pins: [("OUT".into(), 1)].into(),
            ..Default::default()
        });
        p
    }
    fn collect(p: &mut IrRx, end: u64) -> Vec<(u64, bool)> {
        let mut edges = Vec::new();
        for now in (0..end).step_by(1_000_000) {
            for _ in 0..64 {
                let Some(msg) = p.poll(now) else {
                    break;
                };
                if let Some(Payload::GpioDrive(d)) = msg.payload {
                    assert_eq!(d.pin, 1);
                    assert!(msg.sim_time_ns >= now, "late event");
                    edges.push((msg.sim_time_ns, d.level));
                }
            }
        }
        edges
    }
    #[test]
    fn schedules_nec_exactly_idle_high_and_mark_low() {
        let mut p = part();
        p.on_input("load-ir:name: test\ntype: parsed\nprotocol: NEC\naddress: 42 00 00 00\ncommand: 17 00 00 00");
        let edges = collect(&mut p, 100_000_000);
        assert_eq!(edges[0], (0, true));
        assert_eq!(edges[1], (1_000_000, false));
        assert_eq!(edges[2], (10_000_000, true));
        assert_eq!(edges[3], (14_500_000, false));
        assert_eq!(p.sent, 1);
        assert_eq!(p.last_sent, "test");
        assert!(edges.last().unwrap().1);
        let data = edges[1..]
            .windows(2)
            .map(|w| ((w[1].0 - w[0].0) / 1000) as u32)
            .collect::<Vec<_>>();
        assert_eq!(protocol::decode(&data).unwrap().command, 0x17);
    }
    #[test]
    fn repeat_and_errors_do_not_destroy_valid_playback() {
        let mut p = part();
        p.on_input("repeat:2");
        assert!(!p.last_error.is_empty());
        p.on_input(
            "load-ir:name: raw\ntype: raw\nfrequency: 38000\nduty_cycle: 0.33\ndata: 600 600 1200",
        );
        p.on_input("repeat:2");
        p.on_input("load-ir:type: garbage");
        assert!(!p.last_error.is_empty());
        let edges = collect(&mut p, 200_000_000);
        assert_eq!(p.sent, 3);
        assert_eq!(edges.iter().filter(|e| !e.1).count(), 6);
    }
}
