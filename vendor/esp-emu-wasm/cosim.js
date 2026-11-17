// Browser side of the co-simulation bus.
//
// A page cannot open a socket, and does not need one: both halves already run
// in the same tab — the emulator on the page, each part in a Web Worker,
// joined by a MessageChannel. This module is the pump between the emulator's
// byte queues and those channels.
//
// The protocol is the one in proto/esp_cosim.proto, unchanged — same topics,
// same handshake. Only the delivery differs.
//
// Frame layout, matching src/cosim/web.rs:
//
//   [topic_len: u16 LE][topic utf-8][payload]
//
// A topic beginning with `@` is a reply addressed to one part, named after it.
// Anything else is a broadcast every part sees.

const dec = new TextDecoder();

// Instructions per batch in `start`, and so the interval at which the boundary
// is serviced: a pin edge reaches a part, and its answer reaches the guest, one
// batch of emulated time after the fact. A part that must respond within some
// window needs a batch shorter than it. 5000 is about 31 us at 160 MHz.
//
// The size costs nothing in throughput — see how `start` yields.
const BATCH_INSTRUCTIONS = 5000;

// The longest the loop sleeps to let the wall clock catch up, in ms. Part
// messages are delivered between batches, so an uncapped wait over a guest's
// long `vTaskDelay` would leave a pressed button unanswered for as long as the
// guest sleeps. 20 ms is below what a person notices.
const MAX_PACE_MS = 20;

// How long the loop waits for a part to answer a bus transaction, in ms of
// wall time, before it stops and names the part. The emulator runs nothing
// while it waits, so the firmware cannot observe the wait; the native run loop
// gives up after the same 5 s.
const DEVICE_REPLY_TIMEOUT_MS = 5000;

/** Split one frame into { topic, payload }. */
export function unpackFrame(frame) {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const n = view.getUint16(0, true);
  return {
    topic: dec.decode(frame.subarray(2, 2 + n)),
    payload: frame.subarray(2 + n),
  };
}

/**
 * Pumps frames between a WasmEmulator and one or more part workers.
 *
 * `start()` runs the guest and pumps after each batch; a page driving its own
 * loop calls `drain()` after each `run_batch` instead. Nothing here blocks: a
 * part's message is taken on whichever later pass finds it queued, and while a
 * bus transaction waits on a part the emulator runs nothing, so `run_batch`
 * returns at once until the answer is in. That is what lets this work without
 * SharedArrayBuffer — and so without COOP/COEP headers, which would stop
 * index.html loading xterm.js.
 *
 * Each part is a named peer. A broadcast goes to all of them; a reply, whose
 * topic is `@name`, goes only to the one it is addressed to. Naming them is
 * what lets the emulator route by claim — two parts are two peers, each with
 * its own pins, not one identity holding both.
 */
export class CosimPump {
  /**
   * @param {object} emu   the WasmEmulator
   * @param {Record<string, MessagePort | {port: MessagePort, worker?: Worker}>} ports
   *        part name -> its channel end, or the channel end with the Worker
   *        running the part, which lets the pump stop a part that never
   *        answers (see `start`)
   * @param {number} quantumUs  clock heartbeat, in emulated microseconds
   */
  constructor(emu, ports, quantumUs = 1000) {
    this.emu = emu;
    // One part may be passed bare. It still gets a name, because replies
    // come back addressed and are matched against these keys — an anonymous
    // part is one whose answers cannot be delivered to it.
    const one = typeof ports?.postMessage === 'function' || ports?.port;
    this.ports = {};
    this.workers = {};
    for (const [name, p] of Object.entries(one ? { part: ports } : ports)) {
      this.ports[name] = p?.port ?? p;
      if (p?.worker) this.workers[name] = p.worker;
    }
    this.running = false;

    emu.cosim_attach(quantumUs);

    // Fixed at construction, so the broadcast path does not rebuild it per
    // frame — and heartbeats alone are hundreds a second.
    this.targets = Object.values(this.ports);

    for (const [name, port] of Object.entries(this.ports)) {
      port.onmessage = (ev) => {
        emu.cosim_push_inbound(name, new Uint8Array(ev.data));
      };
    }
  }

