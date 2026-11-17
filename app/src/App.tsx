import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Snapshot } from './emu/loop';
import type { WorkerCommand, WorkerEvent } from './emu/protocol';
import { loadBoard, loadProfiles } from './boards';
import type { Profile } from './boards/types';
import type { DisplayFrame, ExportRead, ExportValue, PartSnapshot } from './emu/parts/host';
import { detectBoard } from './detect';
import { Device } from './Device';
import { preference, savePreference } from './three/model';

export function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [board, setBoard] = useState('');
  const [detected, setDetected] = useState('');
  const [parts, setParts] = useState<PartSnapshot[]>([]);
  const [frame, setFrame] = useState<DisplayFrame | null>(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState('No firmware loaded');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [deviceMode, setDeviceMode] = useState<'2d' | '3d'>(() => preference('device-mode', '2d') === '3d' ? '3d' : '2d');
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setFocus(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const worker = useRef<Worker | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const terminalHost = useRef<HTMLDivElement>(null);
  const firmware = useRef<ArrayBuffer | null>(null);
  const loadSequence = useRef(0);
  const requestSequence = useRef(0);
  const requests = useRef(new Map<number, { resolve: (value?: ExportValue) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  const send = useCallback((message: WorkerCommand, transfer: Transferable[] = []) => {
    worker.current?.postMessage(message, transfer);
  }, []);
  const partInput = useCallback((part: string, input: string) => send({ type: 'part_input', part, input }), [send]);
  const requestPart = useCallback((command: { type: 'read-export'; request: ExportRead } | { type: 'part_input'; part: string; input: string }) => new Promise<ExportValue | undefined>((resolve, reject) => {
    const requestId = ++requestSequence.current;
    const timer = setTimeout(() => { requests.current.delete(requestId); reject(new Error('The part did not respond. Try again after the emulator finishes loading.')); }, 15_000);
    requests.current.set(requestId, { resolve, reject, timer });
    send({ ...command, requestId });
  }), [send]);
  const readExport = useCallback(async (request: ExportRead) => {
    const value = await requestPart({ type: 'read-export', request });
    if (value === undefined) throw new Error('The part returned no export value.');
    return value;
  }, [requestPart]);
  const inputAsync = useCallback(async (part: string, input: string) => { await requestPart({ type: 'part_input', part, input }); }, [requestPart]);
  useEffect(() => {
    let alive = true;
    void loadProfiles().then(items => { if (alive) { setProfiles(items); setBoard(items.find(item => item.display)?.id ?? items[0]?.id ?? ''); } }).catch(cause => { if (alive) setError(`Could not load board profiles: ${String(cause)}`); });
    return () => { alive = false; };
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
        case 'parts': setParts(data.parts); break;
        case 'frame': setFrame(data.frame); break;
        case 'export-result':
        case 'input-result': {
          const pending = data.requestId === undefined ? undefined : requests.current.get(data.requestId);
          if (pending) {
            clearTimeout(pending.timer); requests.current.delete(data.requestId!);
            if (data.error) pending.reject(new Error(data.error));
            else pending.resolve(data.type === 'export-result' ? data.value : undefined);
          }
          break;
        }
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
      for (const pending of requests.current.values()) { clearTimeout(pending.timer); pending.reject(new Error('Emulator closed.')); }
      requests.current.clear();
      worker.current = null; terminal.current = null;
      emuWorker.terminate(); resize.disconnect(); input.dispose(); term.dispose();
    };
  }, [send]);

  const loadBytes = useCallback(async (bytes: ArrayBuffer, profile: Profile) => {
    setBusy(true); setLoaded(false); setSnapshot(null); setError('');
    setFrame(null); setParts([]);
    terminal.current?.reset();
    try {
      const definition = await loadBoard(profile);
      const transferred = bytes.slice(0);
      send({ type: 'load', chip: profile.chip, firmware: transferred, profile, board: definition }, [transferred]);
    } catch (cause) { setBusy(false); setError(`Could not load board: ${String(cause)}`); }
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
      const detection = await detectBoard(new Uint8Array(bytes), profiles);
      if (sequence !== loadSequence.current) return;
      const selected = profiles.find(item => item.id === detection.profileId) ?? profiles.find(item => item.id === board) ?? profiles[0];
      if (!selected) throw new Error('No board profiles available');
      setBoard(selected.id);
      setDetected(detection.profileId ? `Detected: ${selected.name}${detection.hints.length ? ` (${detection.hints.join(', ')})` : ''}` : '');
      await loadBytes(bytes, selected);
    } catch (cause) { setBusy(false); setError(`Could not read firmware: ${String(cause)}`); }
  };

  const profile = profiles.find(item => item.id === board);
  const chip = profile?.chip ?? 'esp32s3';
  const state = error ? (snapshot?.faulted ? 'Faulted' : 'Error') : busy ? 'Loading' : !ready ? 'Starting' : snapshot?.running ? 'Running' : loaded ? 'Paused' : 'Ready';
  const gpio = snapshot?.gpio_state;
  const mode3d = deviceMode === '3d' && !!profile?.model3d;
  return (
    <main className={`workbench${dragging ? ' drag-active' : ''}`}
      onDragOver={event => { event.preventDefault(); if (ready && !busy) setDragging(true); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); if (ready && !busy) void loadFile(event.dataTransfer.files[0]); }}>
      <header className="toolbar">
        <h1>ESP Board Lab</h1>
        <div className="board-control"><label htmlFor="board">Board</label>
          <select id="board" value={board} disabled={busy} onChange={event => {
            const next = event.target.value; setBoard(next);
            const selected = profiles.find(item => item.id === next);
            if (firmware.current && selected) void loadBytes(firmware.current, selected);
          }}>{profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </div>
        <label className={`file-button${!ready || busy ? ' disabled' : ''}`}>
          Load firmware<input type="file" accept=".bin" aria-label="Load firmware .bin" disabled={!ready || busy || !profile}
            onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        <button className="primary" disabled={!loaded || busy || !!snapshot?.faulted} onClick={() => { setError(''); send({ type: snapshot?.running ? 'pause' : 'resume' }); }}>
          {snapshot?.running ? 'Pause' : 'Run'}
        </button>
        <button disabled={!loaded || busy} onClick={() => { setError(''); send({ type: 'reset' }); }}>Reset</button>
      </header>

      <div className="firmware-strip"><span className="filename" title={filename}>{filename}</span><span>Drop a .bin anywhere to load</span></div>
      {detected && <div className="detection-banner" role="status">{detected}<span>Change Board to override.</span></div>}
      {error && <div className="error" role="alert"><strong>{snapshot?.faulted ? 'CPU fault' : 'Emulator error'}</strong><pre>{error}</pre><span>{snapshot?.faulted ? 'Reset to boot again. Peripheral emulation is incomplete.' : 'Check the firmware and selected chip, then load again.'}</span></div>}

      <div className={`workspace${mode3d ? ' workspace-3d' : ''}${mode3d && focus ? ' device-focused' : ''}`}>
        <section className="device-panel" aria-labelledby="device-heading">
          <div className="section-heading"><h2 id="device-heading">Device</h2><div className="device-view-actions">
            {profile?.model3d && <><div className="view-toggle" role="group" aria-label="Device view">{(['2d', '3d'] as const).map(mode => <button key={mode} aria-pressed={deviceMode === mode} onClick={() => { setDeviceMode(mode); savePreference('device-mode', mode); }}>{mode.toUpperCase()}</button>)}</div>
            {mode3d && <button aria-pressed={focus} onClick={() => setFocus(value => !value)}>{focus ? 'Exit focus (Esc)' : 'Focus'}</button>}</>}
            <span>{chip.toUpperCase()}</span></div></div>
          <Device profile={profile} frame={frame} parts={parts} enabled={loaded && !busy} input={partInput} readExport={readExport} inputAsync={inputAsync} mode={mode3d ? '3d' : '2d'} />
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
