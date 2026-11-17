# CC1101 virtual radio

Original MIT OR Apache-2.0 implementation of the digital interface in TI
[CC1101 SWRS061I](https://www.ti.com/lit/ds/symlink/cc1101.pdf), especially
sections 10, 15, 19, 26, 27 and 29. Crystal frequency is 26 MHz.

Wire CS/SCK/MOSI/MISO and optionally GDO0/GDO2/SW0/SW1. SPI handles a header
and payload in one transfer or split across transfers while software CS stays
low. The burst flag distinguishes read-only status registers from command
strobes. PATABLE and the separate 64-byte FIFOs support bursts. Calibration
is a deterministic 800 us transition; sleep/XOFF take effect when CS rises.

Packet TX adds preamble, sync, CRC-16 (polynomial 0x8005, initial 0xffff),
optional PN9 whitening and Manchester coding, then records baseband levels
at the programmed bit rate. RX samples injected RAW pulses at that rate,
checks the configured 16/32-bit sync with the selected tolerance, reverses
coding/whitening, applies packet length/address/CRC filtering and appends
RSSI/LQI status when configured. GDO functions include FIFO thresholds,
sync/end of packet, CRC OK, carrier sense and lock. RSSI uses the typical
74 dB offset; injected signals default to -40 dBm.

Async serial TX watches MCU transitions on GDO0 while in TX and saves on
leaving TX. Async RX drives whichever GDO pins use IOCFG 0x0d. Timings are
scheduled in advance with a 5 ms lookahead and at most 32 outstanding edge
timestamps, for use with the host's bounded poll drain. Signals outside the
current channel filter's half-bandwidth stay queued.
Very dense streams whose 32-edge horizon is shorter than the host heartbeat
need a smaller host quantum to prevent late scheduling.

GDO0 and GDO2 have fixed drive claims and transition watches. The ABI's drive
claim excludes other *parts*, not the MCU's ability to configure the pin as
an output. No GPIO drive is emitted on GDO0 during async TX; only RX serial
outputs and configured packet-status outputs are driven. The ABI has no
dynamic claim/release operation. Already submitted future edges cannot be
cancelled; an idle/clear operation can therefore leave up to 5 ms of queued
serial RX edges in the core.

Inputs and state keys follow the SWARM contract. `load-sub:` accepts RAW
and Princeton Key/Bit/TE files. CAME, Nice FLO and other keyed protocols
are rejected with `last_error`. RAW durations must be nonzero, at most
10 seconds each, and there may be up to 16,384 pulses per signal and 32
queued signals. Captures export standard RAW .sub text with at most 512
values per RAW_Data line. The ABI buffer is 256 KiB, which fits bounded
captures and also avoids the default wasm stack overflow from a 1 MiB Part.

`ebl_tx_count()` is the number of **retained** captures, at most 16.
`ebl_tx_ptr(i)` / `ebl_tx_len(i)` give UTF-8 text in oldest-first order for
`0 <= i < count`; invalid indices return zero. Pointers are valid until a
subsequent mutating call. State `tx_count` is the lifetime total, while
`last_tx` is the latest complete file.

This is a baseband digital model. It does not simulate analog noise,
frequency deviation, Gaussian pulse shaping, RF collisions, FEC/interleaving,
synchronous serial mode, continuous random TX or periodic wake-on-radio
timers. 4-FSK/MSK settings decode for state inspection; packet captures use
binary baseband timing rather than a multilevel RF waveform. Streaming
packets exceeding FIFO capacity and FIFO refilling mid-transmission are
not modeled. Packet reception buffers a complete signal before publishing
its FIFO data. Calibration has observable start/end states rather than
every analog substate. `SWOR` enters RX; `SWORRST` is accepted as a no-op.

Run `cargo test -p cc1101` and
`cargo clippy -p cc1101 --all-targets -- -D warnings` inside `parts/`.
Build and publish with `node scripts/build-parts.mjs` at the repository root.

## Real firmware validation

Tested the supplied `tembed_factory.bin` (SHA256
`ef1dd1183e2588877ac5152c3cf0009104a09eb4b1497a9e71d74753967d676b`)
through the real `app/src/emu/parts/host.ts` with all ten T-Embed parts.
Harness and artifacts are outside the repository at
`D:/swarm-tmp/w9-cc1101-harness.mjs` and `w9-cc1101-result.json`.

Navigation waits for startup's third display frame, turns the encoder once
to dismiss startup, waits for the menu frame, taps USER once to select
Radio (index 1), then taps the encoder to open it. Simulated-time waits
avoid early inputs under concurrent emulator load. Once Radio is open,
another encoder tap switches RX to TX BURST.

Factory RadioLib read VERSION 0x14 at address 0x31; it did **not** read
PARTNUM in this initialization path. Register writes include FREQ2..0 =
10 B0 71, MDMCFG4 = F5, MDMCFG3 = 83, MDMCFG2 = 32, SYNC1/0 = 01 23,
and PKTCTRL0 = 05. Result: 433,919,830 Hz, ASK/OOK, 1,199.484 bit/s,
58.036 kHz bandwidth, packet RX.

An original RAW signal carrying `w9-radio-rx` with the configured sync,
length and CRC reached the firmware: the display showed the payload,
RSSI -40 dBm, and RX count 1. The model reported 14 FIFO bytes and CRC OK.
The encoder-controlled TX BURST produced 30 captures during the 80-second
run; the last 16 were fetched through `ebl_tx_*` and saved as .sub files.
All parts remained ready without errors and the CPU did not fault.
Screenshots are `w9-frame-25000.png` (RX) and `w9-frame-35000.png` (TX).

`D:/swarm-tmp/w9-verify.mjs` separately instantiates the final rebuilt wasm,
replays one firmware capture, and checks CRC OK and decoded payload
`T-Embed CC1101 #14`. It also verifies retained/lifetime capture counts and
valid/invalid export indices. UART `send` injection alone did not transmit
in this setup; the successful TX proof uses the real encoder mode control.
