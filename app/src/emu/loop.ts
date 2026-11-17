// Platform-independent engine. Scheduling, WASM initialization and I/O belong to
// the host, so this same code can be exercised by the browser and Node smoke test.
export type Chip = 'esp32s3' | 'esp32c3';
export interface Emulator {
  load_default_rom(): void;
  load_firmware(bytes: Uint8Array): void;
  run_batch(count: number): string;
  pc(): number;
  cycles(): bigint | number;
  faulted(): boolean;
  fault_report(): string;
  gpio_state(): Uint32Array;
  uart_input(bytes: Uint8Array): void;
  needs_restart(): boolean;
  restart(): void;
  wifi_tx_drain(): unknown;
  free(): void;
}
export type EmulatorConstructor = new (chip: string) => Emulator;
export interface Snapshot {
  chip: Chip;
  pc: number;
  cycles: string;
  faulted: boolean;
  fault_report: string | null;
  gpio_state: number[];
  running: boolean;
  mips: number;
}

export class EmulatorLoop {
  private emulator: Emulator | null = null;
  private chip: Chip = 'esp32s3';
  private firmware: Uint8Array | null = null;
  private active = false;
  private instructions = 0;
  private rateStart = 0;
  constructor(private readonly EmulatorClass: EmulatorConstructor, private readonly now = () => performance.now()) {}

  load(chip: Chip, firmware: Uint8Array): void {
    this.pause();
    this.emulator?.free();
    this.emulator = null;
    this.firmware = null;
    const emulator = new this.EmulatorClass(chip);
    try {
      emulator.load_default_rom();
      emulator.load_firmware(firmware);
    } catch (error) {
      emulator.free();
      throw error;
    }
    this.emulator = emulator;
    this.chip = chip;
    this.firmware = firmware.slice();
    this.resetRate();
  }

  private resetRate(): void { this.instructions = 0; this.rateStart = this.now(); }
  resume(): void {
    if (!this.emulator) throw new Error('Load a firmware .bin before running.');
    if (this.emulator.faulted()) throw new Error('Reset the CPU before resuming after a fault.');
    if (!this.active) this.resetRate();
    this.active = true;
  }
  pause(): void { this.active = false; }
  get running(): boolean { return this.active; }
  reset(): void {
    if (!this.firmware) throw new Error('Load a firmware .bin before resetting.');
    // Recreate the machine so firmware mutations and peripheral state are reset.
    this.load(this.chip, this.firmware);
  }
  uartInput(bytes: Uint8Array): void { this.emulator?.uart_input(bytes); }

  slice(batchSize = 200_000, budgetMs = 12): string {
    if (!this.active || !this.emulator) return '';
    if (batchSize < 50_000 || batchSize > 200_000) throw new RangeError('Batch size must be 50,000–200,000.');
    const started = this.now();
    let output = '';
    try {
      do {
        output += this.emulator.run_batch(batchSize);
        this.instructions += batchSize;
        if (this.emulator.needs_restart()) { this.emulator.restart(); break; }
        if (this.emulator.faulted()) { this.pause(); break; }
        // No network relay is connected; avoid accumulating firmware TX frames.
        this.emulator.wifi_tx_drain();
      } while (this.active && this.now() - started < budgetMs);
    } catch (error) {
      this.pause();
      throw error;
    }
    return output;
  }

  snapshot(): Snapshot | null {
    if (!this.emulator) return null;
    const elapsed = this.now() - this.rateStart;
    const faulted = this.emulator.faulted();
    const snapshot: Snapshot = {
      chip: this.chip, pc: this.emulator.pc(), cycles: String(this.emulator.cycles()),
      faulted, fault_report: faulted ? this.emulator.fault_report() : null,
      gpio_state: Array.from(this.emulator.gpio_state()), running: this.active,
      mips: this.active && elapsed >= 1 ? this.instructions / elapsed / 1_000 : 0,
    };
    this.resetRate();
    return snapshot;
  }
  dispose(): void { this.pause(); this.emulator?.free(); this.emulator = null; this.firmware = null; }
}
