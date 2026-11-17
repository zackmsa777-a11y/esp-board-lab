// Phase-0 spike: boot a merged ESP32 image on the esp-emu WASM build under Node.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [,, pkgDir, fwPath, chip = 'esp32s3', seconds = '10'] = process.argv;
const mod = await import(pathToFileURL(`${pkgDir}/esp_emu.js`).href);
await mod.default({ module_or_path: readFileSync(`${pkgDir}/esp_emu_bg.wasm`) });
const emu = new mod.WasmEmulator(chip);
emu.load_default_rom();
emu.load_firmware(new Uint8Array(readFileSync(fwPath)));
const t0 = Date.now(); let out = '';
while (Date.now() - t0 < Number(seconds) * 1000) {
  const o = emu.run_batch(200000);
  if (o) { process.stdout.write(o); out += o; }
  if (emu.faulted()) { console.log('\n[FAULT]', emu.fault_report()); break; }
}
console.log(`\n[spike] pc=0x${emu.pc().toString(16)} cycles=${emu.cycles()} wall=${Date.now()-t0}ms gpio=${JSON.stringify(emu.gpio_state())?.slice(0,200)}`);
