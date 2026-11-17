import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { EmulatorLoop } from '../src/emu/loop.ts';

const vendor = new URL('../../vendor/esp-emu-wasm/pkg/', import.meta.url);
const wasm = await import(new URL('esp_emu.js', vendor));
await wasm.default({ module_or_path: await readFile(new URL('esp_emu_bg.wasm', vendor)) });
const firmware = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]))
  : new URL('../../vendor-dl/fw/tembed_factory.bin', import.meta.url);
const loop = new EmulatorLoop(wasm.WasmEmulator);
let output = '';
try {
  loop.load('esp32s3', new Uint8Array(await readFile(firmware)));
  loop.resume();
  const start = performance.now();
  while (performance.now() - start < 5_000 && loop.running) {
    const text = loop.slice();
    output += text;
    if (text) process.stdout.write(text);
  }
  const snapshot = loop.snapshot();
  assert.ok(output.includes('psramInit'), 'Expected factory firmware UART output to contain "psramInit"');
  console.log(`\n[smoke] PASS: psramInit found; wall=${Math.round(performance.now() - start)}ms pc=0x${snapshot.pc.toString(16)} cycles=${snapshot.cycles} faulted=${snapshot.faulted}`);
} finally { loop.dispose(); }
