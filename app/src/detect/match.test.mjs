// Run from app/: node --import tsx --test src/detect/match.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { detectBoard, matchProfile } from './index.ts';

const genericS3 = { id: 'generic-esp32s3', chip: 'esp32s3' };
const genericC3 = { id: 'generic-esp32c3', chip: 'esp32c3', match_hints: [] };
const tembed = { id: 'tembed', chip: 'esp32s3', match_hints: ['LilyGO T-Embed'] };
const plus = { id: 'tembed-cc1101-plus', chip: 'esp32s3', match_hints: ['LilyGO T-Embed', 'CC1101'] };
const profiles = [genericC3, genericS3, tembed, plus];

test('complete fingerprints beat generic and less specific profiles', () => {
  assert.equal(matchProfile('esp32s3', ['CC1101', 'LilyGO T-Embed', 'LVGL'], profiles), plus);
  assert.equal(matchProfile('esp32s3', ['LilyGO T-Embed'], profiles), tembed);
});

test('partial fingerprints fall back only to the detected chip', () => {
  assert.equal(matchProfile('esp32s3', ['CC1101'], profiles), genericS3);
  assert.equal(matchProfile('esp32c3', [], profiles), genericC3);
  assert.equal(matchProfile('esp32s3', [], profiles), genericS3);
  assert.equal(matchProfile(null, [], profiles), null);
  assert.equal(matchProfile('esp32', [], profiles), null);
  assert.equal(matchProfile('esp32s3', ['cc1101'], [plus]), null);
});

test('matching leaves profile order unchanged and resolves ties in input order', () => {
  const tie = { ...tembed, id: 'another-tembed' };
  const ordered = Object.freeze([tembed, tie, plus]);
  assert.equal(matchProfile('esp32s3', ['LilyGO T-Embed'], ordered), tembed);
  assert.deepEqual(ordered.map((profile) => profile.id), ['tembed', 'another-tembed', plus.id]);
});

test('browser fallback maps every supported little-endian chip ID', async () => {
  for (const [id, chip] of [[0, 'esp32'], [2, 'esp32s2'], [5, 'esp32c3'], [9, 'esp32s3'],
    [12, 'esp32c2'], [13, 'esp32c6'], [16, 'esp32h2'], [18, 'esp32p4']]) {
    const bytes = new Uint8Array(24);
    bytes[0] = 0xe9;
    bytes[12] = id;
    const result = await detectBoard(bytes, profiles);
    assert.equal(result.chip, chip);
    assert.deepEqual(result.hints, []);
    assert.equal(result.info, null);
    assert.equal(result.profileId, profiles.find((profile) => profile.id === `generic-${chip}`)?.id ?? null);
  }
});

test('browser fallback respects subarray offsets and rejects invalid or unknown headers', async () => {
  const backing = new Uint8Array(40);
  const bytes = backing.subarray(8, 32);
  bytes[0] = 0xe9;
  bytes[12] = 9;
  assert.equal((await detectBoard(bytes, profiles)).profileId, genericS3.id);
  for (const invalid of [new Uint8Array(), bytes.subarray(0, 13), new Uint8Array(24)]) {
    assert.deepEqual(await detectBoard(invalid, profiles), { chip: null, hints: [], profileId: null, info: null });
  }
  bytes[13] = 1; // 0x0109 must not be mistaken for chip ID 9.
  assert.equal((await detectBoard(bytes, profiles)).chip, null);
});

test('Tauri passes the original Uint8Array as the raw body and retains inspection info', async () => {
  const previousWindow = globalThis.window;
  const bytes = new Uint8Array([0xe9]);
  const info = { chip: 'esp32s3', hints: ['LilyGO T-Embed', 'CC1101'], flash_size: 16777216 };
  globalThis.window = { __TAURI_INTERNALS__: {
    invoke: async (command, body) => {
      assert.equal(command, 'inspect_firmware');
      assert.equal(body, bytes);
      return info;
    },
  } };
  try {
    assert.deepEqual(await detectBoard(bytes, profiles), {
      chip: 'esp32s3', hints: info.hints, profileId: plus.id, info,
    });
    const failure = new Error('invalid firmware');
    globalThis.window.__TAURI_INTERNALS__.invoke = async () => { throw failure; };
    await assert.rejects(detectBoard(bytes, profiles), (error) => error === failure);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
