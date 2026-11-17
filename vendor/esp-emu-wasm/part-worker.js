// Runs one WebAssembly part and speaks the co-simulation protocol for it.
//
// This is the glue, and it is the same glue for every part. It knows the ABI in
// proto/PART_ABI.md and nothing about any particular device: that pin 9 is a
// button, that 0x44 is a sensor, that a press means anything at all — none of
// that is here. It is inside the part's own module, which is the point.
//
// Frames are [topic_len:u16 LE][topic utf-8][payload], matching src/cosim/web.rs.
// A topic of `@name` is a reply addressed to one part; anything else is a
// broadcast. The pump does that routing, so by the time a frame arrives here it
// is already this part's business.
//
// One worker runs one part. Several parts means several workers, each a named
// peer — which is what lets the emulator route by claim rather than seeing one
// identity holding every pin.

import pb from "./vendor/esp_cosim_pb.js";
import { unpackFrame } from "./cosim.js";

const { EmulatorMessage, Register, PartConfig, BusRequest, BusReply, BusOp, PartState } = pb.esp_cosim.v1;
const enc = new TextEncoder();

/** The ABI revision this host knows how to call, from the contract itself. */
const ABI_VERSION = pb.esp_cosim.v1.PartAbiVersion.PART_ABI_VERSION_CURRENT;
// The least buffer a part that claims a DSI panel offers (PART_ABI.md).
const DSI_PART_BUFFER = 131072;

let part = null; // the instantiated module's exports
let port = null; // to the emulator
let registered = false;
/// Emulated time as of the last frame. A part is told this when it speaks
/// unprompted, so what it schedules is stamped with a time the emulator
/// recognises rather than zero.
let lastNow = 0n;
/** Every pin's level, as last known. Replaced wholesale at registration. */
let levels = 0xffffffffffffffffn; // undriven pins read high

/** protobufjs hands back 64-bit fields as Long; normalise to BigInt for wasm. */
const big = (v) =>
  typeof v === "bigint" ? v
  : typeof v === "number" ? BigInt(Math.trunc(v))
  : v == null ? 0n
  : BigInt(v.toString());

// --- the ABI ---------------------------------------------------------------

/** The part's shared buffer, as a view of its current memory. */
function buffer(len) {
  return new Uint8Array(part.memory.buffer, part.part_buffer(), len);
}

/**
 * Put `bytes` where the part will read them, or refuse.
 *
 * A part sizes its own buffer. Writing past the end would either corrupt the
 * part's other memory or throw inside a message handler.
 */
function give(bytes) {
  const cap = part.part_buffer_len();
  if (bytes.length > cap) {
    console.error(`${bytes.length} bytes will not fit a ${cap} byte part buffer`);
    return false;
  }
  new Uint8Array(part.memory.buffer, part.part_buffer(), bytes.length).set(bytes);
  return true;
}

/** Read back what an export wrote, or null if it had nothing to say. */
function taken(len) {
  if (len === 0) return null;
  const cap = part.part_buffer_len();
  if (len > cap) {
    // The part claimed to write more than its own buffer holds. Trusting that
    // would read past the end; the ABI says treat it as nothing.
    console.warn(`part wrote ${len} bytes into a ${cap} byte buffer; ignoring`);
    return null;
  }
  return buffer(len).slice();
}

/**
 * Fetch a part by URL. `no-cache` revalidates with the server on every load, so
 * a part rebuilt and copied over the old file is the one that runs, whatever
 * caching headers the server sends. A failed fetch names the URL, where
 * compiling the error page would only say the status was not ok.
 */
async function fetchPart(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`could not fetch ${url}: HTTP ${res.status}`);
  return res;
}

/**
 * Load a part module, from a URL or from its bytes (a file somebody picked).
 *
 * `{}` as the import object is deliberate and load-bearing: a part that wants
 * anything from the host fails to instantiate here rather than being handed it.
 * That is what makes a part safe to load without reading it first — no DOM, no
 * network, no filesystem, no access to this worker's memory.
 */
