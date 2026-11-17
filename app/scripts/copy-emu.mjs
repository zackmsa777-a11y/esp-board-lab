import { copyFile, mkdir } from 'node:fs/promises';
const destination = new URL('../public/esp-emu/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const file of ['esp_emu.js', 'esp_emu_bg.wasm']) {
  await copyFile(new URL(`../../vendor/esp-emu-wasm/pkg/${file}`, import.meta.url), new URL(file, destination));
}
await copyFile(new URL('../../vendor/esp-emu-wasm/vendor/esp_cosim_pb.js', import.meta.url), new URL('esp_cosim_pb.js', destination));
