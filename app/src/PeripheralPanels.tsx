import { useEffect, useId, useState, type ReactNode } from 'react';
import type { Profile } from './boards/types';
import type { ExportRead, ExportValue, PartSnapshot } from './emu/parts/host';

export type ReadExport = (request: ExportRead) => Promise<ExportValue>;
export type PartInput = (part: string, input: string) => Promise<void>;
const decode = (value: ExportValue) => {
  if (!(value instanceof ArrayBuffer)) throw new Error('Expected exported text bytes.');
  return new TextDecoder().decode(value);
};
function saveText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function FileButton({ extension, disabled, load }: { extension: string; disabled: boolean; load: (file: File) => void }) {
  return <label className={`file-button${disabled ? ' disabled' : ''}`}>Load {extension}
    <input type="file" accept={extension} aria-label={`Load ${extension}`} disabled={disabled} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (file) load(file);
    }} />
  </label>;
}
async function fileText(file: File, extension: string) {
  if (!file.name.toLowerCase().endsWith(extension)) throw new Error(`Choose a ${extension} file.`);
  if (!file.size || file.size > 4 * 1024 * 1024) throw new Error(`Choose a non-empty ${extension} file up to 4 MiB.`);
  return file.text();
}
function Readout({ part, fields }: { part?: PartSnapshot; fields: [string, string][] }) {
  return <dl className="peripheral-readout">{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{part?.values[key] || '—'}</dd></div>)}</dl>;
}
function Panel({ title, summary, parts, children }: { title: string; summary: string; parts: (PartSnapshot | undefined)[]; children: ReactNode }) {
  return <details className="peripheral-panel">
    <summary>{title}<span>{summary}</span></summary>
    <div className="peripheral-body">
      {parts.filter(part => part?.error).map(part => <p className="part-error" role="status" key={part!.name}>{part!.name}: Attach error · {part!.error}</p>)}
      {children}
    </div>
  </details>;
}
const available = (enabled: boolean, part?: PartSnapshot) => enabled && !!part?.ready && !part.error;
const status = (part?: PartSnapshot) => part?.error ? 'Attach error' : part?.ready ? 'Attached' : 'Load firmware to attach';
function RadioPanel({ name, part, enabled, input, readExport }: { name: string; part?: PartSnapshot; enabled: boolean; input: PartInput; readExport: ReadExport }) {
  const [captures, setCaptures] = useState<{ id: number; text: string }[]>([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const count = part?.values.tx_count;
  const usable = available(enabled, part);
  useEffect(() => {
    if (!usable) { setCaptures([]); return; }
    let alive = true;
    void (async () => {
      const value = await readExport({ part: name, name: 'ebl_tx_count' });
      if (typeof value !== 'number') throw new Error('Invalid radio capture count.');
      const size = Math.min(value, 16), items = [];
      for (let i = 0; i < size; i++) {
        const text = decode(await readExport({ part: name, name: 'ebl_tx_ptr', args: [i], lengthExport: 'ebl_tx_len' }));
        if (text) items.push({ id: Math.max(0, Number(count ?? value) - size) + i + 1, text });
      }
      if (alive) { setCaptures(items.reverse()); setError(''); }
    })().catch(cause => { if (alive) setError(String(cause)); });
    return () => { alive = false; };
  }, [count, usable, name, readExport]);
  const act = async (action: () => Promise<void>, message: string) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(message); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  };
  return <Panel title="Sub-GHz" summary={part?.ready ? `${part.values.chip_state ?? 'Ready'} · ${part.values.tx_count ?? 0} TX` : status(part)} parts={[part]}>
    <Readout part={part} fields={[["freq_hz", "Frequency (Hz)"], ["modulation", "Modulation"], ["data_rate", "Data rate"], ["bandwidth_khz", "Bandwidth (kHz)"], ["mode", "Mode"], ["band_switch", "RF path"], ["rx_pending", "Queued signals"], ["last_rx", "Last reception"]]} />
    <div className="peripheral-actions"><FileButton extension=".sub" disabled={!usable || busy} load={file => void act(async () => input(name, `load-sub:${await fileText(file, '.sub')}`), `Queued ${file.name} for the receiver.`)} />
      <button disabled={!usable || busy} onClick={() => void act(() => input(name, 'air-clear'), 'Receiver queue cleared.')}>Clear queue</button></div>
    <p className="gpio-note">Signals wait for firmware to enable reception at a matching frequency. The last 16 transmissions are retained.</p>
    <h3>Captured transmissions</h3>
    {!captures.length && <p className="peripheral-empty">No transmissions captured. Transmit from the firmware to record a .sub file.</p>}
    <ol className="capture-list">{captures.map(capture => <li key={capture.id}><span>Transmission {capture.id}</span><small>{capture.text.match(/^Frequency:\s*(.+)$/m)?.[1] ?? 'RAW'} Hz</small>
      <div className="peripheral-actions"><button onClick={() => saveText(capture.text, `capture-${capture.id}.sub`)}>Save .sub</button><button disabled={!usable || busy} onClick={() => void act(() => input(name, `load-sub:${capture.text}`), `Transmission ${capture.id} queued for the receiver.`)}>Replay to receiver</button></div>
    </li>)}</ol>
    {(error || part?.values.last_error) && <p className="part-error" role="alert">{error || part?.values.last_error}</p>}
    {notice && <p className="peripheral-notice" role="status">{notice}</p>}
  </Panel>;
}
function NfcPanel({ name, part, enabled, input, readExport }: { name: string; part?: PartSnapshot; enabled: boolean; input: PartInput; readExport: ReadExport }) {
  const [present, setPresent] = useState(false), [busy, setBusy] = useState(false);
  const [tagLoaded, setTagLoaded] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const id = useId(), usable = available(enabled, part);
  const visibleTag = !!part?.values.tag && part.values.tag !== 'none';
  const hasTag = tagLoaded || visibleTag;
  // PN532 reports tag=none while removed, but its dump remains loaded.
  // Keep placement and Save dump available until the user clears that dump.
  useEffect(() => { if (visibleTag) setTagLoaded(true); }, [visibleTag]);
  useEffect(() => { if (!usable) { setTagLoaded(false); setPresent(false); } }, [usable]);
  const act = async (action: () => Promise<void>, message = '') => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(message); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  };
  return <Panel title="NFC" summary={part?.ready ? part.values.tag ?? 'No tag' : status(part)} parts={[part]}>
    <Readout part={part} fields={[["firmware", "Controller"], ["sam_configured", "SAM configured"], ["field", "RF field"], ["tag", "Tag"], ["last_command", "Last command"], ["reads", "Reads"], ["writes", "Writes"], ["auths_ok", "Auth OK"], ["auths_failed", "Auth failed"]]} />
    <div className="peripheral-actions"><FileButton extension=".nfc" disabled={!usable || busy} load={file => void act(async () => {
      await input(name, `load-nfc:${await fileText(file, '.nfc')}`); await input(name, 'tag-present:1'); setTagLoaded(true); setPresent(true);
    }, `Loaded ${file.name}; tag placed on the reader.`)} />
      <button disabled={!usable || busy || !hasTag} onClick={() => void act(async () => {
        const text = decode(await readExport({ part: name, name: 'ebl_dump_ptr', lengthExport: 'ebl_dump_len' }));
        if (!text) throw new Error('No tag dump available. Load a .nfc file first.');
        saveText(text, 'tag-dump.nfc');
      })}>Save dump</button>
      <button disabled={!usable || busy || !hasTag} onClick={() => void act(async () => { await input(name, 'tag-clear'); setTagLoaded(false); setPresent(false); }, 'Tag cleared.')}>Clear tag</button>
    </div>
    <label className="peripheral-toggle" htmlFor={id}><input id={id} type="checkbox" checked={present} disabled={!usable || busy || !hasTag} onChange={event => {
      const value = event.target.checked, previous = present; setPresent(value);
      void act(async () => { try { await input(name, `tag-present:${Number(value)}`); } catch (cause) { setPresent(previous); throw cause; } });
    }} />Tag present on reader</label>
    <p className="gpio-note">Load a Flipper .nfc dump, then place or remove the tag while the firmware scans. Save dump includes firmware writes.</p>
    {(error || part?.values.last_error) && <p className="part-error" role="alert">{error || part?.values.last_error}</p>}
    {notice && <p className="peripheral-notice" role="status">{notice}</p>}
  </Panel>;
}
export interface IrSignal { name: string; text: string; protocol: string }
export function parseIrSignals(text: string): IrSignal[] {
  const signals: IrSignal[] = [];
  let lines: string[] = [];
  const finish = () => {
    const block = lines.join('\n').trim();
    if (/^type:\s*(raw|parsed)\s*$/mi.test(block)) signals.push({ name: block.match(/^name:\s*(.*)$/mi)?.[1]?.trim() || `Signal ${signals.length + 1}`, text: block, protocol: block.match(/^protocol:\s*(.*)$/mi)?.[1]?.trim() || 'RAW' });
    lines = [];
  };
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (/^name:/i.test(line)) finish();
    if (!/^\s*#/.test(line) && !/^(Filetype|Version):/i.test(line)) lines.push(line);
  }
  finish();
  return signals;
}
const irFile = (text: string, name: string) => /^Filetype:\s*IR signals file\s*$/mi.test(text)
  ? `${text.trim()}\n`
  : `Filetype: IR signals file\nVersion: 1\n#\n${/^name:/mi.test(text) ? '' : `name: ${name}\n`}${text.trim()}\n`;
