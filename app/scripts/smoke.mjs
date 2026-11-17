import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { EmulatorLoop } from '../src/emu/loop.ts';
import { PartHost } from '../src/emu/parts/host.ts';
import pb from '../../vendor/esp-emu-wasm/vendor/esp_cosim_pb.js';
import { runScenario } from './scenarios.mjs';

const vendor = new URL('../../vendor/esp-emu-wasm/pkg/', import.meta.url);
const wasm = await import(new URL('esp_emu.js', vendor));
await wasm.default({ module_or_path: await readFile(new URL('esp_emu_bg.wasm', vendor)) });
const firmware = process.argv[2] ? pathToFileURL(resolve(process.argv[2])) : new URL('../../vendor-dl/fw/tembed_factory.bin', import.meta.url);
const board = JSON.parse(await readFile(new URL('../public/boards/tembed-cc1101-plus/board.json', import.meta.url), 'utf8'));
const profile = JSON.parse(await readFile(new URL('../public/boards/tembed-cc1101-plus/profile.json', import.meta.url), 'utf8'));
const loop = new EmulatorLoop(wasm.WasmEmulator);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(frame, rotation) {
  const rotate = ((rotation % 360) + 360) % 360;
  const width = rotate % 180 ? frame.height : frame.width, height = rotate % 180 ? frame.width : frame.height;
  const input = new Uint8Array(frame.rgba), rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    const [dx, dy] = rotate === 90 ? [frame.height - 1 - y, x] : rotate === 180 ? [frame.width - 1 - x, frame.height - 1 - y] : rotate === 270 ? [y, frame.width - 1 - x] : [x, y];
    rgba.set(input.subarray((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4), (dy * width + dx) * 4);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}
try {
  loop.load(profile.chip, new Uint8Array(await readFile(firmware)));
  const host = new PartHost(loop.machine, pb.esp_cosim.v1);
  loop.parts = host;
  await host.attach(board, async module => new Uint8Array(await readFile(new URL(`../public/parts/${module}`, import.meta.url))));
  console.log('[smoke] attached:', JSON.stringify(host.states()));
  assert.ok(host.states().every(part => part.ready && !part.error), 'Every board part must register');
  host.input('gauge', 'set:percent=73'); host.input('charger', 'set:percent=73');
  loop.resume();
  let output = '', nextLog = 5000, controlStage = 0;
  const start = performance.now();
  const scenario = process.env.SCENARIO;
  const screenshot = async destination => {
    const frame = host.framebuffer(profile.display.part, false);
    if (frame) { await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, png(frame, profile.display.rotate)); }
  };
  const pump = async (duration, until = () => false) => {
    const began = performance.now();
    while (performance.now() - began < duration && loop.running && !until()) {
      output += loop.slice();
      const delay = Math.min(20, loop.machine.throttle_delay_ms(performance.now()));
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    }
    assert.equal(loop.snapshot().faulted, false, loop.snapshot().fault_report ?? 'CPU fault');
  };
  if (scenario) {
    try { await runScenario({ scenario, host, loop, pump, screenshot, getOutput: () => output }); }
    catch (error) {
      const directory = process.env.SMOKE_ARTIFACTS ?? `D:/swarm-tmp/w12-smoke-${scenario}`;
      await screenshot(`${directory}/failure.png`);
      await writeFile(`${directory}/failure.json`, JSON.stringify({ error: String(error), states: host.states(), uart: output, snapshot: loop.snapshot() }, null, 2));
      throw error;
    }
  }
  const duration = Number(process.env.SMOKE_MS ?? 20_000);
  while (!scenario && performance.now() - start < duration && loop.running) {
    output += loop.slice();
    const elapsed = performance.now() - start;
    if (elapsed >= nextLog) { console.log(`[smoke] wall=${Math.round(elapsed)}ms traffic=${JSON.stringify(host.traffic)} display=${JSON.stringify(host.states().find(part => part.name === 'display'))}`); nextLog += 5000; }
    if (controlStage === 0 && elapsed > 12_000) { host.input('encoder', 'press'); controlStage++; }
    if (controlStage === 1 && elapsed > 12_250) { host.input('encoder', 'release'); controlStage++; }
    if (controlStage === 2 && elapsed > 14_000) { host.input('key', 'press'); controlStage++; }
    if (controlStage === 3 && elapsed > 14_250) { host.input('key', 'release'); controlStage++; }
    if (controlStage === 4 && elapsed > 16_000) { host.input('encoder', 'cw'); controlStage++; }
    if (controlStage === 5 && elapsed > 24_000) { host.input('encoder', 'press'); host.input('key', 'press'); controlStage++; }
    if (controlStage === 6 && elapsed > 27_000) { host.input('encoder', 'release'); host.input('key', 'release'); controlStage++; }
    const delay = Math.min(20, loop.machine.throttle_delay_ms(performance.now()));
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  }
  const snapshot = loop.snapshot(), states = host.states();
  console.log(output.slice(-4000));
  console.log('[smoke] parts:', JSON.stringify(states));
  console.log(`[smoke] I2C=${host.traffic.i2c} SPI=${host.traffic.spi} GPIO=${host.traffic.gpio}`);
  assert.equal(snapshot.faulted, false, snapshot.fault_report ?? 'CPU fault');
  assert.ok(states.every(part => !part.error), 'No part may fail during execution');
  assert.ok(Number(states.find(part => part.name === 'display').values.frames) > 0, 'Display must see RAMWR traffic');
  const frame = host.framebuffer(profile.display.part, false);
  assert.ok(frame, 'Display must export a framebuffer');
  const pixels = new Uint32Array(frame.rgba);
  assert.ok(pixels.some(pixel => pixel !== pixels[0]), 'Framebuffer must contain more than one color');
  const destination = process.env.SMOKE_PNG ?? 'D:/swarm-tmp/tembed-frame.png';
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, png(frame, profile.display.rotate));
  console.log(`[smoke] PASS wall=${Math.round(performance.now() - start)}ms pc=0x${snapshot.pc.toString(16)} cycles=${snapshot.cycles} colors=${new Set(pixels).size} PNG=${destination}`);
} finally { loop.dispose(); }
