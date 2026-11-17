import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Chip, Snapshot } from './emu/loop';
import type { WorkerCommand, WorkerEvent } from './emu/protocol';

const boards: { label: string; chip: Chip }[] = [
  { label: 'LilyGO T-Embed CC1101 Plus (esp32s3)', chip: 'esp32s3' },
  { label: 'Generic ESP32-S3', chip: 'esp32s3' },
  { label: 'Generic ESP32-C3', chip: 'esp32c3' },
];

export function App() {
  const [board, setBoard] = useState(0);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState('No firmware loaded');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const worker = useRef<Worker | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const terminalHost = useRef<HTMLDivElement>(null);
  const firmware = useRef<ArrayBuffer | null>(null);
  const loadSequence = useRef(0);
  const send = useCallback((message: WorkerCommand, transfer: Transferable[] = []) => {
    worker.current?.postMessage(message, transfer);
  }, []);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true, convertEol: true, fontSize: 13, scrollback: 10_000,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      theme: { background: '#10151c', foreground: '#d5e0ed', cursor: '#82b6ee', selectionBackground: '#335779' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalHost.current!);
    terminal.current = term;
    term.writeln('ESP Board Lab\r\nLoad a firmware .bin, then press Run.\r\n');
    const resize = new ResizeObserver(() => { if (terminalHost.current?.clientWidth) fit.fit(); });
    resize.observe(terminalHost.current!);
    const input = term.onData(data => send({ type: 'uart_input', data: new TextEncoder().encode(data) }));
    const emuWorker = new Worker(new URL('./emu/worker.ts', import.meta.url), { type: 'module' });
    worker.current = emuWorker;
    emuWorker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
      switch (data.type) {
        case 'ready': setReady(true); break;
        case 'loaded': setLoaded(true); setBusy(false); setError(''); break;
        case 'uart': term.write(data.text); break;
        case 'status':
          setSnapshot(data.status);
          if (data.status.faulted) setError(data.status.fault_report || 'CPU fault. Reset to restart the firmware.');
          break;
        case 'error': setError(data.message); setBusy(false); break;
      }
    };
    emuWorker.onerror = event => { setError(event.message || 'The emulator worker stopped. Reload the app.'); setBusy(false); };
    return () => {
      worker.current = null; terminal.current = null;
      emuWorker.terminate(); resize.disconnect(); input.dispose(); term.dispose();
    };
  }, [send]);

  const loadBytes = useCallback((bytes: ArrayBuffer, chip: Chip) => {
    setBusy(true); setLoaded(false); setSnapshot(null); setError('');
    terminal.current?.reset();
    const transferred = bytes.slice(0);
    send({ type: 'load', chip, firmware: transferred }, [transferred]);
  }, [send]);

  const loadFile = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.bin')) { setError('Choose an ESP firmware file ending in .bin.'); return; }
    if (file.size === 0 || file.size > 64 * 1024 * 1024) { setError('Choose a non-empty .bin file up to 64 MiB.'); return; }
    const sequence = ++loadSequence.current;
    send({ type: 'pause' }); setBusy(true); setError('');
    try {
      const bytes = await file.arrayBuffer();
      if (sequence !== loadSequence.current) return;
      firmware.current = bytes; setFilename(file.name);
      loadBytes(bytes, boards[board].chip);
    } catch (cause) { setBusy(false); setError(`Could not read firmware: ${String(cause)}`); }
  };

  const chip = boards[board].chip;
  const state = error ? (snapshot?.faulted ? 'Faulted' : 'Error') : busy ? 'Loading' : !ready ? 'Starting' : snapshot?.running ? 'Running' : loaded ? 'Paused' : 'Ready';
  const gpio = snapshot?.gpio_state;
  return (
    <main className={`workbench${dragging ? ' drag-active' : ''}`}
      onDragOver={event => { event.preventDefault(); if (ready && !busy) setDragging(true); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); if (ready && !busy) void loadFile(event.dataTransfer.files[0]); }}>
      <header className="toolbar">
        <h1>ESP Board Lab</h1>
        <div className="board-control"><label htmlFor="board">Board</label>
          <select id="board" value={board} disabled={busy} onChange={event => {
            const next = Number(event.target.value); setBoard(next);
            if (firmware.current) loadBytes(firmware.current, boards[next].chip);
          }}>{boards.map((item, index) => <option key={index} value={index}>{item.label}</option>)}</select>
        </div>
        <label className={`file-button${!ready || busy ? ' disabled' : ''}`}>
          Load firmware<input type="file" accept=".bin" aria-label="Load firmware .bin" disabled={!ready || busy}
            onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        <button className="primary" disabled={!loaded || busy || !!snapshot?.faulted} onClick={() => { setError(''); send({ type: snapshot?.running ? 'pause' : 'resume' }); }}>
          {snapshot?.running ? 'Pause' : 'Run'}
        </button>
        <button disabled={!loaded || busy} onClick={() => { setError(''); send({ type: 'reset' }); }}>Reset</button>
      </header>

      <div className="firmware-strip"><span className="filename" title={filename}>{filename}</span><span>Drop a .bin anywhere to load</span></div>
      {error && <div className="error" role="alert"><strong>{snapshot?.faulted ? 'CPU fault' : 'Emulator error'}</strong><pre>{error}</pre><span>{snapshot?.faulted ? 'Reset to boot again. Peripheral emulation is incomplete.' : 'Check the firmware and selected chip, then load again.'}</span></div>}

      <div className="workspace">
        <section className="device-panel" aria-labelledby="device-heading">
          <div className="section-heading"><h2 id="device-heading">Device</h2><span>{chip.toUpperCase()}</span></div>
          <figure className="display"><canvas width="320" height="170" aria-label="320 by 170 display, not wired yet" /><figcaption>Display (not wired yet)<span>320 × 170</span></figcaption></figure>
          <div className="gpio-heading"><h2>GPIO state</h2><span>Output registers</span></div>
          <div className="pin-grid" aria-label="GPIO output state">
            {Array.from({ length: chip === 'esp32c3' ? 22 : 49 }, (_, pin) => {
              const absent = chip === 'esp32s3' && pin >= 22 && pin <= 25;
              const word = pin < 32 ? 0 : 1; const bit = pin & 31;
              const output = !!gpio && ((gpio[2 + word] >>> bit) & 1) === 1;
              const high = !!gpio && ((gpio[word] >>> bit) & 1) === 1;
              const label = absent ? 'Unavailable' : !gpio ? 'Unknown' : output ? (high ? 'High' : 'Low') : 'Input';
              return <div key={pin} className={`pin ${absent ? 'absent' : output ? high ? 'high' : 'low' : ''}`} title={`GPIO ${pin}: ${label}`}><span>{pin}</span><small>{label}</small></div>;
            })}
          </div>
          <p className="gpio-note">High / low show driven outputs. Input levels are not sampled.</p>
          <p className="peripheral-note">Display, buttons and CC1101 radio are not connected in this build.</p>
        </section>

        <section className="serial-panel" aria-labelledby="serial-heading">
          <div className="section-heading"><h2 id="serial-heading">Serial terminal</h2><div className="serial-actions"><span>UART 0</span><button onClick={() => terminal.current?.clear()}>Clear</button></div></div>
          <div className="terminal-host" ref={terminalHost} aria-label="Serial terminal; type to send UART input" />
          <div className="terminal-hint">Click the terminal to send keyboard input to UART.</div>
        </section>
      </div>
      <footer className="statusbar" role="status">
        <span className={`state ${state.toLowerCase()}`}><i />{state}</span>
        <span>Chip <b>{chip}</b></span>
        <span>PC <b>{snapshot ? `0x${snapshot.pc.toString(16).padStart(8, '0')}` : '—'}</b></span>
        <span title="Estimated from requested batch instructions; sleep and faults can reduce actual work">MIPS ≈ <b>{snapshot?.mips.toFixed(1) ?? '0.0'}</b></span>
        <span className="cycles">Cycles <b>{snapshot?.cycles ?? '0'}</b></span>
      </footer>
      {dragging && <div className="drop-overlay">Drop firmware .bin to load</div>}
    </main>
  );
}
