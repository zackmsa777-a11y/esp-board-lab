import { EmulatorLoop, type EmulatorConstructor } from './loop';
import type { WorkerCommand, WorkerEvent } from './protocol';
import { PartHost } from './parts/host';

const host = self as unknown as {
  postMessage(message: WorkerEvent, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null;
};
const send = (event: WorkerEvent) => host.postMessage(event);
let loop: EmulatorLoop | undefined;
let lastStatus = 0;
let lastParts = 0;
let lastFrame = 0;
let displayPart: string | undefined;
let codec: unknown;
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
    const now = performance.now();
    if (loop?.parts && now - lastParts >= 250) {
      send({ type: 'parts', parts: loop.parts.states(), traffic: loop.parts.traffic }); lastParts = now;
    }
    if (loop?.parts && displayPart && now - lastFrame >= 1000 / 30) {
      const frame = loop.parts.framebuffer(displayPart);
      if (frame) host.postMessage({ type: 'frame', frame }, [frame.rgba]);
      lastFrame = now;
    }
    if (performance.now() - lastStatus >= 150 || !loop?.running) status();
    if (loop?.running) timer = setTimeout(tick, Math.min(20, Math.max(0, loop.machine.throttle_delay_ms(performance.now()))));
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
  const codecUrl = new URL('/esp-emu/esp_cosim_pb.js', self.location.origin).href;
  codec = (await import(/* @vite-ignore */ codecUrl)).default.esp_cosim.v1;
  loop = new EmulatorLoop(module.WasmEmulator);
  send({ type: 'ready' });
})();
// Queue commands during initialization and serialize loads with subsequent input.
let commands = ready;
host.onmessage = ({ data }) => {
  commands = commands.then(async () => {
    if (!loop) throw new Error('The emulator could not initialize. Restart the app.');
    switch (data.type) {
      case 'load':
        clearTimeout(timer); timer = undefined;
        loop.load(data.chip, new Uint8Array(data.firmware));
        loop.parts = new PartHost(loop.machine, codec);
        await loop.parts.attach(data.board, async module => {
          const response = await fetch(`/parts/${module}`, { cache: 'no-cache' });
          if (!response.ok) throw new Error(`${module}: HTTP ${response.status}`);
          return new Uint8Array(await response.arrayBuffer());
        });
        displayPart = data.profile.display?.part; lastFrame = 0; lastParts = 0;
        send({ type: 'parts', parts: loop.parts.states(), traffic: loop.parts.traffic });
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
      case 'part_input':
        try {
          if (!loop.parts) throw new Error('Load firmware before sending part inputs.');
          loop.parts.input(data.part, data.input);
          send({ type: 'input-result', requestId: data.requestId });
        } catch (error) { send({ type: 'input-result', requestId: data.requestId, error: error instanceof Error ? error.message : String(error) }); }
        if (loop.parts) send({ type: 'parts', parts: loop.parts.states(), traffic: loop.parts.traffic });
        break;
      case 'read-export':
        try {
          if (!loop.parts) throw new Error('Load firmware before reading part exports.');
          const value = loop.parts.readExport(data.request);
          host.postMessage({ type: 'export-result', requestId: data.requestId, value }, value instanceof ArrayBuffer ? [value] : []);
        } catch (error) { send({ type: 'export-result', requestId: data.requestId, error: error instanceof Error ? error.message : String(error) }); }
        break;
    }
  }).catch(report);
};
void ready.catch(report);
