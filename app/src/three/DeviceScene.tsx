import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls, RoundedBox } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, ExtrudeGeometry, MeshStandardMaterial, NearestFilter, Path, Shape, SRGBColorSpace } from 'three';
import type { OrbitControls as Controls } from 'three-stdlib';
import type { Model3D } from '../boards/types';
import type { DisplayFrame } from '../emu/parts/host';
import type { ModelMesh } from './model';
import { ledDisplayColor } from '../LedRing';

type Props = {
  model: Model3D; meshes?: ModelMesh[]; frame: DisplayFrame | null; rotation: number;
  displayOn: boolean; enabled: boolean; reset: number;
  ledColors: string[]; ledRadius?: number;
  turn: (steps: number) => void; press: (control: 'knob' | 'key') => void; release: (control: 'knob' | 'key') => void;
};
const radians = Math.PI / 180;
function LedRing({ model, ledColors, ledRadius = 14.6 }: Pick<Props, 'model' | 'ledColors' | 'ledRadius'>) {
  const invalidate = useThree(s => s.invalidate);
  const signature = ledColors.join(',');
  useEffect(() => { invalidate(); }, [signature, invalidate]);
  const [x, y] = model.knob.center;
  return <group name="ws2812-ring">{ledColors.map((color, i) => {
    const angle = i / ledColors.length * Math.PI * 2 - Math.PI / 2;
    const light = ledDisplayColor(color);
    return <mesh key={i} name={`ws2812-${i + 1}`} position={[x + Math.cos(angle) * ledRadius, y + Math.sin(angle) * ledRadius, -2.9]}>
      <sphereGeometry args={[.85, 12, 8]} /><meshStandardMaterial color={color === '#000000' ? '#35404a' : light} emissive={light} emissiveIntensity={2.2} toneMapped={false} roughness={.25} />
    </mesh>;
  })}</group>;
}
function outline(width: number, height: number, radius: number, x = 0, y = 0) {
  const s = new Shape(); const l = x - width / 2, b = y - height / 2;
  s.moveTo(l + radius, b); s.lineTo(l + width - radius, b);
  s.quadraticCurveTo(l + width, b, l + width, b + radius); s.lineTo(l + width, b + height - radius);
  s.quadraticCurveTo(l + width, b + height, l + width - radius, b + height); s.lineTo(l + radius, b + height);
  s.quadraticCurveTo(l, b + height, l, b + height - radius); s.lineTo(l, b + radius);
  s.quadraticCurveTo(l, b, l + radius, b); return s;
}

function OfficialShell({ meshes }: { meshes: ModelMesh[] }) {
  const resources = useMemo(() => meshes.map(m => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(m.positions, 3));
    geometry.setIndex(new BufferAttribute(m.indices, 1));
    if (m.normals) geometry.setAttribute('normal', new BufferAttribute(m.normals, 3));
    else geometry.computeVertexNormals();
    // The STEP file carries CAD placeholder colours (orange, yellow), not the
    // product's finish, so every shell part gets the real device's dark plastic.
    const shade = /COV-B/i.test(m.name) ? '#3a424a' : /COV-A/i.test(m.name) ? '#22272d' : '#2b3138';
    const materials = [new MeshStandardMaterial({ color: new Color(shade), roughness: .5, metalness: .04, side: DoubleSide })];
    return { geometry, materials, name: m.name };
  }), [meshes]);
  useEffect(() => () => resources.forEach(r => { r.geometry.dispose(); r.materials.forEach(m => m.dispose()); }), [resources]);
  return <group>{resources.map((r, i) => <mesh key={i} geometry={r.geometry} material={r.materials.length > 1 ? r.materials : r.materials[0]} castShadow receiveShadow name={r.name} dispose={null} />)}</group>;
}

