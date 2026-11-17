# WS2812

Original MIT OR Apache-2.0 GPIO receiver. Configure `DIN`; default eight LEDs.
`set:count=<1..1024>` resizes the chain. Watches every data-pin transition,
accepts 200..1000 ns high pulses and 900..1600 ns bit periods, classifies high
pulses at 600 ns, and latches after **more than** 50 us continuously low.
Bytes shift MSB first in GRB order. A malformed frame is discarded; complete
pixels update at latch and untouched pixels keep their previous value.

`count`, `frames`, and comma-separated `colors` are string state values.
`ebl_led_ptr()` points to `ebl_led_count() * 4` bytes of RGBA8 in wasm memory;
`ebl_led_seq()` increments per accepted latch. Copy the bytes before another
ABI call. Input/message buffer: 65536 bytes.

Host tests cover exact timings, tolerance, GRB, incomplete/malformed frames,
strict reset duration, consecutive frames, and configurable chain length.

Factory firmware integration: the supplied `tembed_factory.bin` identifies
itself as V1.1.0 (2026-10-09), matching LilyGO's `examples/factory` UI rather
than the older `examples/factory_test` example with `ws2812_init()`. No LED
frame appears at its startup screen. Entering the IR test initializes the
strip black; real RX/TX activity produces eight green `#001300` / blue
`#000013` pixels, then returns to black. GPIO14 watch events preserve
400/800 ns high times and approximately 1.25 us periods. Seven observed
frames correspond to 2689 transitions (initial low plus 7 * 192 * 2).
