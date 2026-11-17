import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Original, deterministic samples; no remote controls or real tag dumps.
export const nfcFixture = 'Filetype: Flipper NFC device\nVersion: 4\nDevice type: NTAG/Ultralight\nUID: 04 12 34 56 78 90 AB\nATQA: 00 44\nSAK: 00\nNTAG/Ultralight type: NTAG213\nPages total: 45\n' + Array.from({ length: 45 }, (_, page) => `Page ${page}: ${Array.from({ length: 4 }, (_, byte) => ((page * 4 + byte) & 255).toString(16).padStart(2, '0')).join(' ')}`).join('\n') + '\n';
export const irFixture = 'Filetype: IR signals file\nVersion: 1\n#\nname: W12 test\ntype: parsed\nprotocol: NEC\naddress: 34 00 00 00\ncommand: 12 00 00 00\n';
export const subFixture = (frequency, rate = 1200) => {
  const packet = [6, ...new TextEncoder().encode('w12-rx')];
  let crc = 0xffff;
  for (const byte of packet) { crc ^= byte << 8; for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x8005 : 0)) & 0xffff; }
  const bytes = [0xaa, 0xaa, 0xaa, 0xaa, 0x01, 0x23, ...packet, crc >> 8, crc & 255];
  const raw = bytes.flatMap(byte => Array.from({ length: 8 }, (_, bit) => (byte & (128 >> bit) ? 1 : -1) * Math.round(1_000_000 / rate)));
  return `Filetype: Flipper SubGhz RAW File\nVersion: 1\nFrequency: ${frequency}\nPreset: FuriHalSubGhzPresetOok650Async\nProtocol: RAW\nRAW_Data: ${raw.join(' ')}\n`;
};

