import type { BoardDefinition } from '../../boards/types';

// The generated protobufjs bundle is loaded unchanged in both Node and the
// worker. Its dynamic message types deliberately stop at this protocol boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Codec = any;
export interface CosimEmulator {
  cosim_attach(quantumUs: number): void;
  cosim_push_inbound(peer: string, payload: Uint8Array): void;
  cosim_take_outbound(): Uint8Array | undefined;
  cosim_service(): void;
  cosim_awaiting_device(): boolean;
  cosim_awaited(): string;
}
interface PartExports {
  memory: WebAssembly.Memory;
  part_abi_version(): number;
  part_buffer(): number;
  part_buffer_len(): number;
  part_configure(len: number): void;
  part_register(): number;
  part_on_pins(levels: bigint, now: bigint): void;
  part_poll(now: bigint): number;
  part_on_input(len: number): void;
  part_on_bus?(len: number): number;
  part_on_message?(len: number): void;
  part_state?(): number;
  ebl_fb_ptr?(): number;
  ebl_fb_width?(): number;
  ebl_fb_height?(): number;
  ebl_fb_seq?(): number;
}
interface Part {
  name: string; module: string; exports?: PartExports; ready: boolean;
  levels: bigint; now: bigint; error?: string; seq?: number;
}
export interface PartSnapshot {
  name: string; module: string; ready: boolean;
  values: Record<string, string>; error?: string;
}
export interface DisplayFrame { part: string; width: number; height: number; seq: number; rgba: ArrayBuffer }
export interface ExportRead {
  part: string;
  name: string;
  args?: number[];
  /** Read bytes at the returned pointer; otherwise return the scalar value. */
  lengthExport?: string;
  lengthArgs?: number[];
  byteLength?: number;
}
export type ExportValue = number | ArrayBuffer;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const big = (value: unknown): bigint => value == null ? 0n : BigInt(String(value));

/** All parts share the CPU worker's call stack: no bus transaction awaits IO. */
export class PartHost {
  private parts = new Map<string, Part>();
  readonly traffic = { spi: 0, i2c: 0, gpio: 0, frames: 0 };
  constructor(private emu: CosimEmulator, private pb: Codec) { emu.cosim_attach(1000); }