function IrPanel({ tx, rx, parts, enabled, input }: { tx: string; rx: string; parts: PartSnapshot[]; enabled: boolean; input: PartInput }) {
  const transmitter = parts.find(part => part.name === tx), receiver = parts.find(part => part.name === rx);
  const [signals, setSignals] = useState<IrSignal[]>([]), [selection, setSelection] = useState(0);
  const [log, setLog] = useState<{ count: string; protocol: string; address: string; command: string; text: string }[]>([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const id = useId(), count = transmitter?.values.tx_count, values = transmitter?.values;
  useEffect(() => {
    if (!transmitter) { setLog([]); return; }
    if (!count || count === '0' || !values) return;
    const text = values.last_parsed || values.last_raw;
    if (text) setLog(items => items.some(item => item.count === count) ? items : [{ count, protocol: values.last_protocol || 'RAW', address: values.last_address || '—', command: values.last_command || '—', text }, ...items].slice(0, 32));
  }, [count, values, transmitter]);
  return <Panel title="IR" summary={transmitter?.ready ? `${count ?? 0} TX · ${receiver?.values.sent ?? 0} RX` : status(transmitter)} parts={[transmitter, receiver]}>
    <Readout part={receiver} fields={[["sent", "Signals sent to receiver"], ["last_sent", "Last injected signal"]]} />
    <div className="peripheral-actions"><FileButton extension=".ir" disabled={!available(enabled, receiver) || busy} load={file => {
      setError(''); setNotice(''); setBusy(true);
      void fileText(file, '.ir').then(text => {
        const parsed = parseIrSignals(text); if (!parsed.length) throw new Error('No raw or parsed IR signals found in this file.');
        setSignals(parsed); setSelection(0); setNotice(`Loaded ${parsed.length} signal${parsed.length === 1 ? '' : 's'} from ${file.name}.`);
      }).catch(cause => setError(String(cause))).finally(() => setBusy(false));
    }} /></div>
    <label className="signal-label" htmlFor={id}>Signal</label>
    <select id={id} disabled={!signals.length || busy} value={selection} onChange={event => setSelection(Number(event.target.value))}>
      {!signals.length && <option value="0">Load a .ir file to choose a signal</option>}
      {signals.map((signal, i) => <option key={i} value={i}>{signal.name} ({signal.protocol})</option>)}
    </select>
    <div className="peripheral-actions"><button disabled={!available(enabled, receiver) || busy || !signals.length} onClick={() => {
      setBusy(true); setError(''); setNotice('');
      void input(rx, `load-ir:${signals[selection].text}`).then(() => setNotice(`Sent ${signals[selection].name} to receiver.`)).catch(cause => setError(String(cause))).finally(() => setBusy(false));
    }}>Send to receiver</button></div>
    <h3>Transmitted signals</h3>
    <p className="gpio-note">Latest 32 observed TX signals. Receiver injections appear above; firmware transmissions appear below.</p>
    {!log.length && <p className="peripheral-empty">No IR transmissions captured. Send a signal from the firmware to record it.</p>}
    <ol className="capture-list">{log.map(item => <li key={item.count}><span>#{item.count} {item.protocol}</span><small>Address {item.address} · Command {item.command}</small>
      <div className="peripheral-actions"><button onClick={() => saveText(irFile(item.text, `Capture ${item.count}`), `capture-${item.count}.ir`)}>Save .ir</button></div>
    </li>)}</ol>
    {(error || receiver?.values.last_error) && <p className="part-error" role="alert">{error || receiver?.values.last_error}</p>}
    {notice && <p className="peripheral-notice" role="status">{notice}</p>}
  </Panel>;
}
export function PeripheralPanels({ profile, parts, enabled, input, readExport }: { profile?: Profile; parts: PartSnapshot[]; enabled: boolean; input: PartInput; readExport: ReadExport }) {
  if (!profile?.radio && !profile?.nfc && !profile?.ir) return null;
  return <section className="peripheral-panels" aria-label="Radio, NFC and infrared tools">
    {profile.radio && <RadioPanel name={profile.radio.part} part={parts.find(part => part.name === profile.radio!.part)} enabled={enabled} input={input} readExport={readExport} />}
    {profile.nfc && <NfcPanel name={profile.nfc.part} part={parts.find(part => part.name === profile.nfc!.part)} enabled={enabled} input={input} readExport={readExport} />}
    {profile.ir && <IrPanel tx={profile.ir.tx} rx={profile.ir.rx} parts={parts} enabled={enabled} input={input} />}
  </section>;
}