async function load(src) {
  const { instance } = typeof src === "string"
    ? await WebAssembly.instantiateStreaming(await fetchPart(src), {})
    : await WebAssembly.instantiate(src, {});
  const e = instance.exports;

  // Every export PART_ABI.md requires. Checking a subset only moves the
  // failure to the first call, as a TypeError with no useful name on it.
  // `part_on_bus` is optional: a part needs it only if it claims an I2C
  // address or an SPI chip select, and `part_on_message` only if it is sent
  // one-way messages (it claims a serial line or reads a pin as PWM), which is
  // checked once it has registered.
  const missing = [
    "memory", "part_abi_version", "part_buffer", "part_buffer_len",
    "part_configure", "part_register", "part_on_pins", "part_poll",
    "part_on_input",
  ].filter((n) => !(n in e));
  if (missing.length) throw new Error(`part is missing ${missing.join(", ")}`);

  const abi = e.part_abi_version();
  if (abi !== ABI_VERSION) {
    // Refuse rather than guess. Calling an ABI we do not know is how a part
    // ends up reading a buffer that means something else.
    throw new Error(`part speaks ABI ${abi}; this host speaks ${ABI_VERSION}`);
  }
  return e;
}

// --- the protocol ----------------------------------------------------------

// Outbound frames carry a topic; inbound ones do not. The pump knows which
// part this port belongs to and names it, so a message to the emulator needs
// no address and is the bare EmulatorMessage.
function send(payload) {
  // Copy out of protobufjs's pooled buffer before transferring it. Through
  // the ArrayBuffer, not `payload.slice()`: under node protobufjs encodes
  // into a Buffer, whose slice is a view, and the whole pool would go.
  const buf = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
  port.postMessage(buf, [buf]);
}

/**
 * Say that this part is broken, once, and stop taking calls.
 *
 * A part is code nobody here reviewed. It can trap (a wasm `unreachable`, an
 * out-of-bounds read), return a buffer pointer past its own memory — which
 * makes the `Uint8Array` view throw — or hand back bytes that do not decode.
 * Any of those thrown from inside a message handler is an `error` event on
 * the worker and nothing else: the page keeps saying "running" over a device
 * that has silently stopped answering. So every call into the part is
 * bracketed, and the first failure is reported as this part's own, by name.
 *
 * A part the emulator refused at the handshake is stopped the same way.
 */
let broken = false;
function fail(what, e) {
  if (broken) return;
  broken = true;
  const text = `${what}: ${e && e.message ? e.message : String(e)}`;
  console.error("part failed —", text);
  postMessage({ type: "error", text });
}

/**
 * Hand the part a bus request and send back its answer.
 *
 * The emulator sends a request only to the part that claims the address or
 * the chip select, and stops until it is answered, so a part that cannot
 * answer is reported to the page as broken here, with the reason. The pump
 * does not hear of it: the emulator stays stopped until the pump's 5 s give-up
 * names the transaction. An SPI transfer with nothing to read has completed
 * already: the part sees it, and what the call returns is not sent on.
 */
function onBusRequest(req) {
  const bytes = BusRequest.encode(req).finish();
  if (!give(bytes)) {
    fail("a bus request", new Error(`${bytes.length} bytes do not fit the part's buffer`));
    return;
  }
  const len = part.part_on_bus(bytes.length);
  if (req.spi && !req.spi.rxLen) return;
  const reply = taken(len);
  if (!reply) {
    fail("a bus request", new Error("part_on_bus returned nothing"));
    return;
  }
  // The part returns a bare BusReply; the wire carries EmulatorMessages.
  // Decoding it first means a reply that does not decode is this part's
  // error, not an undecodable message at the emulator.
  const answer = BusReply.decode(reply);
  // The emulator refuses a reply that does not quote the request; said here,
  // the reason reaches the page.
  if (big(answer.correlationId) !== big(req.correlationId)) {
    fail("a bus request", new Error(
      `its BusReply quotes correlation_id ${big(answer.correlationId)}, the request was ${big(req.correlationId)}`));
    return;
  }
  const op = req.spi ? "BUS_OP_SPI" : "BUS_OP_I2C";
  if (answer.op !== BusOp[op]) {
    fail("a bus request", new Error(`its BusReply has no op ${op}`));
    return;
  }
  send(EmulatorMessage.encode(EmulatorMessage.create({ busReply: answer })).finish());
}

/**
 * Hand the part a one-way message addressed to it: the frame's whole
 * EmulatorMessage, its time and its kind. Nothing comes back from the call
 * and nothing waits on the part: what it answers, if anything, it says from
 * the poll after this frame.
 */