export async function runScenario({ scenario, host, loop, pump, screenshot, getOutput }) {
  assert.ok(['radio', 'nfc', 'ir', 'leds'].includes(scenario), `Unknown SCENARIO ${scenario}`);
  const directory = resolve(process.env.SMOKE_ARTIFACTS ?? `D:/swarm-tmp/w12-smoke-${scenario}`);
  await mkdir(directory, { recursive: true });
  const state = name => host.states().find(part => part.name === name)?.values ?? {};
  const frameCount = () => Number(state('display').frames ?? 0);
  const frameBytes = () => new Uint8Array(host.framebuffer('display', false).rgba);
  const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
  const waitFor = async (condition, timeout, reason) => {
    await pump(timeout, condition);
    assert.ok(condition(), `${reason}; states=${JSON.stringify(host.states())}`);
  };
  const advanceSim = async milliseconds => {
    const target = host.timeNs('encoder') + BigInt(milliseconds) * 1_000_000n;
    await waitFor(() => host.timeNs('encoder') >= target, 30_000, `Simulation must advance ${milliseconds} ms`);
  };
  const tap = async (part = 'encoder') => { host.input(part, 'press'); await advanceSim(300); host.input(part, 'release'); await advanceSim(500); };
  const holdUntil = async (condition, reason) => {
    await advanceSim(500); // let firmware observe the previous release
    host.input('encoder', 'press');
    try { await waitFor(condition, 30_000, reason); }
    finally { host.input('encoder', 'release'); await advanceSim(500); }
  };
  console.log(`[scenario:${scenario}] waiting for factory startup screen`);
  await waitFor(() => frameCount() >= 3, Number(process.env.SMOKE_MS ?? 90_000), 'Factory startup screen did not appear');
  // Startup consumes the press event before entering Battery (0). A turn can
  // straddle that transition and leave a half-detent in the new menu.
  host.input('encoder', 'press');
  await waitFor(() => frameCount() >= 4, 30_000, 'Encoder did not dismiss factory startup');
  host.input('encoder', 'release'); await advanceSim(500);
  const menu = frameBytes();
  await screenshot(`${directory}/01-menu.png`);
  const detents = { radio: 0, ir: 1, nfc: 2, leds: 5 }[scenario];
  for (let i = 0; i < detents; i++) { host.input('encoder', 'cw'); await pump(450); }
  if (scenario === 'radio') await tap('key');
  console.log(`[scenario:${scenario}] menu: startup encoder press, ${detents} cw detents${scenario === 'radio' ? ', USER next' : ''}, encoder press`);
  await screenshot(`${directory}/02-selected.png`);
  await tap(); await pump(1500);
  assert.ok(!same(menu, frameBytes()), 'Opening the test must change the display');
  await screenshot(`${directory}/03-open.png`);

  if (scenario === 'radio') {
    await waitFor(() => Number(state('radio').freq_hz) > 100_000_000 && state('radio').chip_state === 'RX', 20_000, 'Radio firmware must initialize reception');
    const fixture = subFixture(Number(state('radio').freq_hz), Number(state('radio').data_rate));
    await writeFile(`${directory}/original.sub`, fixture); host.input('radio', `load-sub:${fixture}`);
    assert.equal(state('radio').last_error, '', 'Original .sub must parse');
    await waitFor(() => /bytes at .*CRC OK/.test(state('radio').last_rx), 10_000, 'Radio must receive the original synthetic packet');
    const before = Number(state('radio').tx_count);
    loop.uartInput(new TextEncoder().encode('send W12-RADIO\n'));
    await pump(1500);
    // The factory build's USB CDC command stream may not map to UART0.
    // Its encoder mode button is the primary, hardware-driven TX control.
    if (Number(state('radio').tx_count) === before) await tap();
    await waitFor(() => Number(state('radio').tx_count) > before, 20_000, 'Factory TX burst control must produce a real radio transmission');
    const retained = host.readExport({ part: 'radio', name: 'ebl_tx_count' });
    assert.ok(typeof retained === 'number' && retained > 0);
    const captured = host.readExport({ part: 'radio', name: 'ebl_tx_ptr', args: [retained - 1], lengthExport: 'ebl_tx_len' });
    assert.ok(captured instanceof ArrayBuffer);
    const text = new TextDecoder().decode(captured); assert.match(text, /Protocol: RAW/); assert.match(text, /RAW_Data:/);
    await writeFile(`${directory}/captured.sub`, text);
    // Replaying the firmware's own capture exercises its sync/CRC/rate settings.
    // RadioLib transmit blocks its button polling. Hold until acknowledged,
    // then traverse the actual RX -> TX-BURST -> SNIFF-OOK -> RX cycle.
    await holdUntil(() => state('radio').mode === 'async', 'Factory must switch TX-BURST to SNIFF-OOK');
    await holdUntil(() => state('radio').mode === 'packet' && state('radio').chip_state === 'RX', 'Factory must switch SNIFF-OOK back to packet RX');
    await waitFor(() => state('radio').chip_state === 'RX', 10_000, 'Radio must resume reception after TX');
    const beforeReplay = frameBytes(), previousRx = state('radio').last_rx;
    host.input('radio', `load-sub:${text}`);
    await waitFor(() => state('radio').last_rx !== previousRx && /bytes at .*CRC OK/.test(state('radio').last_rx), 10_000, 'Radio must receive the captured packet');
    await pump(1500);
    assert.ok(!same(beforeReplay, frameBytes()), 'Firmware must redraw after packet reception');
    console.log(`[scenario:radio] captures=${retained} last_rx=${state('radio').last_rx}`);
  } else if (scenario === 'nfc') {
    await writeFile(`${directory}/original.nfc`, nfcFixture);
    await waitFor(() => state('nfc').sam_configured === 'true', 20_000, 'Firmware must issue PN532 SAMConfiguration');
    host.input('nfc', `load-nfc:${nfcFixture}`); host.input('nfc', 'tag-present:0'); await pump(800);
    const absent = frameBytes(); host.input('nfc', 'tag-present:1');
    await waitFor(() => state('nfc').last_command === 'InListPassiveTarget' && !same(absent, frameBytes()), 15_000, 'Firmware must scan and redraw when the virtual tag appears');
    const dump = host.readExport({ part: 'nfc', name: 'ebl_dump_ptr', lengthExport: 'ebl_dump_len' });
    assert.ok(dump instanceof ArrayBuffer); const text = new TextDecoder().decode(dump);
    assert.match(text, /04 12 34 56 78 90 AB/); await writeFile(`${directory}/saved.nfc`, text);
    console.log(`[scenario:nfc] SAM=${state('nfc').sam_configured} command=${state('nfc').last_command} tag=${state('nfc').tag}`);
  } else if (scenario === 'ir') {
    await writeFile(`${directory}/original.ir`, irFixture);
    await pump(3000);
    if (Number(state('ir_tx').tx_count) === 0) { await tap(); await pump(3000); }
    await waitFor(() => Number(state('ir_tx').tx_count) > 0, 15_000, 'Factory IR test must drive the transmit LED');
    assert.ok(state('ir_tx').last_raw.includes('data:'), 'IR transmission must export raw timings');
    const raw = state('ir_tx').last_parsed || state('ir_tx').last_raw;
    await writeFile(`${directory}/captured.ir`, /^Filetype:/m.test(raw) ? raw : `Filetype: IR signals file\nVersion: 1\n#\n${raw}\n`);
    await tap(); await pump(1000); // TX AUTO -> RX LISTEN
    const before = frameBytes(), sent = Number(state('ir_rx').sent);
    host.input('ir_rx', `load-ir:${irFixture}`);
    await waitFor(() => Number(state('ir_rx').sent) > sent, 10_000, 'IR receiver must play the injected signal');
    assert.equal(state('ir_rx').last_error, '');
    await pump(1500);
    assert.ok(!same(before, frameBytes()), 'Firmware IR receive screen must react to injection');
    console.log(`[scenario:ir] TX=${state('ir_tx').tx_count} protocol=${state('ir_tx').last_protocol} RX=${state('ir_rx').sent} UART=${getOutput().slice(-300)}`);
  } else {
    await waitFor(() => Number(state('leds').frames) > 0 && /#(?!000000)[0-9a-f]{6}/i.test(state('leds').colors), 15_000, 'WS2812 firmware must produce a colored frame');
    const count = host.readExport({ part: 'leds', name: 'ebl_led_count' }); assert.equal(count, 8);
    const colors = host.readExport({ part: 'leds', name: 'ebl_led_ptr', byteLength: count * 4 });
    assert.ok(colors instanceof ArrayBuffer && new Uint8Array(colors).some((byte, i) => i % 4 !== 3 && byte > 0));
    await writeFile(`${directory}/colors.json`, JSON.stringify({ count, colors: state('leds').colors, frames: state('leds').frames }));
    console.log(`[scenario:leds] count=${count} frames=${state('leds').frames} colors=${state('leds').colors}`);
  }
  await screenshot(`${directory}/04-result.png`);
  await writeFile(`${directory}/result.json`, JSON.stringify({ scenario, states: host.states(), traffic: host.traffic, uart: getOutput() }, null, 2));
  console.log(`[scenario:${scenario}] PASS artifacts=${directory}`);
}