function BuiltinShell({ model }: { model: Model3D }) {
  const geometries = useMemo(() => {
    // Original mathematical pill. No upstream triangles or model assets.
    const body = new ExtrudeGeometry(outline(96, 37, 18), { depth: 21, bevelEnabled: true, bevelSegments: 4, steps: 1, bevelSize: 1, bevelThickness: 2, curveSegments: 32 });
    const front = outline(95, 36, 18, -1.5);
    const [sx, sy] = model.screen.center, [sw, sh] = model.screen.size;
    front.holes.push(new Path(outline(sw, sh, .8, sx, sy).getPoints(32)));
    const knob = new Path(); knob.absarc(model.knob.center[0], model.knob.center[1], 13.7, 0, Math.PI * 2, true); front.holes.push(knob);
    const bezel = new ExtrudeGeometry(front, { depth: 1.1, bevelEnabled: false, curveSegments: 48 });
    return { body, bezel };
  }, [model]);
  useEffect(() => () => { geometries.body.dispose(); geometries.bezel.dispose(); }, [geometries]);
  return <group>
    <mesh geometry={geometries.body} position={[-1.5, 0, .4]} castShadow receiveShadow><meshStandardMaterial color="#303943" roughness={.38} metalness={.12} /></mesh>
    <mesh geometry={geometries.bezel} position={[0, 0, -2.2]} castShadow receiveShadow><meshStandardMaterial color="#65717c" roughness={.48} metalness={.15} side={DoubleSide} /></mesh>
    <RoundedBox args={[91, 33, 1.6]} radius={.75} position={[-1.5, 0, 23.9]}><meshStandardMaterial color="#252d36" roughness={.58} /></RoundedBox>
    <RoundedBox args={[.7, 10, 4]} radius={.32} position={[-50.55, 0, 12]}><meshStandardMaterial color="#090c10" roughness={.7} /></RoundedBox>
    <RoundedBox args={[.72, 8.3, 2.2]} radius={.3} position={[-50.95, 0, 12]}><meshStandardMaterial color="#929ba3" metalness={.8} roughness={.27} /></RoundedBox>
    <RoundedBox args={[.75, 6.6, 1]} radius={.25} position={[-51.35, 0, 12]}><meshStandardMaterial color="#080b0e" /></RoundedBox>
    {[-28, 27].flatMap(x => [-14.8, 14.8].map(y => <mesh key={`${x}:${y}`} position={[x, y, 25]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[1.1, 1.1, .3, 16]} /><meshStandardMaterial color="#697580" metalness={.8} roughness={.3} /></mesh>))}
  </group>;
}

