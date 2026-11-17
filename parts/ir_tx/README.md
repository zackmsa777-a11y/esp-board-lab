# Infrared transmitter capture

Original MIT OR Apache-2.0 encoders/decoders and carrier demodulation.
Configure `LED`. Claims both `watch_pins` and `pwm_pins`, drives nothing.
Fast carrier edges are grouped into bursts; a low interval above 100 us ends
a burst and a space above 12 ms ends a frame. Carrier period and high time
are measured from a median window of edges (rejecting truncated final-pulse
bias) or read from `PwmState`. The SDK's `on_pwm` has no
timestamp, so changes are applied at the immediately following `poll(now)`.
The host must preserve that message timestamp. Edge messages are ignored
while a PWM summary describes the active carrier, avoiding double counting.

State: `tx_count`, `last_protocol`, `last_address`, `last_command`, `last_raw`,
`last_parsed`. Addresses/commands in state are hexadecimal integers. The raw
and parsed text includes a complete Flipper `.ir` header. Unknown frames are
retained as RAW. At most 1023 durations are captured per frame; excessive
frames are discarded. ABI buffer: 65536 bytes.

`src/protocol.rs` is shared by IR RX using a Rust path module. Supported:
NEC, NECext, Samsung32, RC5, RC6 mode 0, SIRC12/15/20 and Kaseikyo. Timings
are integer microseconds (562.5 us NEC units round to 563 us; a three-unit
space rounds to 1688 us). Manchester runs merge adjacent equal levels and
omit leading/trailing idle. Decoding tolerates oscillator and sampling error.
NEC validates inverse address/command bytes; Samsung validates duplicated
address and inverted command; Kaseikyo validates vendor nibble and XOR parity.

Flipper uses little-endian, space-separated hexadecimal bytes, not the
MSB-first integer representation commonly displayed by IRremoteESP8266.
NECext exposes both raw 16-bit address and command fields; an ordinary
extended NEC command 0x12 is written `12 ED 00 00`, including its inverse.
Kaseikyo's 26-bit address packs vendor bits 0..15, two genre nibbles in
16..23, and ID in 24..25; its command is ten bits. RC5/RC6 transmissions use
toggle zero, and their decoders accept either toggle.

The `.ir` parser accepts one block, optionally with the Version 1 file header;
multiple blocks or duplicate fields are rejected so the UI must select one.
Raw duration count and total duration are bounded (1024 entries, 30 seconds).
Inputs are validated before they replace a valid loaded signal.

Wire-format references (implementation is original, no library code copied):

- [Flipper file format](https://developer.flipper.net/flipperzero/doxygen/infrared_file_format.html)
- [Denon Kaseikyo wire format/code tables](https://assets.denon.com/DocumentMaster/DE/DNP720AE_SE_IR_CODE_V01.pdf)
- [Nationalchip RC6 protocol description](https://document.nationalchip.com/en/software/apus/%E8%8A%AF%E7%89%87%E6%A8%A1%E5%9D%97/%E5%A4%96%E8%AE%BE%E6%A8%A1%E5%9D%97/IR%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97/IR%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97/)

PWM summaries in this emulator are coalesced to one update per host quantum.
At the default 1 ms quantum, short carrier bursts may be lost or quantized;
timestamped edge streams are preferred for 562.5 us NEC symbols. This part
cannot reconstruct waveform changes the emulator never delivered.

Factory firmware verification uses `D:/swarm-tmp/w11-factory.mjs` (outside
the repository), importing the real app's `EmulatorLoop` and `PartHost` and
loading all ten board parts. The supplied V1.1.0 factory IR test sends NEC A
`0x20DF10EF`; the part decodes its wire bytes as NEC address `0x04`, command
`0x08`, and saves the corresponding `.ir`. The GPIO2 trace contains 2317
transitions for that transmission; no PWM summaries were delivered. This
is the observed software carrier, not an assumed nominal 38 kHz waveform.
The final firmware screenshot shows both TX and successful injected RX.
Artifacts: `D:/swarm-tmp/w11-{harness.log,trace.json,factory.png,uart.log}`.

Verification commands (set TEMP/TMP and CARGO_TARGET_DIR under D:, and
CARGO_HOME to D:/cargo-home):

```text
cargo test --manifest-path parts/Cargo.toml -p ws2812 -p ir_tx -p ir_rx
cargo clippy --manifest-path parts/Cargo.toml -p ws2812 -p ir_tx -p ir_rx --all-targets -- -D warnings
cargo build --manifest-path parts/Cargo.toml -p ws2812 -p ir_tx -p ir_rx --target wasm32-unknown-unknown --release
node app/node_modules/tsx/dist/cli.mjs D:/swarm-tmp/w11-factory.mjs
```

The harness sets SMOKE_MS=93000. Its conservative wall-time navigation is:
encoder press/release at 35/36 s, cw at 42 s (+2 menu entries), press/release
45/46 s and 64/65 s (the extra press accounts for menu initialization under
load), inject NEC at 60 s, repeat twice at 67.5 s, press/release at 79/80 s
to transmit, repeat once at 84.5 s. The screenshot, rather than wall time or
part counters alone, confirms the IR page was reached and signals received.
