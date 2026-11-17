import type { Chip, Snapshot } from './loop';
import type { BoardDefinition, Profile } from '../boards/types';
import type { DisplayFrame, ExportRead, ExportValue, PartSnapshot } from './parts/host';
export type WorkerCommand =
  | { type: 'load'; chip: Chip; firmware: ArrayBuffer; board: BoardDefinition; profile: Profile }
  | { type: 'part_input'; part: string; input: string; requestId?: number }
  | { type: 'read-export'; requestId: number; request: ExportRead }
  | { type: 'pause' | 'resume' | 'reset' }
  | { type: 'uart_input'; data: Uint8Array };
export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'loaded' }
  | { type: 'parts'; parts: PartSnapshot[]; traffic: { spi: number; i2c: number; gpio: number; frames: number } }
  | { type: 'frame'; frame: DisplayFrame }
  | { type: 'export-result'; requestId: number; value?: ExportValue; error?: string }
  | { type: 'input-result'; requestId?: number; error?: string }
  | { type: 'uart'; text: string }
  | { type: 'status'; status: Snapshot }
  | { type: 'error'; message: string };