function onMessage(bytes) {
  if (!give(bytes)) {
    fail("a message", new Error(`a ${bytes.length}-byte message does not fit the part's buffer`));
    return;
  }
  part.part_on_message(bytes.length);
}

/** Give the part a chance to speak, and forward it if it does. */
function pump(nowNs) {
  const out = taken(part.part_poll(nowNs));
  if (out) send(out);
}

function onFrame(frame) {
  // Frames flow from the moment the port opens, which is before the part has
  // loaded: one joining a running guest hears heartbeats first. Nothing before
  // its handshake answer is needed, because that answer carries the pin levels.
  if (broken || !part) return;
  try {
    handleFrame(frame);
  } catch (e) {
    fail("handling a frame from the emulator", e);
  }
}

function handleFrame(frame) {
  // The layout is cosim.js's to know, not a third copy of it here.
  const { payload } = unpackFrame(new Uint8Array(frame));

  let msg;
  try {
    msg = EmulatorMessage.decode(payload);
  } catch (e) {
    console.warn("undecodable frame from the emulator", e);
    return;
  }
  const now = big(msg.simTimeNs);
  lastNow = now;

  if (msg.registerAck) {
    if (!msg.registerAck.accepted) {
      // Almost always a claim collision or a version mismatch, and the reason
      // says which. The emulator drops whatever a refused part sends, so it is
      // not called again.
      fail("refused", msg.registerAck.rejectReason);
      return;
    }
    registered = true;
    // The pin levels at the moment of accept. Kept, not just forwarded: the
    // running word is what every later edge is applied to, so starting it from
    // an assumed all-high would undo every pin the firmware drove during its
    // own init the first time any other pin moved.
    levels = big(msg.registerAck.pinLevels);
    part.part_on_pins(levels, now);
    // EN low at attach is no broadcast: nothing moved. A part that follows
    // the line is told as if it just had.
    if (msg.registerAck.enLow && part.part_on_message) {
        onMessage(EmulatorMessage.encode(EmulatorMessage.create({ simTimeNs: msg.simTimeNs, enLevel: { level: false } })).finish());
        if (broken) return;
    }
    postMessage({ type: "ready", chip: msg.registerAck.chip });
    return;
  }
  if (msg.busRequest) {
    onBusRequest(msg.busRequest);
    return;
  }
  // A one-way message; every kind sent to a part this way joins this test.
  if (msg.uartTx || msg.pwmState || msg.dsiEvent) {
    onMessage(payload);
    if (broken) return;
  }
  // The chip's EN pin moved: a broadcast, so for any part that takes
  // messages at all.
  if (msg.enLevel && part.part_on_message) {
    onMessage(payload);
    if (broken) return;
  }
  if (msg.chipReset) {
    // The chip's outputs are released; the part's own state and what it
    // drives are as they were. It sees the whole word, as at the handshake,
    // since no edge is published for a reset.
    levels = big(msg.chipReset.pinLevels);
    part.part_on_pins(levels, now);
  }
  if (msg.gpioLevel) {
    // One pin moved. The part is told the whole word, so it does not have to
    // track pins it was not asked about.
    const bit = 1n << big(msg.gpioLevel.pin);
    levels = msg.gpioLevel.level ? levels | bit : levels & ~bit;
    part.part_on_pins(levels, now);
  }
  // Every frame is a chance to speak, so a part never waits for a clock tick
  // it did not ask for.
  pump(now);
}

// --- the worker ------------------------------------------------------------

onmessage = async (ev) => {
  if (broken) return;
  try {
    await handleMessage(ev.data);
  } catch (e) {
    fail(`handling '${ev.data && ev.data.type}'`, e);
  }
};