function LiveScreen({ model, frame, rotation, displayOn }: Pick<Props, 'model' | 'frame' | 'rotation' | 'displayOn'>) {
  const invalidate = useThree(s => s.invalidate);
  const [texture, canvas, source] = useMemo(() => {
    const target = document.createElement('canvas'); target.width = 320; target.height = 170;
    const texture = new CanvasTexture(target); texture.colorSpace = SRGBColorSpace;
    texture.minFilter = NearestFilter; texture.magFilter = NearestFilter; texture.generateMipmaps = false;
    return [texture, target, document.createElement('canvas')] as const;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => {
    const angle = ((rotation + model.screen.rotate) % 360 + 360) % 360;
    if (frame) {
      source.width = frame.width; source.height = frame.height;
      source.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
      canvas.width = angle % 180 ? frame.height : frame.width; canvas.height = angle % 180 ? frame.width : frame.height;
    }
    const context = canvas.getContext('2d')!;
    context.resetTransform(); context.fillStyle = '#000'; context.fillRect(0, 0, canvas.width, canvas.height);
    if (frame && displayOn) {
      context.imageSmoothingEnabled = false;
      context.translate(canvas.width / 2, canvas.height / 2); context.rotate(angle * radians);
      context.drawImage(source, -source.width / 2, -source.height / 2); context.resetTransform();
    }
    texture.needsUpdate = true; invalidate();
  }, [frame, rotation, model.screen.rotate, displayOn, canvas, source, texture, invalidate]);
  const [x, y, z] = model.screen.center;
  return <group position={[x, y, z]} rotation={[Math.PI, 0, 0]}>
    <mesh><planeGeometry args={model.screen.size} /><meshBasicMaterial map={texture} toneMapped={false} /></mesh>
    <mesh position={[0, 0, .035]}><planeGeometry args={model.screen.size} /><meshPhysicalMaterial color="#b5cfde" transparent opacity={.055} roughness={.18} metalness={.05} depthWrite={false} /></mesh>
  </group>;
}

function Interactives({ model, enabled, turn, press, release, blockOrbit }: Pick<Props, 'model' | 'enabled' | 'turn' | 'press' | 'release'> & { blockOrbit: (value: boolean) => void }) {
  const invalidate = useThree(s => s.invalidate), gl = useThree(s => s.gl);
  const [hover, setHover] = useState(''), [angle, setAngle] = useState(0), [held, setHeld] = useState('');
  const hoveredControl = useRef('');
  const gesture = useRef<{ control: 'knob' | 'key'; pointerId: number; startY: number; steps: number; dragging: boolean; pressed: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const endClick = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callback = useRef({ turn, press, release }); callback.current = { turn, press, release };
  useEffect(() => {
    const finish = (cancel = false) => {
      const g = gesture.current; if (!g) return;
      clearTimeout(g.timer);
      if (g.pressed) callback.current.release(g.control);
      else if (!cancel && !g.dragging) {
        callback.current.press(g.control);
        endClick.current = setTimeout(() => callback.current.release(g.control), 90);
      }
      gesture.current = null; setHeld(''); setHover(hoveredControl.current);
      if (gl.domElement.hasPointerCapture(g.pointerId)) gl.domElement.releasePointerCapture(g.pointerId);
      blockOrbit(!!hoveredControl.current);
      gl.domElement.style.cursor = hoveredControl.current === 'knob' ? 'ns-resize' : hoveredControl.current ? 'pointer' : 'grab'; invalidate();
    };
    const move = (event: PointerEvent) => {
      const g = gesture.current; if (!g || g.control !== 'knob') return;
      const distance = g.startY - event.clientY;
      if (Math.abs(distance) > 4) {
        g.dragging = true; clearTimeout(g.timer);
        if (g.pressed) { callback.current.release('knob'); g.pressed = false; setHeld(''); }
      }
      if (!g.dragging) return;
      const steps = Math.trunc(distance / 12), delta = steps - g.steps;
      if (delta) { callback.current.turn(delta); g.steps = steps; setAngle(a => a + delta * 18 * radians); invalidate(); }
    };
    const up = () => finish(), cancel = () => finish(true);
    // R3F's delegated wheel listener can be passive. A native capture listener
    // keeps knob scrolling from scrolling the device panel or zooming Orbit.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!enabled || hoveredControl.current !== 'knob' || !event.deltaY) return;
      event.stopImmediatePropagation();
      const unit = event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? 1 : 100;
      const steps = Math.sign(event.deltaY) * Math.max(1, Math.round(Math.abs(event.deltaY) / unit));
      callback.current.turn(steps); setAngle(a => a + steps * 18 * radians); invalidate();
    };
    gl.domElement.addEventListener('wheel', wheel, { capture: true, passive: false });
    gl.domElement.addEventListener('lostpointercapture', cancel);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
    return () => { cancel(); clearTimeout(endClick.current); callback.current.release('knob'); callback.current.release('key'); gl.domElement.style.cursor = ''; gl.domElement.removeEventListener('wheel', wheel, true); gl.domElement.removeEventListener('lostpointercapture', cancel); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); };
  }, [blockOrbit, gl, invalidate, enabled]);
  const events = (control: 'knob' | 'key') => ({
    onPointerOver: (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); if (!enabled) return; hoveredControl.current = control; setHover(control); blockOrbit(true); gl.domElement.style.cursor = control === 'knob' ? 'ns-resize' : 'pointer'; },
    onPointerOut: () => { hoveredControl.current = ''; if (!gesture.current) { setHover(''); blockOrbit(false); gl.domElement.style.cursor = 'grab'; } },
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation(); if (!enabled || event.button !== 0 || gesture.current) return;
      blockOrbit(true); event.nativeEvent.preventDefault();
      const g = { control, pointerId: event.pointerId, startY: event.clientY, steps: 0, dragging: false, pressed: control === 'key', timer: undefined as ReturnType<typeof setTimeout> | undefined };
      gesture.current = g;
      gl.domElement.setPointerCapture(event.pointerId);
      if (control === 'key') { press(control); setHeld(control); }
      // A short threshold distinguishes a turn from a push. A held stationary
      // pointer stays pressed until release; a quick click is a 90ms pulse.
      else g.timer = setTimeout(() => { if (gesture.current === g && !g.dragging) { g.pressed = true; callback.current.press(control); setHeld(control); } }, 160);
    },
  });
  return <>
    <group position={model.knob.center} rotation={[0, 0, angle]} name="encoder-knob" {...events('knob')}>
      <group position={[0, 0, held === 'knob' ? .6 : 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[model.knob.radius - .4, model.knob.radius, model.knob.height, 80]} /><meshStandardMaterial color={hover === 'knob' ? '#8dabbf' : '#424b52'} roughness={.32} metalness={.55} /></mesh>
        {Array.from({ length: 60 }, (_, i) => { const a = i / 60 * Math.PI * 2; return <mesh key={i} position={[Math.cos(a) * (model.knob.radius - .05), Math.sin(a) * (model.knob.radius - .05), 0]} rotation={[0, 0, a]}><boxGeometry args={[.45, .48, model.knob.height - 1]} /><meshStandardMaterial color={hover === 'knob' ? '#a3c1d6' : '#75818a'} roughness={.4} metalness={.6} /></mesh>; })}
        <mesh position={[0, 0, -model.knob.height / 2 - .04]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[model.knob.radius - 1.15, model.knob.radius - 1.15, .15, 80]} /><meshStandardMaterial color="#303940" metalness={.4} roughness={.36} /></mesh>
        <mesh position={[0, -8.7, -model.knob.height / 2 - .15]}><boxGeometry args={[1, 3.5, .12]} /><meshBasicMaterial color="#cbd9e4" /></mesh>
      </group>
    </group>
    <group position={model.key.center} name="user-key" {...events('key')}>
      <RoundedBox args={model.key.size} radius={.8} position={[0, held === 'key' ? .65 : 0, 0]}><meshStandardMaterial color={hover === 'key' ? '#d8f2ff' : '#a9bac9'} roughness={.4} metalness={.3} /></RoundedBox>
    </group>
  </>;
}

