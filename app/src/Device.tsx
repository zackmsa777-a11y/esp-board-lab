import { useEffect, useRef, useState } from 'react';
import type { Profile } from './boards/types';
import type { DisplayFrame, PartSnapshot } from './emu/parts/host';

export function Device({ profile, frame, parts, enabled, input }: {
  profile?: Profile; frame: DisplayFrame | null; parts: PartSnapshot[]; enabled: boolean;
  input: (part: string, kind: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const device = useRef<HTMLDivElement>(null);
  const queue = useRef<string[]>([]);
  const wheel = profile?.controls?.find(control => control.kind === 'encoder');
  const key = profile?.controls?.find(control => control.kind === 'button');
  const rotation = ((profile?.display?.rotate ?? 0) % 360 + 360) % 360;
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    if (!frame) { target.getContext('2d')?.clearRect(0, 0, target.width, target.height); return; }
    const source = document.createElement('canvas'); source.width = frame.width; source.height = frame.height;
    source.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
    target.width = rotation % 180 ? frame.height : frame.width;
    target.height = rotation % 180 ? frame.width : frame.height;
    const context = target.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    context.translate(target.width / 2, target.height / 2); context.rotate(rotation * Math.PI / 180);
    context.drawImage(source, -frame.width / 2, -frame.height / 2);
    context.resetTransform();
  }, [frame, rotation]);
  useEffect(() => {
    queue.current = [];
    if (!wheel || !enabled) return;
    // Preserve every notch in order; the encoder needs time for its Gray-code
    // sequence to finish before the next interaction starts.
    const timer = setInterval(() => { const next = queue.current.shift(); if (next) input(wheel.part, next); }, 45);
    const element = device.current;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.deltaY) return;
      const unit = event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? 1 : 100;
      const count = Math.max(1, Math.round(Math.abs(event.deltaY) / unit));
      for (let i = 0; i < count; i++) queue.current.push(event.deltaY > 0 ? 'cw' : 'ccw');
    };
    element?.addEventListener('wheel', onWheel, { passive: false });
    return () => { clearInterval(timer); element?.removeEventListener('wheel', onWheel); };
  }, [wheel?.part, enabled, input]);
  useEffect(() => {
    if (!enabled) return;
    const held = new Map<string, string>();
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, select, textarea, .terminal-host, [contenteditable]')) return;
      if (event.key === 'Enter' && target.closest('button')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (wheel) { event.preventDefault(); queue.current.push(event.key === 'ArrowRight' ? 'cw' : 'ccw'); } return;
      }
      const part = event.key === 'Enter' ? wheel?.part : event.key.toLowerCase() === 'k' ? key?.part : undefined;
      if (part) { event.preventDefault(); if (!held.has(event.code)) { held.set(event.code, part); input(part, 'press'); } }
    };
    const up = (event: KeyboardEvent) => { const part = held.get(event.code); if (part) { input(part, 'release'); held.delete(event.code); } };
    const release = () => { for (const part of held.values()) input(part, 'release'); held.clear(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', release);
    return () => { release(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release); };
  }, [wheel?.part, key?.part, enabled, input]);
  const hold = (part: string) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => { event.currentTarget.setPointerCapture(event.pointerId); input(part, 'press'); },
    onPointerUp: () => input(part, 'release'), onPointerCancel: () => input(part, 'release'),
    onLostPointerCapture: () => input(part, 'release'), onBlur: () => input(part, 'release'),
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.repeat) input(part, 'press'); } },
    onKeyUp: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input(part, 'release'); } },
  });
  const battery = profile?.battery;
  const gauge = parts.find(part => part.name === battery?.gauge)?.values;
  const charger = parts.find(part => part.name === battery?.charger)?.values;
  const batteryInput = (kind: string) => { if (battery) for (const part of new Set([battery.gauge, battery.charger])) input(part, kind); };
  const truth = (value?: string) => value === 'true' || value === '1';
  const [percent, setPercent] = useState(75);
  const [usb, setUsb] = useState(false);
  const [charging, setCharging] = useState(false);
  const usbValue = charger?.usb ?? gauge?.usb, chargingValue = charger?.charging ?? gauge?.charging;
  useEffect(() => { setPercent(Number(gauge?.percent ?? 75)); }, [gauge?.percent]);
  useEffect(() => { setUsb(truth(usbValue)); }, [usbValue]);
  useEffect(() => { setCharging(truth(chargingValue)); }, [chargingValue]);
  return <>
    <div className="device-bezel" ref={device}>
      <button className="screen-button" disabled={!enabled || !wheel} aria-label="Press encoder; scroll to turn the wheel" {...(wheel ? hold(wheel.part) : {})}>
        <canvas ref={canvas} width="320" height="170" aria-label="Live firmware display" />
      </button>
      <div className="device-controls">
        {wheel && <><button disabled={!enabled} onClick={() => queue.current.push('ccw')} aria-label="Turn wheel counterclockwise">Left</button><button disabled={!enabled} {...hold(wheel.part)}>Wheel</button><button disabled={!enabled} onClick={() => queue.current.push('cw')} aria-label="Turn wheel clockwise">Right</button></>}
        {key && <button disabled={!enabled} {...hold(key.part)}>Key</button>}
      </div>
    </div>
    <p className="gpio-note">{profile?.display ? 'Live display · scroll or ← → to turn · Enter to press · K for key' : 'This profile has no display or controls.'}</p>
    {battery && <section className="battery-panel">
      <div className="gpio-heading"><h2>Battery</h2><output>{gauge?.voltage_mv ? `${(Number(gauge.voltage_mv) / 1000).toFixed(3)} V` : '— V'}</output></div>
      <label htmlFor="battery-percent">Charge <output>{percent}%</output></label>
      <input id="battery-percent" type="range" min="0" max="100" value={percent} disabled={!enabled} onChange={event => { setPercent(Number(event.target.value)); batteryInput(`set:percent=${event.target.value}`); }} />
      <div className="battery-switches"><label htmlFor="battery-usb"><input id="battery-usb" type="checkbox" disabled={!enabled} checked={usb} onChange={event => { setUsb(event.target.checked); batteryInput(`set:usb=${Number(event.target.checked)}`); }} />USB connected</label>
      <label htmlFor="battery-charging"><input id="battery-charging" type="checkbox" disabled={!enabled} checked={charging} onChange={event => { setCharging(event.target.checked); batteryInput(`set:charging=${Number(event.target.checked)}`); }} />Charging</label></div>
    </section>}
    <section className="parts-panel"><div className="gpio-heading"><h2>Attached parts</h2><span>{parts.length}</span></div>
      {!parts.length && <p className="gpio-note">No parts attached.</p>}
      <ul className="parts-list">{parts.map(part => <li key={part.name}><div><strong>{part.name}</strong><span>{part.error ? 'Attach error' : part.ready ? 'Attached' : 'Registering'}</span></div>
        {part.error ? <p className="part-error">{part.error}</p> : <dl>{Object.entries(part.values).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}
      </li>)}</ul>
    </section>
  </>;
}
