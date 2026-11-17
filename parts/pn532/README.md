# PN532 virtual part

Original MIT OR Apache-2.0 implementation of the PN532 V1.6 I2C host
interface and the PN532 contract in the wave 4 SWARM.md. No firmware/library
implementation code was copied.

Sources:

- [NXP UM0701-02, revision 02](https://www.nxp.com/docs/en/user-guide/141520.pdf):
  host frame formats/checksums, I2C RDY, ACK/NACK/error frames, firmware identity,
  register/configuration and initiator commands, error statuses.
- [NXP NTAG213/215/216](https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf):
  page capacities, READ wraparound, WRITE/COMPATIBILITY WRITE, GET_VERSION,
  FAST_READ, READ_SIG and password command data.
- [NXP MIFARE Classic EV1 1K](https://www.nxp.com/docs/en/data-sheet/MF1S50YYX_V1.pdf)
  and [4K](https://www.nxp.jp/docs/en/data-sheet/MF1S70YYX_V1.pdf):
  sector/block/trailer layout and key A/B authentication.
- [NXP MIFARE Ultralight](https://www.nxp.com/docs/en/data-sheet/MF0ICU1.pdf):
  16 four-byte pages.
- [Flipper's published file format documentation](https://developer.flipper.net/flipperzero/doxygen/nfc_file_format.html):
  text field names and version-dependent ATQA byte order. Documentation was
  consulted for interoperability; no Flipper source code is included.

## Interface

I2C defaults to 7-bit address `0x24`, with configured `SCL`, `SDA`, `IRQ`
(active low output), and `RST` (active low input). Reset holds the I2C device
unavailable and discards pending protocol state, but retains the virtual tag
and its EEPROM. IRQ is low while ACK, response, NACK or error data is ready;
it returns high after the queued frames are consumed. Status-only reads do
not consume frame data. The ABI `I2cTransaction.continues` flag means another
piece of the same physical read: **RDY occurs only on the first piece**.

Inputs:

- `load-nfc:<text>` loads and places a tag. Invalid input leaves the old tag intact.
- `tag-present:0` removes the tag; `tag-present:1` places the loaded tag.
- `tag-clear` unloads the tag.

State values are strings: `firmware`, `sam_configured`, `field`, `tag`,
`last_command`, `reads`, `writes`, `auths_ok`, `auths_failed`, `last_error`.
`field` is `on` or `off`; `tag` is a type and UID or `none`.

Extra wasm exports `ebl_dump_ptr()` and `ebl_dump_len()` describe UTF-8 text
for the current dump, including writes. The pointer remains valid until the
next load/clear/write; copy the bytes immediately after reading ptr/len.
Removing a tag leaves its dump available for saving. The ABI buffer is 65536
bytes, enough for a complete Classic 4K text dump.

The parser supports current `Device type: NTAG/Ultralight`, legacy
`Mifare Ultralight`, direct NTAG203/213/215/216 types, Classic 1K/4K, and
ISO14443-3A UID-only tags. Pages/blocks not supplied remain unknown. `??`
bytes survive serialization; RF reads of unknown bytes return zero and
unknown keys never authenticate. Keys come from sector trailers. Output is
canonical version 4 text with MSB-first ATQA; version 1/2 input ATQA is
normalized. NTAG page totals are 42/45/135/231 respectively.

## Deliberate scope limits

This is a host/EEPROM model, with one Type A target and one authenticated
Classic sector at a time. It does not simulate RF waveforms, Crypto1,
multiple tags, timing/retries, Classic access bits or value operations,
NTAG lock/OTP enforcement, or actual NFC target emulation. PWD_AUTH accepts
any password as required by the contract, returning the dump's PACK bytes;
READ_SIG uses `Signature` or a deterministic zero signature. Target init
returns timeout status `01`, rather than waiting indefinitely. InList with
no tag returns zero targets. RF exchanges without a selected/present tag
return `01`; wrong Classic keys return `14`.

FAST_READ returns all requested valid pages using an extended frame when
needed, including responses beyond the physical PN532's small RF buffer;
this intentionally supports full virtual tag dumps. Host command frames
are limited to 264 data bytes. Ultralight and NTAG203 do not advertise a
fabricated NTAG21x GET_VERSION identity. Nonessential imported counter,
tearing and version metadata is canonicalized on save; the EEPROM,
signature, UID, ATQA, SAK and tag type are preserved.

## Verification

From `parts/`, with `TEMP=TMP=D:\swarm-tmp` and `CARGO_HOME=D:\cargo-home`:

```text
cargo test -p pn532
cargo clippy -p pn532 --all-targets -- -D warnings
cargo build -p pn532 --target wasm32-unknown-unknown --release
```

Host tests cover frame checksums and truncation (normal and extended),
ACK/NACK/error frames, RDY and continued physical reads, IRQ/reset,
every required PN532 command, no-tag operation, Classic A/B right/wrong
key authentication and 4K sector boundaries, read/write/trailer changes,
NTAG read/write/version/signature/fast/password/compatibility operations,
all supported tag file round trips, unknown bytes, malformed uploads,
presence/removal, and current/legacy ATQA ordering.

Factory firmware harness and original NTAG215 fixture are kept outside the
repository at `D:\swarm-tmp\w10-pn532-factory.mjs` and
`D:\swarm-tmp\w10-original-ntag215.nfc`. The harness imports the real
`app/src/emu/parts/host.ts` and `loop.ts`, loads `tembed_factory.bin`, and
records raw I2C transactions and PN532 commands in
`D:\swarm-tmp\w10-factory-result.json`, plus framebuffer PNGs.

Observed factory result (2026-11-17): all ten board parts registered, no
CPU fault, no part errors. Boot performed an empty I2C address probe of
`0x24`; it sent no PN532 commands. Navigation opened PN532 NFC (menu entry
5/12, zero-based index 4): encoder press at wall 12 s, release at 15 s,
`cw` at 32 s and 42 s, press at 55 s, release at 60 s. A full detent advances
two menu entries in this firmware. The NFC hardware probe/test then sent:

```text
SAMConfiguration 14 01 14 01     (probe wake-up)
GetFirmwareVersion 02
SAMConfiguration 14 01 14 01
SAMConfiguration 14 01 14 01     (NFC page wake-up)
GetFirmwareVersion 02
SAMConfiguration 14 01 14 01
RFConfiguration 32 05 FF 01 FF
InListPassiveTarget 4A 01 00     (repeated polling)
```

The 105-second run recorded 4 SAMConfiguration, 2 GetFirmwareVersion,
1 RFConfiguration and 2740 InListPassiveTarget commands. The framebuffer
`D:\swarm-tmp\w10-frame-75000.png` shows `CARD FOUND`, UID
`04 10 20 30 40 50 60`, `ISO14443A 7B UID`, and `PN532 FW 1.6`.
Final NFC state has `sam_configured=true`, `field=on`, and no error.
The factory page identifies the tag by its UID, without issuing memory
read/write commands or GET_VERSION; those operations were verified by host
unit tests, not by this factory firmware run. Earlier failed runs and the
continued-read fix are retained as separate temporary JSON files.