function Stage(props: Props & { orbitBlocked: boolean; blockOrbit: (value: boolean) => void }) {
  const controls = useRef<Controls>(null), invalidate = useThree(s => s.invalidate);
  useEffect(() => { controls.current?.reset(); invalidate(); }, [props.reset, invalidate]);
  return <>
    <color attach="background" args={['#101720']} />
    <ambientLight intensity={.55} />
    <directionalLight position={[-65, 100, 100]} intensity={2.2} />
    <directionalLight position={[80, 15, -50]} intensity={1.8} color="#a8c5e5" />
    <Environment resolution={64} frames={1}>
      <Lightformer position={[-40, 60, 50]} scale={[100, 50, 1]} intensity={2.5} />
      <Lightformer position={[60, -20, 30]} rotation={[0, -Math.PI / 3, 0]} scale={[60, 90, 1]} intensity={1.3} />
    </Environment>
    <group rotation={[Math.PI, 0, 0]}>
      {props.meshes ? <OfficialShell meshes={props.meshes} /> : <BuiltinShell model={props.model} />}
      <LiveScreen {...props} /><LedRing {...props} /><Interactives {...props} />
    </group>
    <ContactShadows position={[0, -26, 0]} opacity={.45} scale={210} blur={2.5} far={80} resolution={256} frames={1} />
    <OrbitControls ref={controls} makeDefault enabled={!props.orbitBlocked} enableDamping dampingFactor={.12} minDistance={75} maxDistance={320} target={[0, 0, -8]} />
  </>;
}
function DeviceScene(props: Props) {
  const [orbitBlocked, blockOrbit] = useState(false), [localReset, setLocalReset] = useState(0);
  return <div className="device-scene" onDoubleClick={() => setLocalReset(value => value + 1)}>
    <Canvas frameloop="demand" dpr={[1, 1.6]} camera={{ position: [55, 65, 140], fov: 35, near: .1, far: 1500 }} gl={{ antialias: true }} aria-label="3D device with live firmware screen; use controls below or keyboard for device input">
      <Stage {...props} reset={props.reset + localReset} orbitBlocked={orbitBlocked} blockOrbit={blockOrbit} />
    </Canvas>
  </div>;
}
export default memo(DeviceScene);