  async attach(board: BoardDefinition, read: (module: string) => Promise<Uint8Array>): Promise<void> {
    for (const [name, definition] of Object.entries(board.parts)) {
      const part: Part = { name, module: definition.module, ready: false, levels: 0xffffffffffffffffn, now: 0n };
      this.parts.set(name, part);
      try {
        const { instance } = await WebAssembly.instantiate(await read(definition.module) as BufferSource, {});
        const e = instance.exports as unknown as PartExports;
        const required = ['memory', 'part_abi_version', 'part_buffer', 'part_buffer_len', 'part_configure', 'part_register', 'part_on_pins', 'part_poll', 'part_on_input'];
        for (const key of required) if (!(key in e)) throw new Error(`missing ABI export ${key}`);
        if (e.part_abi_version() !== this.pb.PartAbiVersion.PART_ABI_VERSION_CURRENT) throw new Error('unsupported part ABI version');
        part.exports = e;
        const config = this.pb.PartConfig.encode(this.pb.PartConfig.create({ ...definition, enPins: definition.en_pins })).finish();
        this.give(part, config); e.part_configure(config.length);
        const registration = this.pb.Register.decode(this.take(part, e.part_register(), true));
        for (const claim of registration.claims ?? []) {
          if ((claim.i2c || claim.spi) && !e.part_on_bus) throw new Error('bus claim requires part_on_bus');
          if ((claim.uart || big(claim.gpio?.pwmPins) || claim.dsi) && !e.part_on_message) throw new Error('message claim requires part_on_message');
          if (claim.i2s || claim.dvp) throw new Error('I2S/DVP claims are not supported by the part ABI');
          if (claim.dsi && e.part_buffer_len() < 131072) throw new Error('DSI part buffer must hold 131072 bytes');
        }
        this.send(part, this.pb.EmulatorMessage.encode({ register: registration }).finish());
      } catch (error) { this.fail(part, error); }
    }
    this.service();
    for (const part of this.parts.values()) if (!part.error && !part.ready) this.fail(part, new Error('registration was not acknowledged'));
  }
  private fail(part: Part, error: unknown): void { part.error ??= error instanceof Error ? error.message : String(error); }
  private guard(part: Part, fn: () => void): void { if (!part.error) try { fn(); } catch (error) { this.fail(part, error); } }
  private give(part: Part, bytes: Uint8Array): void {
    const e = part.exports!;
    if (bytes.length > e.part_buffer_len()) throw new Error(`${bytes.length} bytes exceed part buffer ${e.part_buffer_len()}`);
    const pointer = e.part_buffer();
    new Uint8Array(e.memory.buffer, pointer, bytes.length).set(bytes);
  }
  private take(part: Part, len: number, required = false): Uint8Array | null {
    const e = part.exports!;
    if (len < 0 || len > e.part_buffer_len()) throw new Error(`invalid part output length ${len}`);
    if (!len) { if (required) throw new Error('part returned no response'); return null; }
    const pointer = e.part_buffer();
    return new Uint8Array(e.memory.buffer, pointer, len).slice();
  }
  private send(part: Part, bytes: Uint8Array): void { this.emu.cosim_push_inbound(part.name, bytes); }
  // Parts may stage a bounded lookahead of future edges at the current time.
  // Drain that batch, but cap work so a faulty part cannot starve the CPU worker.
  private poll(part: Part): void {
    for (let i = 0; i < 64; i++) {
      const bytes = this.take(part, part.exports!.part_poll(part.now));
      if (!bytes) break;
      this.send(part, bytes);
    }
  }
  private message(part: Part, payload: Uint8Array): void {
    if (!part.exports!.part_on_message) throw new Error('part cannot handle one-way message');
    this.give(part, payload); part.exports!.part_on_message(payload.length);
  }
  private frame(part: Part, payload: Uint8Array, msg: Codec): void {
    const e = part.exports!;
    part.now = big(msg.simTimeNs);
    if (msg.registerAck) {
      if (!msg.registerAck.accepted) throw new Error(`registration refused: ${msg.registerAck.rejectReason}`);
      part.ready = true; part.levels = big(msg.registerAck.pinLevels);
      e.part_on_pins(part.levels, part.now);
      if (msg.registerAck.enLow && e.part_on_message) this.message(part, this.pb.EmulatorMessage.encode({ simTimeNs: msg.simTimeNs, enLevel: { level: false } }).finish());
      this.poll(part); return;
    }
    if (!part.ready) return;
    if (msg.busRequest) {
      const request = msg.busRequest;
      request.spi ? this.traffic.spi++ : this.traffic.i2c++;
      if (!e.part_on_bus) throw new Error('missing part_on_bus');
      const bytes = this.pb.BusRequest.encode(request).finish();
      this.give(part, bytes);
      const len = e.part_on_bus(bytes.length);
      if (request.spi && !request.spi.rxLen) return;
      const reply = this.pb.BusReply.decode(this.take(part, len, true));
      if (big(reply.correlationId) !== big(request.correlationId)) throw new Error('BusReply correlation_id does not match its request');
      const expectedOp = request.spi ? this.pb.BusOp.BUS_OP_SPI : this.pb.BusOp.BUS_OP_I2C;
      if (reply.op !== expectedOp) throw new Error('BusReply op does not match its request');
      if (big(reply.correlationId) !== big(request.correlationId)) throw new Error('BusReply correlation mismatch');
      if (reply.op !== (request.spi ? this.pb.BusOp.BUS_OP_SPI : this.pb.BusOp.BUS_OP_I2C)) throw new Error('BusReply op mismatch');
      this.send(part, this.pb.EmulatorMessage.encode({ busReply: reply }).finish()); return;
    }
    if (msg.uartTx || msg.pwmState || msg.dsiEvent || (msg.enLevel && e.part_on_message)) this.message(part, payload);
    if (msg.chipReset) { part.levels = big(msg.chipReset.pinLevels); e.part_on_pins(part.levels, part.now); }
    if (msg.gpioLevel) {
      this.traffic.gpio++;
      const bit = 1n << big(msg.gpioLevel.pin);
      part.levels = msg.gpioLevel.level ? part.levels | bit : part.levels & ~bit;
      e.part_on_pins(part.levels, part.now);
    }
    this.poll(part);
  }
  service(): void {
    // Answers may immediately generate more frames. Keep servicing until the
    // inbound and outbound queues settle, including a pending bus reply.
    for (let pass = 0; pass < 10000; pass++) {
      this.emu.cosim_service();
      let delivered = false;
      for (;;) {
        const frame = this.emu.cosim_take_outbound();
        if (!frame?.length) break;
        delivered = true; this.traffic.frames++;
        if (frame.length < 2) throw new Error('truncated cosim frame');
        const length = frame[0] | frame[1] << 8;
        if (length + 2 > frame.length) throw new Error('truncated cosim topic');
        const topic = decoder.decode(frame.subarray(2, 2 + length));
        const payload = frame.subarray(2 + length);
        const msg = this.pb.EmulatorMessage.decode(payload);
        const targets = topic.startsWith('@') ? [this.parts.get(topic.slice(1))] : this.parts.values();
        for (const part of targets) if (part?.exports) this.guard(part, () => this.frame(part, payload, msg));
      }
      if (!delivered) {
        if (this.emu.cosim_awaiting_device()) throw new Error(`unanswered synchronous transaction: ${this.emu.cosim_awaited()}; ${JSON.stringify(this.states())}`);
        return;
      }
    }
    throw new Error('cosim queues did not settle');
  }
  input(name: string, input: string): void {
    const part = this.parts.get(name);
    if (!part?.exports || !part.ready || part.error) throw new Error(`${name}: ${part?.error ?? 'part is not attached'}`);
    const bytes = encoder.encode(input);
    // A rejected upload is recoverable; never disable an otherwise healthy part.
    if (bytes.length > part.exports.part_buffer_len()) throw new Error(`File input is ${bytes.length} bytes; ${name} accepts up to ${part.exports.part_buffer_len()} UTF-8 bytes including the input prefix.`);
    this.guard(part, () => { this.give(part, bytes); part.exports!.part_on_input(bytes.length); if (part.ready) this.poll(part); });
    this.service();
    if (part.error) throw new Error(`${name}: ${part.error}`);
  }
  readExport(request: ExportRead): ExportValue {
    const part = this.parts.get(request.part);
    if (!part?.exports || !part.ready || part.error) throw new Error(`${request.part}: ${part?.error ?? 'part is not attached'}`);
    const e = part.exports;
    const call = (name: string, args: number[] = []) => {
      if (!/^ebl_[a-z0-9_]+$/.test(name)) throw new Error('Only ebl_* extra exports may be read');
      if (args.length > 4 || args.some(arg => !Number.isSafeInteger(arg) || arg < 0 || arg > 0xffffffff)) throw new Error('Invalid export arguments');
      const fn = (e as unknown as Record<string, unknown>)[name];
      if (typeof fn !== 'function') throw new Error(`${request.part} does not export ${name}`);
      const result: unknown = fn(...args);
      if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) throw new Error(`Invalid result from ${name}`);
      return result;
    };
    const result = call(request.name, request.args);
    if (!request.lengthExport && request.byteLength === undefined) return result;
    const length = request.lengthExport ? call(request.lengthExport, request.lengthArgs ?? request.args) : request.byteLength!;
    if (!Number.isSafeInteger(length) || length < 0 || length > 16 * 1024 * 1024 || result + length > e.memory.buffer.byteLength) throw new Error('Exported bytes are outside part memory or exceed 16 MiB');
    // Copy before another call can grow or mutate WASM memory.
    return new Uint8Array(e.memory.buffer, result, length).slice().buffer;
  }
  /** Last emulated event time, for deterministic input timing in smoke tools. */
  timeNs(name: string): bigint {
    const part = this.parts.get(name);
    if (!part) throw new Error(`Unknown part ${name}`);
    return part.now;
  }
  states(): PartSnapshot[] {
    return [...this.parts.values()].map(part => {
      let values: Record<string, string> = {};
      this.guard(part, () => { if (part.exports?.part_state) { const bytes = this.take(part, part.exports.part_state()); if (bytes) values = { ...this.pb.PartState.decode(bytes).values }; } });
      return { name: part.name, module: part.module, ready: part.ready, values, error: part.error };
    });
  }
  framebuffer(name: string, changedOnly = true): DisplayFrame | null {
    const part = this.parts.get(name); let frame: DisplayFrame | null = null;
    if (!part?.exports) return null;
    this.guard(part, () => {
      const e = part.exports!;
      if (!e.ebl_fb_ptr || !e.ebl_fb_width || !e.ebl_fb_height || !e.ebl_fb_seq) return;
      const seq = e.ebl_fb_seq();
      if (changedOnly && seq === part.seq) return;
      const width = e.ebl_fb_width(), height = e.ebl_fb_height();
      if (!width || !height || width * height > 4_194_304) throw new Error('invalid framebuffer dimensions');
      const pointer = e.ebl_fb_ptr();
      frame = { part: name, seq, width, height, rgba: new Uint8Array(e.memory.buffer, pointer, width * height * 4).slice().buffer };
      part.seq = seq;
    });
    return frame;
  }
}
