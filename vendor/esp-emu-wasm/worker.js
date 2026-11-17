// Web Worker running the emulation loop
// Communicates with main thread via postMessage

let wasm = null;
let emulator = null;
let running = false;
let batchSize = 50000;
let pendingLoad = null;
// The esp-emu-relay URL; each new emulator gets it again.
let relayUrl = '';
let lastRelayState = '';

// Live-view state: how often a snapshot (registers, GPIO, watched memory)
// goes to the page while running, and which memory window it follows.
const SNAPSHOT_INTERVAL_MS = 150;
let lastSnapshot = 0;
let memWatch = null; // { addr, len } or null

// Starts the next slice with no wait; a nested setTimeout(0) waits at least 4 ms.
const nextSlice = new MessageChannel();
nextSlice.port1.onmessage = () => runLoop();

// Global error handler — catches WASM panics and unhandled exceptions
self.onerror = function(msg, src, line, col, err) {
    postMessage({ type: 'error', message: `Worker error: ${msg}` });
};
self.onunhandledrejection = function(e) {
    postMessage({ type: 'error', message: `Worker promise rejected: ${e.reason}` });
};

// Import wasm module
async function initWasm(wasmUrl) {
    try {
        const { default: init, WasmEmulator } = await import(wasmUrl);
        await init();
        wasm = { WasmEmulator };
        postMessage({ type: 'ready' });

        // Process any load request that arrived while WASM was initializing
        if (pendingLoad) {
            const msg = pendingLoad;
            pendingLoad = null;
            handleLoad(msg);
        }
    } catch (e) {
        postMessage({ type: 'error', message: `Failed to init WASM: ${e.message}` });
    }
}

// What the page needs to know about the machine it is looking at.
function machineInfo() {
    return {
        pc: emulator.pc(),
        isXtensa: emulator.is_xtensa(),
        numHarts: emulator.num_harts(),
        cyclesPerUs: emulator.cycles_per_us(),
    };
}

function handleLoad(msg) {
    const chip = msg.chip || 'esp32c3';
    try {
        if (emulator) emulator.free();
        emulator = null;
        emulator = new wasm.WasmEmulator(chip);
        lastRelayState = '';
        if (relayUrl) {
            emulator.net_set_relay(relayUrl);
        }
        if (msg.ssid) {
            emulator.set_wifi_config(msg.ssid, msg.password || '');
        }
        if (msg.rom) {
            emulator.load_rom_elf(new Uint8Array(msg.rom));
        } else if (emulator.has_default_rom()) {
            emulator.load_default_rom();
        } else {
            throw new Error(`No ROM provided and no embedded default for chip ${chip}`);
        }
        if (msg.efuse) {
            emulator.load_efuse(new Uint8Array(msg.efuse));
        }
        emulator.set_boot_from_rom(!msg.skipRom);
        const data = new Uint8Array(msg.firmware);
        emulator.load_firmware(data);
        postMessage({ type: 'loaded', chip, ...machineInfo() });
        sendSnapshot(true);
    } catch (err) {
        postMessage({ type: 'error', message: `Load failed: ${err}` });
    }
}

// --- Networking ---

// Why the relay URL cannot work, or null
function relayUrlError(url) {
    try {
        const u = new URL(url);
        if (!['ws:', 'wss:', 'http:', 'https:'].includes(u.protocol)) return 'it must start with ws://, wss://, http:// or https://';
        return u.hostname ? null : 'it has no host';
    } catch {
        return 'it is not a valid URL';
    }
}

function setRelay(url) {
    const bad = url && relayUrlError(url);
    if (bad) {
        postMessage({ type: 'error', message: `Relay URL ${url}: ${bad}` });
        postMessage({ type: 'relay_failed' });
        return;
    }
    relayUrl = url;
    lastRelayState = '';
    if (!emulator) return;
    try {
        emulator.net_set_relay(url);
        // The worker drains no NAT events, so the NAT goes off with the relay
        if (!url) emulator.net_enable(false);
    } catch (e) {
        relayUrl = '';
        postMessage({ type: 'error', message: `Relay: ${e}` });
        postMessage({ type: 'relay_failed' });
    }
    postRelayState();
}

// Posts the relay state when it changed
function postRelayState() {
    if (!emulator || !relayUrl) return;
    const state = emulator.net_relay_state();
    const key = JSON.stringify(state);
    if (key === lastRelayState) return;
    lastRelayState = key;
    postMessage({ type: 'relay_state', state });
}

