// Picks the esp-emu-relay release archive for the visitor's OS and CPU.
(function (root) {
    'use strict';

    const REPO = 'https://github.com/espressif/esp-emulator';
    const RAW = 'https://raw.githubusercontent.com/espressif/esp-emulator/main';
    // The relay release the page links, the version in esp-emu-relay/Cargo.toml.
    // Any relay of the same MAJOR works with this page.
    const RELAY_VERSION = '1.0.0';

    // Same order and names as scripts/build-relay.sh
    const TARGETS = [
        { target: 'aarch64-apple-darwin', label: 'macOS (Apple silicon)', ext: 'tar.gz' },
        { target: 'x86_64-apple-darwin', label: 'macOS (Intel)', ext: 'tar.gz' },
        { target: 'x86_64-pc-windows-gnu', label: 'Windows (x86_64)', ext: 'zip' },
        { target: 'x86_64-unknown-linux-gnu', label: 'Linux (x86_64)', ext: 'tar.gz' },
        { target: 'aarch64-unknown-linux-gnu', label: 'Linux (arm64)', ext: 'tar.gz' },
    ];

    // `hints` is the result of navigator.userAgentData.getHighEntropyValues, or {}
    function pickTarget(hints, userAgent, maxTouchPoints) {
        const ua = userAgent || '';
        const platform = (hints && hints.platform) || '';
        const arch = (hints && hints.architecture) || '';
        if (/Android|iPhone|iPad|CrOS/.test(ua) || /Android|iOS|Chrome OS/.test(platform)) return null;
        if (platform === 'Windows' || /Windows/.test(ua)) return 'x86_64-pc-windows-gnu';
        if (platform === 'macOS' || /Macintosh/.test(ua)) {
            // An iPad asks for the desktop page with a Mac user agent
            if (maxTouchPoints > 1) return null;
            // Only a hint selects Intel
            return arch === 'x86' ? 'x86_64-apple-darwin' : 'aarch64-apple-darwin';
        }
        if (platform === 'Linux' || /Linux/.test(ua)) {
            const arm = arch === 'arm' || /aarch64|arm64|armv8/.test(ua);
            return arm ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
        }
        return null;
    }

    // With no target, the link goes to the relay release page
    function downloadUrl(target) {
        const t = TARGETS.find((x) => x.target === target);
        if (!t) return `${REPO}/releases/tag/relay-v${RELAY_VERSION}`;
        return `${REPO}/releases/download/relay-v${RELAY_VERSION}/esp-emu-relay-${RELAY_VERSION}-${t.target}.${t.ext}`;
    }

    // The terminal command that installs the relay: scripts/install.sh --relay, or
    // scripts/install-relay.ps1 on Windows
    function installCommand(target) {
        if (!TARGETS.some((x) => x.target === target)) return null;
        if (target.includes('-windows-')) {
            return `& ([scriptblock]::Create((irm ${RAW}/install-relay.ps1))) -Version ${RELAY_VERSION}`;
        }
        return `curl -fsSL ${RAW}/install.sh | sh -s -- --relay --version ${RELAY_VERSION}`;
    }

    const major = (version) => (/^(\d+)\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.exec(String(version)) || [])[1];
    function compatible(version) {
        return major(version) !== undefined && major(version) === major(RELAY_VERSION);
    }

    const api = { RELAY_VERSION, TARGETS, pickTarget, downloadUrl, installCommand, compatible };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.RelayDownload = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
