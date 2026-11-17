import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The vendor directory is the single committed copy of these large assets.
function emulatorAssets(): Plugin {
  return {
    name: 'esp-emulator-assets',
    buildStart() {
      const destination = fileURLToPath(new URL('./public/esp-emu/', import.meta.url));
      mkdirSync(destination, { recursive: true });
      for (const file of ['esp_emu.js', 'esp_emu_bg.wasm']) {
        copyFileSync(fileURLToPath(new URL(`../vendor/esp-emu-wasm/pkg/${file}`, import.meta.url)), `${destination}/${file}`);
      }
      copyFileSync(fileURLToPath(new URL('../vendor/esp-emu-wasm/vendor/esp_cosim_pb.js', import.meta.url)), `${destination}/esp_cosim_pb.js`);
    },
  };
}

export default defineConfig({
  plugins: [emulatorAssets(), react()],
  server: {
    port: 1420, strictPort: true,
    // Cargo creates/locks executables here; watching them crashes Windows fs.watch.
    watch: { ignored: ['**/src-tauri/**'] },
  },
  clearScreen: false,
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
