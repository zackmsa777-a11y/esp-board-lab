import type { Chip } from '../emu/loop';

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
}
export interface PartDefinition {
  module: string;
  pins: Record<string, number>;
  addr?: number;
  en_pins?: string[];
}
export interface BoardDefinition { parts: Record<string, PartDefinition> }