// Handle messages from main thread
onmessage = function(e) {
    const msg = e.data;

    switch (msg.type) {
        case 'init':
            initWasm(msg.wasmUrl);
            break;

        case 'load':
            if (!wasm) {
                pendingLoad = msg;
                postMessage({ type: 'error', message: 'WASM still loading, please wait...' });
            } else {
                handleLoad(msg);
            }
            break;

        case 'start':
            running = true;
            runLoop();
            break;

        case 'stop':
            running = false;
            sendSnapshot(true);
            break;

        case 'step': {
            if (!emulator) break;
            let output = emulator.run_batch(1);
            if (emulator.needs_restart()) {
                if (output) postMessage({ type: 'uart_output', data: output });
                output = '';
                try {
                    emulator.restart();
                    postMessage({ type: 'restarted' });
                } catch (err) {
                    postMessage({ type: 'error', message: `Restart failed: ${err}` });
                }
            }
            postMessage({
                type: 'step',
                output: output,
                pc: emulator.pc(),
                cycles: emulator.cycles(),
            });
            if (emulator.faulted()) {
                postMessage({ type: 'fault', report: emulator.fault_report() });
            }
            sendSnapshot(true);
            break;
        }

        case 'reset': {
            running = false;
            if (emulator) {
                try {
                    emulator.restart();
                    postMessage({ type: 'reset', reloaded: true, ...machineInfo() });
                    sendSnapshot(true);
                } catch (err) {
                    postMessage({ type: 'error', message: `Reset failed: ${err}` });
                    postMessage({ type: 'reset', reloaded: false });
                }
            } else {
                postMessage({ type: 'reset', reloaded: false });
            }
            break;
        }

        case 'uart_input':
            if (emulator) {
                emulator.uart_input(new Uint8Array(msg.data));
            }
            break;

        case 'gpio_input':
            if (emulator) {
                emulator.gpio_set_input(msg.pin, !!msg.high);
                sendSnapshot(true);
            }
            break;

        case 'read_mem':
            if (emulator) {
                postMessage({
                    type: 'mem',
                    addr: msg.addr >>> 0,
                    bytes: emulator.read_memory(msg.addr >>> 0, msg.len),
                });
            }
            break;

        case 'mem_watch':
            memWatch = msg.addr == null ? null : { addr: msg.addr >>> 0, len: msg.len };
            if (memWatch && emulator) sendSnapshot(true);
            break;

        case 'relay_set':
            setRelay(msg.url);
            break;

        case 'set_batch_size':
            batchSize = msg.size;
            break;
    }
};

function runLoop() {
    if (!running || !emulator) return;

    const startTime = performance.now();
    let totalCycles = 0;
    let allOutput = '';
    // Wait before the next batch for the drift the emulator reports; the
    // worker cannot block, so setTimeout sleeps. Capped with the network up
    // so queued frames are not left waiting.
    let nextDelay = 0;

    // Run multiple batches per animation frame for throughput
    while (running) {
        const output = emulator.run_batch(batchSize);
        allOutput += output;
        totalCycles += batchSize;

        // Handle software restart (esp_restart / OTA reboot)
        if (emulator.needs_restart()) {
            // Flush output before restart
            if (allOutput.length > 0) {
                postMessage({ type: 'uart_output', data: allOutput });
                allOutput = '';
            }
            try {
                emulator.restart();
                postMessage({ type: 'uart_output', data: '\r\n' });
                postMessage({ type: 'restarted', ...machineInfo() });
            } catch (err) {
                postMessage({ type: 'error', message: `Restart failed: ${err}` });
                running = false;
            }
            break;
        }

        // A CPU fault or intercepted panic: nothing runs until a reset
        if (emulator.faulted()) {
            if (allOutput.length > 0) {
                postMessage({ type: 'uart_output', data: allOutput });
                allOutput = '';
            }
            postMessage({ type: 'fault', report: emulator.fault_report() });
            running = false;
            break;
        }

        // With the relay off, no one takes the firmware's frames
        if (!relayUrl) emulator.wifi_tx_drain();

        const drift = emulator.throttle_delay_ms(performance.now());
        if (drift > 0) {
            nextDelay = relayUrl ? Math.min(drift, 5) : drift;
            break;
        }

        // Yield every ~16ms for responsiveness
        if (performance.now() - startTime > 12) break;
    }

    if (allOutput.length > 0) {
        postMessage({ type: 'uart_output', data: allOutput });
    }

    // Send status update. A batch that ran for less than a millisecond has
    // no meaningful rate; report it as 0 rather than a huge or infinite one.
    const elapsedMs = performance.now() - startTime;
    postMessage({
        type: 'status',
        pc: emulator.pc(),
        cycles: emulator.cycles(),
        mips: elapsedMs >= 1 ? (totalCycles / elapsedMs / 1000).toFixed(1) : '0.0',
        now: performance.now(),
    });
    sendSnapshot(false);
    postRelayState();

    if (running) {
        if (nextDelay > 0) setTimeout(runLoop, nextDelay);
        else nextSlice.port2.postMessage(null);
    }
}

// Registers, per-hart PCs, GPIO pads and the watched memory window, rate
// limited while running; `force` sends one regardless (step, pause, load).
function sendSnapshot(force) {
    if (!emulator) return;
    const now = performance.now();
    if (!force && now - lastSnapshot < SNAPSHOT_INTERVAL_MS) return;
    lastSnapshot = now;

    const harts = emulator.num_harts();
    const pcs = [];
    for (let h = 0; h < harts; h++) pcs.push(emulator.hart_pc(h));

    const snap = {
        type: 'snapshot',
        regs: Array.from(emulator.registers()),
        pcs,
        gpio: Array.from(emulator.gpio_state()),
        cycles: emulator.cycles(),
    };
    if (memWatch) {
        snap.mem = { addr: memWatch.addr, bytes: emulator.read_memory(memWatch.addr, memWatch.len) };
    }
    postMessage(snap);
}
