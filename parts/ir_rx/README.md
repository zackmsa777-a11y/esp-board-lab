# Infrared receiver

Original MIT OR Apache-2.0 demodulated, active-low IR receiver. Configure
`OUT`; claims exclusive drive on that pin and initially drives idle HIGH.

- `load-ir:<one signal block>` validates and queues one Flipper parsed/raw
  signal. Parsed protocols and field conventions are documented in
  [IR TX](../ir_tx/README.md). A failed upload leaves valid playback intact.
- `repeat:<1..100>` queues the last loaded signal that many additional times.
  Repeated signals have a 40 ms idle gap. Up to sixteen jobs may wait.
- State strings: `sent` (completed playback count), `last_sent` (signal name),
  `last_error` (validation/queue/timing error).

Edges use absolute future `GpioDrive` timestamps. A frame starts 1 ms after
the poll that begins its job. Scheduling is limited to 5 ms ahead and 32
outstanding edges, sharing the emulator queue with other devices. The host
must drain `part_poll(now)` until it returns zero, with a finite per-event
cap (the app uses 64); each subsequent call uses the same `now`. A host that
polls only once per 1 ms heartbeat cannot sustain common IR symbols. GPIO
watch messages deliberately exclude levels driven by parts, so watching
OUT does not provide a scheduling clock.

Common protocol timings work with a 1 ms heartbeat. Very short raw timings
may require a smaller host quantum; a timing underrun is reported in state.
`sent` proves edges were scheduled and their emulated end time passed; it
does not prove firmware decoded them. The emulator's ClockSync late/drop
counters must also be checked in firmware integration tests.

ABI buffer: 65536 bytes. Host tests check idle polarity, exact NEC scheduled
timestamps and re-decoding, repeats, parser errors, all shared codecs and
Flipper parse/write round trips.