  /**
   * Pump the boundary without running the guest, until a part registers or
   * `timeoutMs` passes. Resolves to whether one attached.
   *
   * A worker takes a moment to load its module, and the emulator would
   * otherwise run through the firmware's whole startup before anyone was
   * listening.
   */
  async waitForDevice(timeoutMs = 5000) {
    return this.pumpUntil(() => this.emu.cosim_has_consumer(), timeoutMs);
  }

  /**
   * Pump the boundary without running the guest until `done()` or `timeoutMs`.
   * Resolves to whether it finished rather than timed out.
   *
   * A page with several parts waits for all of them, which the handshake alone
   * cannot express — `cosim_has_consumer` is true once the FIRST attaches.
   */
  async pumpUntil(done, timeoutMs = 8000) {
    const until = performance.now() + timeoutMs;
    while (performance.now() < until) {
      this.emu.cosim_service();
      this.drain();
      if (done()) return true;
      await new Promise((r) => setTimeout(r, 5));
    }
    return false;
  }

  /**
   * Run the guest until `stop()`, pumping the boundary after each batch.
   *
   * The loop lives here rather than in the page because the batch size is the
   * emulator's business, and because a page that only wanted to run firmware
   * would otherwise have to know that a batch has to be followed by a drain.
   *
   * `onOutput` is handed whole lines. A batch ends wherever the instruction
   * count ran out, which is usually mid-line, so without holding the tail here
   * one write arrives as two fragments — and a consumer splitting on newlines
   * parses each as a line. The remainder is flushed by `stop`.
   *
   * A restart the firmware asks for (`esp_restart`, a panic that reboots, a
   * watchdog) ends its batch, and the loop performs it before the next one.
   * The parts stay attached: the boundary survives the reset, and they see
   * emulated time start again from zero.
   *
   * The loop keeps the guest to the wall clock: after every batch it asks the
   * emulator how far emulated time has run ahead of `performance.now()`
   * (`throttle_delay_ms`, the browser's half of native `maybe_throttle`) and
   * sleeps that long. Without it `vTaskDelay` is almost free — the scheduler
   * fast-forwards to the next deadline — so a firmware's one-second heartbeat
   * prints hundreds of times a second. A wait is capped at `MAX_PACE_MS`, so a
   * guest asleep for a long time still has its parts' messages delivered and
   * the page stays live.
   *
   * While a part answers a bus transaction the emulator runs nothing, and the
   * answer arrives from the part's worker on a later turn. A part that has not
   * answered after `DEVICE_REPLY_TIMEOUT_MS` stops the loop through `onError`,
   * naming the transaction and the part; every Worker the constructor was
   * given is terminated first, since a part that is spinning would otherwise
   * go on taking a core after the page has reported it.
   *
   * @param {(text: string) => void} onOutput  called with UART output, always
   *        ending on a newline — see above
   * @param {(err: unknown) => void} [onError]  called once if a batch throws or the
   *        machine faults (the error's message is the fault report); the loop stops
   */
  start(onOutput, onError) {
    if (this.running) return;
    this.running = true;
    this._out = '';
    this._onOutput = onOutput;
    this._waitingSince = null;
    const step = () => {
      if (!this.running) return;
      let out;
      let fault = null;
      try {
        out = this.emu.run_batch(BATCH_INSTRUCTIONS);
        if (this.emu.faulted()) fault = this.emu.fault_report();
        if (this.emu.needs_restart()) this.emu.restart();
        this.drain();
        if (this.emu.cosim_awaiting_device()) {
          this._waitingSince ??= performance.now();
          if (performance.now() - this._waitingSince > DEVICE_REPLY_TIMEOUT_MS) {
            for (const w of Object.values(this.workers)) w.terminate();
            throw new Error(
              `a part did not answer within ${DEVICE_REPLY_TIMEOUT_MS / 1000} s: ${this.emu.cosim_awaited()}`
            );
          }
        } else {
          this._waitingSince = null;
        }
      } catch (e) {
        // Stop rather than spin: a fault in one batch repeats in the next.
        this.stop();
        if (onError) onError(e);
        else console.error('co-simulation: run loop stopped', e);
        return;
      }
      if (out) {
        this._out += out;
        const cut = this._out.lastIndexOf('\n');
        if (cut >= 0) {
          // Taken out of the tail BEFORE the handler sees it. A page that stops
          // the loop on a line it recognises calls `stop` from inside this
          // call, and `stop` flushes whatever is left — which was these same
          // lines a second time.
          const whole = this._out.slice(0, cut + 1);
          this._out = this._out.slice(cut + 1);
          onOutput(whole);
        }
      }
      if (fault !== null) {
        // After the output above, so the console ends on what led to it
        this.stop();
        const e = new Error(fault);
        if (onError) onError(e);
        else console.error('co-simulation: run loop stopped', e);
        return;
      }
      const lag = this.emu.throttle_delay_ms(performance.now());
      if (lag > 0) {
        setTimeout(step, Math.min(lag, MAX_PACE_MS));
        return;
      }
      this._yield(step);
    };
    step();
  }

