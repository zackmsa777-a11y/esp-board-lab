import { EmulatorLoop, type EmulatorConstructor } from './loop';
import type { WorkerCommand, WorkerEvent } from './protocol';

const host = self as unknown as {
  postMessage(message: WorkerEvent): void;
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null;
};
const send = (event: WorkerEvent) => host.postMessage(event);
let loop: EmulatorLoop | undefined;
let lastStatus = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const status = () => {
  const snapshot = loop?.snapshot();
  if (snapshot) send({ type: 'status', status: snapshot });
  lastStatus = performance.now();
};
const report = (error: unknown) => {
  loop?.pause();
  clearTimeout(timer); timer = undefined;
  send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  status();
};

function tick() {
  timer = undefined;
  try {
    const text = loop?.slice();
    if (text) send({ type: 'uart', text });
    if (performance.now() - lastStatus >= 150 || !loop?.running) status();
    if (loop?.running) timer = setTimeout(tick, 0);
  } catch (error) { report(error); }
}

const ready = (async () => {
  // Runtime URL: Vite copies the vendor assets to public; it must not bundle a
  // second WASM copy or rewrite wasm-bindgen's sibling URL resolution.
  const url = new URL('/esp-emu/esp_emu.js', self.location.origin).href;
  const module = await import(/* @vite-ignore */ url) as {
    default: () => Promise<unknown>; WasmEmulator: EmulatorConstructor;
  };
  await module.default();
  loop = new EmulatorLoop(module.WasmEmulator);
  send({ type: 'ready' });
})();
// Queue commands during initialization and serialize loads with subsequent input.
let commands = ready;
host.onmessage = ({ data }) => {
  commands = commands.then(() => {
    if (!loop) throw new Error('The emulator could not initialize. Restart the app.');
    switch (data.type) {
      case 'load':
        clearTimeout(timer); timer = undefined;
        loop.load(data.chip, new Uint8Array(data.firmware));
        send({ type: 'loaded' }); status(); break;
      case 'resume':
        loop.resume();
        if (timer === undefined) tick();
        break;
      case 'pause':
        loop.pause(); clearTimeout(timer); timer = undefined; status(); break;
      case 'reset':
        clearTimeout(timer); timer = undefined; loop.reset(); status(); break;
      case 'uart_input': loop.uartInput(data.data); break;
    }
  }).catch(report);
};
void ready.catch(report);
