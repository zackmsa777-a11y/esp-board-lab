import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Model3D } from '../boards/types';
import type { DisplayFrame } from '../emu/parts/host';
import { cachedModel, preference, savePreference, type ModelMesh } from './model';

const DeviceScene = lazy(() => import('./DeviceScene'));
class SceneBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <p className="model-error" role="alert">3D rendering is unavailable. Switch to 2D to keep using the device.</p> : this.props.children; }
}
export default function ModelView({ model, frame, rotation, displayOn, enabled, turn, press, release, ledColors, ledRadius }: {
  model: Model3D; frame: DisplayFrame | null; rotation: number; displayOn: boolean; enabled: boolean;
  turn: (steps: number) => void; press: (control: 'knob' | 'key') => void; release: (control: 'knob' | 'key') => void;
  ledColors: string[]; ledRadius?: number;
}) {
  const [source, setSource] = useState(() => preference('model-source', 'builtin'));
  const [meshes, setMeshes] = useState<ModelMesh[]>();
  const [progress, setProgress] = useState<{ label: string; value: number }>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reset, setReset] = useState(0);
  const worker = useRef<Worker | null>(null);
  const hash = model.official.sha256;
  useEffect(() => {
    let alive = true;
    setMeshes(undefined); setError(''); setNotice('');
    void cachedModel(hash).then(result => { if (alive) setMeshes(result); }).catch(() => {
      if (alive) setNotice('Local model cache is unavailable. Downloads still work for this session.');
    });
    return () => { alive = false; worker.current?.terminate(); worker.current = null; };
  }, [hash]);
  const choose = (value: string) => { setSource(value); savePreference('model-source', value); };
  const download = () => {
    if (worker.current) return;
    setError(''); setProgress({ label: 'Starting download…', value: 0 });
    const task = new Worker('/model-converter/convert.worker.js');
    worker.current = task;
    const finish = () => { task.terminate(); worker.current = null; setProgress(undefined); };
    task.onerror = event => { setError(`Model conversion stopped: ${event.message || 'Worker unavailable'}. Retry or use Built-in.`); finish(); };
    task.onmessage = ({ data }) => {
      if (data.type === 'progress') setProgress({ label: data.label, value: data.value });
      if (data.type === 'error') { setError(data.message); finish(); }
      if (data.type === 'complete') {
        setMeshes(data.meshes); choose('official'); finish();
        void cachedModel(hash, data.meshes).catch(() => setNotice('Model ready for this session; browser storage could not cache it.'));
      }
    };
    task.postMessage(model.official);
  };
  return <div className="model-view">
    <div className="model-toolbar">
      <label htmlFor="model-source">Model</label>
      <select id="model-source" value={source} onChange={event => choose(event.target.value)}>
        <option value="builtin">Built-in</option><option value="official">Official LilyGO{meshes ? ' (cached)' : ' (download)'}</option>
      </select>
      <button onClick={() => setReset(value => value + 1)}>Reset view</button>
    </div>
    {source === 'official' && !meshes && <div className="model-download">
      <p>Using Built-in until the official shell is ready. Downloaded from <a href={model.official.source_page} target="_blank" rel="noreferrer">LilyGO’s GitHub</a>; no model is bundled with this app. Converted locally and cached on this device.</p>
      <button disabled={!!progress} onClick={download}>Download official LilyGO 3D model</button>
      {progress && <button onClick={() => { worker.current?.terminate(); worker.current = null; setProgress(undefined); }}>Cancel</button>}
    </div>}
    {progress && <div className="model-progress"><progress max="100" value={progress.value} aria-label={progress.label} /><span>{progress.label}</span></div>}
    {error && <p className="model-error" role="alert">{error}</p>}
    {notice && <p className="gpio-note">{notice}</p>}
    <SceneBoundary><Suspense fallback={<p className="gpio-note">Loading 3D viewer…</p>}>
      <DeviceScene model={model} meshes={source === 'official' ? meshes : undefined} frame={frame} rotation={rotation} displayOn={displayOn} enabled={enabled} turn={turn} press={press} release={release} reset={reset} ledColors={ledColors} ledRadius={ledRadius} />
    </Suspense></SceneBoundary>
    <p className="model-hint">Drag to rotate · Scroll to zoom · Right-drag to pan · Double-click to reset<br />Drag the knob to turn · Scroll over knob for detents · Click and hold to press</p>
    <p className="gpio-note">GPIO6 key: side button near the knob (approximate placement). Keyboard: ← → turn · Enter press · K key.</p>
  </div>;
}
