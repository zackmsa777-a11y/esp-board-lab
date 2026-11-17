/**
 * Wasm-exported emulator wrapper
 */
export class WasmEmulator {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmEmulatorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmemulator_free(ptr, 0);
    }
    /**
     * Send one complete ATT PDU on L2CAP CID 0x0004.
     * @param {number} conn
     * @param {Uint8Array} pdu
     */
    ble_att_send(conn, pdu) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(pdu, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmemulator_ble_att_send(retptr, this.__wbg_ptr, conn, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Connect to the advertiser at `addr` (6 bytes, MSB first); the result is a CONNECTED event.
     * @param {Uint8Array} addr
     */
    ble_connect(addr) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(addr, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmemulator_ble_connect(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * End the link; the firmware gets Disconnection Complete, reason 0x13.
     * @param {number} conn
     */
    ble_disconnect(conn) {
        wasm.wasmemulator_ble_disconnect(this.__wbg_ptr, conn);
    }
    /**
     * BLE events since the last call: `[u32 len LE][u8 type][body]...`, len covers type + body.
     * @returns {Uint8Array}
     */
    ble_event_drain() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_ble_event_drain(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * True while `ble_hci_tx_drain` has packets.
     * @returns {boolean}
     */
    ble_hci_has_tx() {
        const ret = wasm.wasmemulator_ble_hci_has_tx(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * One H4 packet from the page's controller to the firmware.
     * @param {Uint8Array} data
     */
    ble_hci_rx_push(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmemulator_ble_hci_rx_push(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * HCI packets the firmware sent to the controller: `[u32 len LE][H4 packet]...`.
     * @returns {Uint8Array}
     */
    ble_hci_tx_drain() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_ble_hci_tx_drain(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Turn the virtual BLE central's scanner on or off.
     * @param {boolean} enable
     */
    ble_scan(enable) {
        wasm.wasmemulator_ble_scan(this.__wbg_ptr, enable);
    }
    /**
     * Attach the co-simulation boundary. `quantum_us` paces the clock
     * heartbeat; 1000 matches the native default.
     *
     * `u32` rather than `u64` so JavaScript can pass a plain number:
     * wasm-bindgen maps `u64` to `BigInt`, which would make every caller
     * write `1000n`. A quantum of hours still fits.
     *
     * Parts are told this emulator's own chip and its pad count,
     * `SOC_GPIO_PIN_COUNT`, not the length of the emulator's IO_MUX table
     * (57 on P4, 63 on S31).
     * @param {number} quantum_us
     */
    cosim_attach(quantum_us) {
        wasm.wasmemulator_cosim_attach(this.__wbg_ptr, quantum_us);
    }
    /**
     * The transaction a part has not answered, and the part: for the message
     * that gives up on it.
     * @returns {string}
     */
    cosim_awaited() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_cosim_awaited(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Whether the emulator is stopped on a bus transaction a part has not
     * answered yet. `run_batch` runs nothing while it is, and takes the
     * answer once the part's worker has sent it.
     * @returns {boolean}
     */
    cosim_awaiting_device() {
        const ret = wasm.wasmemulator_cosim_awaiting_device(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Whether a part has completed its handshake.
     * @returns {boolean}
     */
    cosim_has_consumer() {
        const ret = wasm.wasmemulator_cosim_has_consumer(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Hand in a frame received from the part the page calls `peer`.
     *
     * The name is the page's own, and replies come back addressed to it, so
     * several parts in one tab are several peers — each with its own claims.
     * @param {string} peer
     * @param {Uint8Array} data
     */
    cosim_push_inbound(peer, data) {
        const ptr0 = passStringToWasm0(peer, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(data, wasm.__wbindgen_export3);
        const len1 = WASM_VECTOR_LEN;
        wasm.wasmemulator_cosim_push_inbound(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
    /**
     * Service the boundary without running any instructions, so a part can
     * finish its handshake before the guest starts. Without it the emulator
     * races through firmware startup while the part's worker is still
     * loading, and the firmware reads its pins before anyone drives them.
     */
    cosim_service() {
        wasm.wasmemulator_cosim_service(this.__wbg_ptr);
    }
    /**
     * Next frame for a part, or an empty array when there is none.
     *
     * Layout is `[topic_len: u16 LE][topic utf-8][payload]`. A topic of
     * `@name` is a reply addressed to the part the page named `name`;
     * anything else is a broadcast.
     * @returns {Uint8Array}
     */
    cosim_take_outbound() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_cosim_take_outbound(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Emulated time in CPU-clock cycles: the clock the firmware's timers
     * count, on every chip. Divide by `cycles_per_us()` for microseconds.
     * @returns {number}
     */
    cycles() {
        const ret = wasm.wasmemulator_cycles(this.__wbg_ptr);
        return ret;
    }
    /**
     * Emulated cycles per microsecond of the chip's CPU clock, so a caller
     * can turn `cycles()` into emulated time.
     * @returns {number}
     */
    cycles_per_us() {
        const ret = wasm.wasmemulator_cycles_per_us(this.__wbg_ptr);
        return ret;
    }
    /**
     * Whether EN holds the chip in reset: the host's hold, or a part's.
     * @returns {boolean}
     */
    en_held() {
        const ret = wasm.wasmemulator_en_held(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Hand the firmware's HCI to a BLE host in the page instead of the virtual central.
     * Call before `load_app_elf`: the ELF's BLE symbols are patched for the mode set then.
     */
    enable_ble_forwarding() {
        wasm.wasmemulator_enable_ble_forwarding(this.__wbg_ptr);
    }
    /**
     * What stopped the machine, as the native CLI prints it: the firmware's
     * abort reason, the faulting PC and a backtrace (symbolicated when an app
     * ELF is loaded). Empty when not faulted.
     * @returns {string}
     */
    fault_report() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_fault_report(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Whether a CPU fault or an intercepted firmware panic stopped the
     * machine. `run_batch` and `run_until` run nothing until `restart`.
     * @returns {boolean}
     */
    faulted() {
        const ret = wasm.wasmemulator_faulted(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The live flash contents, as load_firmware takes them.
     * @returns {Uint8Array}
     */
    flash_state() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_flash_state(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get register value
     * @param {number} idx
     * @returns {number}
     */
    get_reg(idx) {
        const ret = wasm.wasmemulator_get_reg(this.__wbg_ptr, idx);
        return ret >>> 0;
    }
    /**
     * Drive a GPIO pad's input level, as a wire on the pin would.
     * @param {number} pin
     * @param {boolean} high
     */
    gpio_set_input(pin, high) {
        wasm.wasmemulator_gpio_set_input(this.__wbg_ptr, pin, high);
    }
    /**
     * GPIO pad state as `[out_lo, out_hi, enable_lo, enable_hi]`: the
     * output and output-enable registers for GPIO 0-31 and 32-63.
     * @returns {Uint32Array}
     */
    gpio_state() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_gpio_state(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * PC of the given hart; 0 for a hart that does not exist.
     * @param {number} hart
     * @returns {number}
     */
    hart_pc(hart) {
        const ret = wasm.wasmemulator_hart_pc(this.__wbg_ptr, hart);
        return ret >>> 0;
    }
    /**
     * True if this build ships an embedded default ROM for the current chip.
     * @returns {boolean}
     */
    has_default_rom() {
        const ret = wasm.wasmemulator_has_default_rom(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * True when the core is Xtensa (ESP32-S3): `registers()` then returns
     * the windowed a0-a15 plus special registers instead of x0-x31.
     * @returns {boolean}
     */
    is_xtensa() {
        const ret = wasm.wasmemulator_is_xtensa(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Load the application ELF: symbols for BLE interception and backtraces.
     * It also arms the panic intercepts, unless `set_panic_intercept(false)`.
     * @param {Uint8Array} data
     */
    load_app_elf(data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmemulator_load_app_elf(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Load the default (embedded) ROM ELF for the current chip. Returns an
     * error if the build has no embedded ROM for this chip.
     */
    load_default_rom() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_load_default_rom(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Load eFuse data from a binary file
     * @param {Uint8Array} data
     */
    load_efuse(data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmemulator_load_efuse(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Load firmware from a Uint8Array
     * @param {Uint8Array} data
     */
    load_firmware(data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmemulator_load_firmware(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Load ROM ELF into the emulator memory
     * @param {Uint8Array} data
     */
    load_rom_elf(data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmemulator_load_rom_elf(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Check if the emulator needs a restart (firmware called esp_restart).
     * @returns {boolean}
     */
    needs_restart() {
        const ret = wasm.wasmemulator_needs_restart(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Route the firmware's frames to the browser NAT (`net_*`) instead of `wifi_tx_drain`.
     * @param {boolean} on
     */
    net_enable(on) {
        wasm.wasmemulator_net_enable(this.__wbg_ptr, on);
    }
    /**
     * Network events since the last call: `[u32 len LE][u8 type][body]...`, len covers type + body.
     * With a relay set, only the events that the relay client does not handle.
     * @returns {Uint8Array}
     */
    net_event_drain() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_net_event_drain(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Receive the 16-byte IPv6 multicast `group` (`ff02::fb` for mDNS) on the `net_udp6_*` sockets.
     * @param {Uint8Array} group
     */
    net_join_multicast(group) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(group, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmemulator_net_join_multicast(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The NAT's 16-byte link-local IPv6 address, which `net_udp6_*` sockets send from.
     * @returns {Uint8Array}
     */
    net_local_ipv6() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_net_local_ipv6(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The relay's state: `{ connected, unreachable, flows, refused: [{ host, port, udp, status, reason }],
     * forwards: [{ host_port, guest_port }] }`, or `null` with no relay set.
     * @returns {any}
     */
    net_relay_state() {
        const ret = wasm.wasmemulator_net_relay_state(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Relay the firmware's networking through the `esp-emu-relay` at `url`, and take its port forwards.
     * Turns the NAT on and ends the open flows; an empty `url` gives the NAT back to `net_*` calls.
     * @param {string} url
     */
    net_set_relay(url) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(url, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmemulator_net_set_relay(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The remote host closed the flow: FIN, or reset when `abort`.
     * @param {number} id
     * @param {boolean} abort
     */
    net_tcp_close(id, abort) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_net_tcp_close(retptr, this.__wbg_ptr, id, abort);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Open a TCP connection from the NAT to the firmware's `guest_port`, for a connection that
     * arrives from the network. Returns the flow ID; the flow then works as one that the firmware opened.
     * @param {number} guest_port
     * @returns {number}
     */
    net_tcp_connect(guest_port) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_net_tcp_connect(retptr, this.__wbg_ptr, guest_port);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The relay connected the flow (`ok`), or failed; a failure resets the guest's connection.
     * @param {number} id
     * @param {boolean} ok
     */
    net_tcp_opened(id, ok) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_net_tcp_opened(retptr, this.__wbg_ptr, id, ok);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Bytes from the remote host for the guest.
     * @param {number} id
     * @param {Uint8Array} data
     */
    net_tcp_send(id, data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmemulator_net_tcp_send(retptr, this.__wbg_ptr, id, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Close socket `id`.
     * @param {number} id
     */
    net_udp6_close(id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_net_udp6_close(retptr, this.__wbg_ptr, id);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Open a UDP socket on the NAT's IPv6 address; `port` 0 picks a free one. Returns its ID.
     * @param {number} port
     * @returns {number}
     */
    net_udp6_open(port) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_net_udp6_open(retptr, this.__wbg_ptr, port);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * One datagram from socket `id` to the 16-byte `dst_ip` and `dst_port`.
     * @param {number} id
     * @param {Uint8Array} dst_ip
     * @param {number} dst_port
     * @param {Uint8Array} data
     */
    net_udp6_send(id, dst_ip, dst_port, data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(dst_ip, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(data, wasm.__wbindgen_export3);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmemulator_net_udp6_send(retptr, this.__wbg_ptr, id, ptr0, len0, dst_port, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * One reply datagram from `src_ip:src_port` (4-byte IPv4) to the guest's `guest_port`.
     * @param {number} guest_port
     * @param {Uint8Array} src_ip
     * @param {number} src_port
     * @param {Uint8Array} data
     */
    net_udp_send(guest_port, src_ip, src_port, data) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(src_ip, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(data, wasm.__wbindgen_export3);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmemulator_net_udp_send(retptr, this.__wbg_ptr, guest_port, ptr0, len0, src_port, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} chip
     */
    constructor(chip) {
        const ptr0 = passStringToWasm0(chip, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmemulator_new(ptr0, len0);
        this.__wbg_ptr = ret >>> 0;
        WasmEmulatorFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Harts currently running (1, or 2 once dual-core firmware releases
     * the second core).
     * @returns {number}
     */
    num_harts() {
        const ret = wasm.wasmemulator_num_harts(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the current PC
     * @returns {number}
     */
    pc() {
        const ret = wasm.wasmemulator_pc(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Read `len` bytes at `addr` through the bus. Unmapped bytes read as 0.
     * Capped at 4 KiB per call.
     * @param {number} addr
     * @param {number} len
     * @returns {Uint8Array}
     */
    read_memory(addr, len) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_read_memory(retptr, this.__wbg_ptr, addr, len);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Hart 0's register file in one call. RISC-V: x0..x31. Xtensa: the
     * visible window a0..a15, then PS, SAR, WINDOWBASE, WINDOWSTART,
     * EXCCAUSE, EXCVADDR, EPC1, LBEG, LEND, LCOUNT.
     * @returns {Uint32Array}
     */
    registers() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_registers(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Perform a software restart, preserving flash contents.
     */
    restart() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_restart(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Run a batch of instructions. Returns UART output as a string.
     * @param {number} count
     * @returns {string}
     */
    run_batch(count) {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_run_batch(retptr, this.__wbg_ptr, count);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Run for at most `cycles` of emulated time, as `cycles()` counts it.
     * Unlike `run_batch`, a wait (WFI/WAITI) is skipped only as far as the
     * bound and the harts are left waiting there, so a host that owns the
     * clock can stop at its own deadlines. Returns UART output as a string.
     * @param {number} cycles
     * @returns {string}
     */
    run_until(cycles) {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_run_until(retptr, this.__wbg_ptr, cycles);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export2(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Set the 6-byte base MAC (first octet first) in eFuse; any time before the first `run_batch`.
     * @param {Uint8Array} mac
     */
    set_base_mac(mac) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(mac, wasm.__wbindgen_export3);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmemulator_set_base_mac(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {boolean} on
     */
    set_boot_from_rom(on) {
        wasm.wasmemulator_set_boot_from_rom(this.__wbg_ptr, on);
    }
    /**
     * Drive the chip's EN (CHIP_PU) pin from the page: `false` holds the
     * chip in reset while emulated time and the board's parts go on, `true`
     * lets go. Once no part holds EN low either, the next run reports
     * `needs_restart`, and the `restart` that follows is a power-on reset.
     * @param {boolean} high
     */
    set_en(high) {
        wasm.wasmemulator_set_en(this.__wbg_ptr, high);
    }
    /**
     * `false` lets the firmware's own panic handler run and print instead of
     * stopping the machine at its entry (the CLI's `--no-panic-intercept`).
     * Call it before `load_app_elf`, which is what arms the intercepts.
     * @param {boolean} on
     */
    set_panic_intercept(on) {
        wasm.wasmemulator_set_panic_intercept(this.__wbg_ptr, on);
    }
    /**
     * Like `set_wifi_config`, pinning the auth mode ("wpa2-wpa3",
     * "wpa3-sae", "wpa2-psk", "open") and SAE PWE ("both", "h2e",
     * "hunt-and-peck") — the `--wifi-auth` / `--wifi-sae-pwe` flags.
     * @param {string} ssid
     * @param {string} password
     * @param {string} auth
     * @param {string} sae_pwe
     */
    set_wifi_auth(ssid, password, auth, sae_pwe) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(ssid, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(password, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(auth, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(sae_pwe, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len3 = WASM_VECTOR_LEN;
            wasm.wasmemulator_set_wifi_auth(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Configure WiFi soft AP SSID and optional WPA2-PSK password.
     * Pass empty string for password to use open mode.
     * @param {string} ssid
     * @param {string} password
     */
    set_wifi_config(ssid, password) {
        const ptr0 = passStringToWasm0(ssid, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(password, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
        const len1 = WASM_VECTOR_LEN;
        wasm.wasmemulator_set_wifi_config(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
    /**
     * Milliseconds to wait before the next batch; 0 when emulation is not
     * ahead of the host clock. `now_ms` is `performance.now()`.
     * @param {number} now_ms
     * @returns {number}
     */
    throttle_delay_ms(now_ms) {
        const ret = wasm.wasmemulator_throttle_delay_ms(this.__wbg_ptr, now_ms);
        return ret;
    }
    /**
     * Send UART input
     * @param {Uint8Array} data
     */
    uart_input(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmemulator_uart_input(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Push an Ethernet frame into the WiFi RX path (converted to 802.11 by soft AP)
     * @param {Uint8Array} data
     */
    wifi_rx_push(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export3);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmemulator_wifi_rx_push(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Drain Ethernet frames from WiFi TX queue, concatenated with length prefixes; empty while the NAT is on.
     * @returns {Uint8Array}
     */
    wifi_tx_drain() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmemulator_wifi_tx_drain(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) WasmEmulator.prototype[Symbol.dispose] = WasmEmulator.prototype.free;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_function_49868bde5eb1e745: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_undefined_c0cca72b82b86f4d: function(arg0) {
            const ret = getObject(arg0) === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_81fc77679af83bc6: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_3c3b4f651835fbcb: function(arg0) {
            getObject(arg0)._wbg_cb_unref();
        },
        __wbg_arrayBuffer_dae084a298aa5fe0: function() { return handleError(function (arg0) {
            const ret = getObject(arg0).arrayBuffer();
            return addHeapObject(ret);
        }, arguments); },
        __wbg_bufferedAmount_22f5c8c3d56b8df6: function(arg0) {
            const ret = getObject(arg0).bufferedAmount;
            return ret;
        },
        __wbg_call_d578befcc3145dee: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_close_f181fdc02ee236e6: function() { return handleError(function (arg0) {
            getObject(arg0).close();
        }, arguments); },
        __wbg_code_c96efa5c1a80b2d9: function(arg0) {
            const ret = getObject(arg0).code;
            return ret;
        },
        __wbg_data_60b50110c5bd9349: function(arg0) {
            const ret = getObject(arg0).data;
            return addHeapObject(ret);
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_export2(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_get_f96702c6245e4ef9: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(getObject(arg0), getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_instanceof_ArrayBuffer_ff7c1337a5e3b33a: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Promise_95d523058012a13d: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Promise;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Response_06795eab66cc4036: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Response;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_length_0c32cb8543c8e4c8: function(arg0) {
            const ret = getObject(arg0).length;
            return ret;
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return addHeapObject(ret);
        },
        __wbg_new_4f9fafbb3909af72: function() {
            const ret = new Object();
            return addHeapObject(ret);
        },
        __wbg_new_a2d8434834334bbf: function() { return handleError(function (arg0, arg1) {
            const ret = new WebSocket(getStringFromWasm0(arg0, arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_new_a560378ea1240b14: function(arg0) {
            const ret = new Uint8Array(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_new_f3c9df4f38f3f798: function() {
            const ret = new Array();
            return addHeapObject(ret);
        },
        __wbg_now_88621c9c9a4f3ffc: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_prototypesetcall_3e05eb9545565046: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), getObject(arg2));
        },
        __wbg_push_6bdbc990be5ac37b: function(arg0, arg1) {
            const ret = getObject(arg0).push(getObject(arg1));
            return ret;
        },
        __wbg_queueMicrotask_abaf92f0bd4e80a4: function(arg0) {
            const ret = getObject(arg0).queueMicrotask;
            return addHeapObject(ret);
        },
        __wbg_queueMicrotask_df5a6dac26d818f3: function(arg0) {
            queueMicrotask(getObject(arg0));
        },
        __wbg_resolve_0a79de24e9d2267b: function(arg0) {
            const ret = Promise.resolve(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_send_4f53c94146f0274d: function() { return handleError(function (arg0, arg1, arg2) {
            getObject(arg0).send(getStringFromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_send_64dd480ad0d86a31: function() { return handleError(function (arg0, arg1, arg2) {
            getObject(arg0).send(getArrayU8FromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_set_8ee2d34facb8466e: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
            return ret;
        }, arguments); },
        __wbg_set_binaryType_95c0a0f7586a3903: function(arg0, arg1) {
            getObject(arg0).binaryType = __wbindgen_enum_BinaryType[arg1];
        },
        __wbg_set_onclose_47cce56c686db4fb: function(arg0, arg1) {
            getObject(arg0).onclose = getObject(arg1);
        },
        __wbg_set_onmessage_45bd33b110c54f5b: function(arg0, arg1) {
            getObject(arg0).onmessage = getObject(arg1);
        },
        __wbg_set_onopen_7ffeb01f8a628209: function(arg0, arg1) {
            getObject(arg0).onopen = getObject(arg1);
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = getObject(arg1).stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export3, wasm.__wbindgen_export4);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_GLOBAL_f2e0f995a21329ff: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_SELF_24f78b6d23f286ea: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_WINDOW_59fd959c540fe405: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_status_44ecb0ac1da253f4: function(arg0) {
            const ret = getObject(arg0).status;
            return ret;
        },
        __wbg_then_00eed3ac0b8e82cb: function(arg0, arg1, arg2) {
            const ret = getObject(arg0).then(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        },
        __wbg_then_a0c8db0381c8994c: function(arg0, arg1) {
            const ret = getObject(arg0).then(getObject(arg1));
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 411, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, __wasm_bindgen_func_elem_2377);
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("CloseEvent")], shim_idx: 7, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, __wasm_bindgen_func_elem_110);
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("MessageEvent")], shim_idx: 7, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, __wasm_bindgen_func_elem_110_2);
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 5, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, __wasm_bindgen_func_elem_108);
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000005: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000006: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_object_clone_ref: function(arg0) {
            const ret = getObject(arg0);
            return addHeapObject(ret);
        },
        __wbindgen_object_drop_ref: function(arg0) {
            takeObject(arg0);
        },
    };
    return {
        __proto__: null,
        "./esp_emu_bg.js": import0,
    };
}

function __wasm_bindgen_func_elem_108(arg0, arg1) {
    wasm.__wasm_bindgen_func_elem_108(arg0, arg1);
}

function __wasm_bindgen_func_elem_110(arg0, arg1, arg2) {
    wasm.__wasm_bindgen_func_elem_110(arg0, arg1, addHeapObject(arg2));
}

function __wasm_bindgen_func_elem_110_2(arg0, arg1, arg2) {
    wasm.__wasm_bindgen_func_elem_110_2(arg0, arg1, addHeapObject(arg2));
}

function __wasm_bindgen_func_elem_2377(arg0, arg1, arg2) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.__wasm_bindgen_func_elem_2377(retptr, arg0, arg1, addHeapObject(arg2));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}


const __wbindgen_enum_BinaryType = ["blob", "arraybuffer"];
const WasmEmulatorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmemulator_free(ptr >>> 0, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_export5(state.a, state.b));

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_export(addHeapObject(e));
    }
}

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_export5(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('esp_emu_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
