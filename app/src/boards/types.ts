import type { Chip } from '../emu/loop';

export type Vec3 = [number, number, number];
export interface Model3D {
  official: { url: string; sha256: string; source_page: string; license_note: string };
  units: 'mm';
  front: '-z';
  screen: { center: Vec3; size: [number, number]; rotate: number };
  knob: { center: Vec3; radius: number; height: number; axis: Vec3 };
  key: { center: Vec3; size: Vec3 };
  builtin: 'pill';
  calibration_note?: string;
}
export interface Profile {
  id: string;
  name: string;
  chip: Chip;
  flash?: string;
  psram?: string;
  board: string;
  match_hints?: string[];
  display?: { part: string; rotate: number };
  controls?: { part: string; kind: 'encoder' | 'button'; label: string }[];
  battery?: { charger: string; gauge: string };
  radio?: { part: string };
  nfc?: { part: string };
  leds?: { part: string; count: number; layout: 'ring-around-knob'; radius_mm?: number; placement_note?: string; source_page?: string };
  ir?: { tx: string; rx: string };
  model3d?: Model3D;
}
export interface PartDefinition {
  module: string;
  pins: Record<string, number>;
  addr?: number;
  en_pins?: string[];
}
export interface BoardDefinition { parts: Record<string, PartDefinition> }
