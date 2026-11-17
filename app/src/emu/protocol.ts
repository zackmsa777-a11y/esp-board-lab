import type { Chip, Snapshot } from './loop';
export type WorkerCommand =
  | { type: 'load'; chip: Chip; firmware: ArrayBuffer }
  | { type: 'pause' | 'resume' | 'reset' }
  | { type: 'uart_input'; data: Uint8Array };
export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'loaded' }
  | { type: 'uart'; text: string }
  | { type: 'status'; status: Snapshot }
  | { type: 'error'; message: string };