  /**
   * Hand control back to the browser, then continue.
   *
   * A MessageChannel rather than `setTimeout(fn, 0)`: nested timeouts are
   * clamped to 4 ms by the HTML spec, which puts a hard ceiling of 250
   * batches a second on the loop. A channel message is an ordinary task with
   * no clamp, so the batch size stops being a throughput decision and becomes
   * purely an accuracy one.
   *
   * It still yields — the task queue is drained between messages — so the
   * page paints, a click is handled, and a part worker's message gets delivered.
   */
  _yield(step) {
    const ch = (this._yieldCh ??= new MessageChannel());
    ch.port1.onmessage = step;
    ch.port2.postMessage(0);
  }

  /**
   * Stop the loop started by `start`. Safe to call when it is not running.
   * Flushes whatever text has no newline after it yet, which is otherwise
   * held back — firmware that stops mid-line would lose its last words.
   */
  stop() {
    this.running = false;
    if (this._out) {
      const rest = this._out;
      this._out = '';
      this._onOutput?.(rest);
    }
  }

  /** Hand every waiting frame to whichever part it is for. */
  drain() {
    for (;;) {
      const frame = this.emu.cosim_take_outbound();
      if (!frame || frame.length === 0) return;
      // The address marker is the topic's first byte, so the common case needs
      // no DataView and no UTF-8 decode — which matters because every clock
      // heartbeat comes through here. The length is checked first: with no
      // topic, byte 2 is payload and could be anything.
      const named = (frame[0] | (frame[1] << 8)) > 0 && frame[2] === 0x40; /* '@' */
      if (named) {
        const { topic } = unpackFrame(frame);
        // Addressed. A reply for a part that has gone is dropped, not handed
        // to whoever happens to be first: a wrong match would deliver one
        // part's answer to another.
        const port = this.ports[topic.slice(1)];
        if (!port) {
          console.warn(`co-simulation: reply for unknown part ${topic.slice(1)}`);
          continue;
        }
        // Transfer the buffer rather than copying it: the emulator has no
        // further use for the bytes.
        port.postMessage(frame.buffer, [frame.buffer]);
      } else {
        // A broadcast. Each part decides for itself whether it cares, which is
        // what subscription does on a socket.
        const targets = this.targets;
        targets.forEach((port, i) => {
          // The last one may take the buffer; the others need their own copy.
          const isLast = i === targets.length - 1;
          const buf = isLast ? frame.buffer : frame.slice().buffer;
          port.postMessage(buf, [buf]);
        });
      }
    }
  }
}