async function handleMessage(m) {
  if (m.type === "start") {
    port = m.port;
    port.onmessage = (e) => onFrame(e.data);
    try {
      part = await load(m.module);
    } catch (e) {
      postMessage({ type: "error", text: String(e.message || e) });
      return;
    }
    // Where the board put this part, before it says what it answers for. A
    // part cannot claim a pin until it knows which one it is on, and only
    // whatever describes the board knows that.
    const cfg = PartConfig.encode(PartConfig.create(m.config ?? {})).finish();
    if (!give(cfg)) {
      postMessage({ type: "error", text: `a ${cfg.length}-byte PartConfig does not fit the part's buffer` });
      return;
    }
    part.part_configure(cfg.length);

    const reg = taken(part.part_register());
    if (!reg) {
      postMessage({ type: "error", text: "part_register returned nothing" });
      return;
    }
    const registration = Register.decode(reg);
    // A part that claims an address or a chip select must answer for it.
    // Refused here, by name, rather than leaving the first transaction to it
    // waiting for an answer that cannot come.
    const bus = (registration.claims ?? []).find((c) => c.i2c || c.spi);
    if (bus && !part.part_on_bus) {
      const what = bus.i2c ? "an I2C address" : "an SPI chip select";
      fail(registration.name, new Error(`claims ${what} but exports no part_on_bus`));
      return;
    }
    // Likewise a part on a serial line must take what the chip sends it.
    const line = (registration.claims ?? []).find((c) => c.uart)?.uart;
    if (line && !part.part_on_message) {
      fail(registration.name, new Error(
        `claims the serial line on GPIO ${line.txPin ?? "?"}/${line.rxPin ?? "?"} but exports no part_on_message`));
      return;
    }
    // And a part reading a pin as PWM must take the waveform.
    const pwm = (registration.claims ?? []).reduce((all, c) => all | big(c.gpio?.pwmPins), 0n);
    if (pwm && !part.part_on_message) {
      const pins = [...Array(64).keys()].filter((n) => (pwm >> BigInt(n)) & 1n).join("/");
      fail(registration.name, new Error(`reads GPIO ${pins} as PWM but exports no part_on_message`));
      return;
    }
    // Audio reaches a consumer as messages the part ABI has no call for yet
    // (PART_ABI.md): refused by name, as the native host does.
    if ((registration.claims ?? []).some((c) => c.i2s)) {
      fail(registration.name, new Error("claims an I2S data pad, which a .wasm part cannot serve yet"));
      return;
    }
    // A DSI panel takes its commands and frames as messages, a frame's rows
    // in pieces its buffer must hold (PART_ABI.md).
    if ((registration.claims ?? []).some((c) => c.dsi)) {
      if (!part.part_on_message) {
        fail(registration.name, new Error("claims a DSI panel but exports no part_on_message"));
        return;
      }
      const cap = part.part_buffer_len() >>> 0;
      if (cap < DSI_PART_BUFFER) {
        fail(registration.name, new Error(
          `claims a DSI panel with a ${cap}-byte buffer; a panel's buffer holds at least ${DSI_PART_BUFFER}`));
        return;
      }
    }
    if ((registration.claims ?? []).some((c) => c.dvp)) {
      fail(registration.name, new Error("claims a DVP sensor, which a .wasm part cannot serve yet"));
      return;
    }
    // `addr` straps an I2C device. On a part that claims no I2C address it
    // reaches nothing, and a page that sets it should hear so.
    const addr = m.config?.addr ?? 0;
    if (addr && !(registration.claims ?? []).some((c) => c.i2c)) {
      console.warn(`${registration.name}: the board gives it addr ${addr} (0x${addr.toString(16).toUpperCase()}), ` +
        "an I2C address, but it claims none, so addr is ignored");
    }
    postMessage({ type: "loaded", name: registration.name });
    send(EmulatorMessage.encode(
      EmulatorMessage.create({ register: registration })
    ).finish());
    return;
  }

  if (m.type === "state") {
    // Somebody is looking at the part. What it shows is its own; the
    // emulator is not involved. A part without part_state shows nothing.
    if (!part) {
      postMessage({ type: "state", error: "no part is loaded" });
      return;
    }
    if (!part.part_state) {
      postMessage({ type: "state", values: null });
      return;
    }
    const bytes = taken(part.part_state());
    const values = bytes ? PartState.decode(bytes).values : {};
    postMessage({ type: "state", values });
    return;
  }

  if (m.type === "input") {
    // Somebody clicked. The emulator has no idea a person exists, so this goes
    // straight to the part and only its consequences reach the chip.
    if (!part) return;
    const bytes = enc.encode(m.kind);
    if (!give(bytes)) return;
    part.part_on_input(bytes.length);
    // Speak now rather than waiting for the emulator's next frame, so a click
    // lands promptly even while the guest is idle. `lastNow`, not zero: a
    // drive stamped 0 is always in the past, which fires immediately but
    // counts every click as a missed deadline.
    if (registered) pump(lastNow);
  }
}
