import { invoke } from '@tauri-apps/api/core';
import type { Profile } from '../boards/types';

export interface DetectionResult {
  chip: string | null;
  hints: string[];
  profileId: string | null;
  info: unknown | null;
}

interface FirmwareInfo {
  chip: string;
  hints: string[];
}

/** Select the most specific complete fingerprint; ties retain profile order. */
export function matchProfile(
  chip: string | null,
  hints: readonly string[],
  profiles: readonly Profile[],
): Profile | null {
  const available = new Set(hints);
  let best: Profile | null = null;
  let specificity = 0;
  for (const profile of profiles) {
    const required = profile.match_hints ?? [];
    // Empty fingerprints are generic fallbacks, not evidence of a board match.
    if (required.length > specificity && required.every((hint) => available.has(hint))) {
      best = profile;
      specificity = required.length;
    }
  }
  return best ?? (chip === null ? null : profiles.find((profile) => profile.id === `generic-${chip}`) ?? null);
}

const headerChips: Readonly<Record<number, string>> = {
  0: 'esp32',
  2: 'esp32s2',
  5: 'esp32c3',
  9: 'esp32s3',
  12: 'esp32c2',
  13: 'esp32c6',
  16: 'esp32h2',
  18: 'esp32p4',
};

/** Inspect through Rust in Tauri; browser previews can identify only the header chip. */
export async function detectBoard(bytes: Uint8Array, profiles: Profile[]): Promise<DetectionResult> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    // Passing the typed array itself keeps large firmware images out of JSON.
    const info = await invoke<FirmwareInfo>('inspect_firmware', bytes);
    return {
      chip: info.chip,
      hints: info.hints,
      profileId: matchProfile(info.chip, info.hints, profiles)?.id ?? null,
      info,
    };
  }

  const chip = bytes.length >= 14 && bytes[0] === 0xe9
    ? headerChips[new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(12, true)] ?? null
    : null;
  return { chip, hints: [], profileId: matchProfile(chip, [], profiles)?.id ?? null, info: null };
}
