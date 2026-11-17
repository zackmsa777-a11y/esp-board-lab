import type { CSSProperties } from 'react';
import type { Profile } from './boards/types';
import type { PartSnapshot } from './emu/parts/host';

// LED bytes describe linear light intensity. CSS/Three hex colors use sRGB;
// encode them so low firmware brightness stays visible as emitted light.
export function ledDisplayColor(color: string): string {
  return `#${[1, 3, 5].map(offset => {
    const linear = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    const srgb = linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055;
    return Math.round(srgb * 255).toString(16).padStart(2, '0');
  }).join('')}`;
}

export function ledColors(profile: Profile | undefined, parts: PartSnapshot[]): string[] {
  if (!profile?.leds) return [];
  const colors = parts.find(part => part.name === profile.leds!.part)?.values.colors?.split(',') ?? [];
  return Array.from({ length: Math.min(128, profile.leds.count) }, (_, i) => /^#[0-9a-f]{6}$/i.test(colors[i]?.trim() ?? '') ? colors[i].trim() : '#000000');
}
export function LedRing({ colors, children }: { colors: string[]; children: React.ReactNode }) {
  return <div className="led-ring-2d">
    <div className="led-dots" role="img" aria-label={`WS2812 ring: ${colors.map((color, i) => `LED ${i + 1} ${color}`).join(', ')}`}>
      {colors.map((color, i) => {
        const angle = i / colors.length * Math.PI * 2 - Math.PI / 2;
        return <span key={i} className={`led-dot${color === '#000000' ? ' led-off' : ''}`} style={{ '--led-color': ledDisplayColor(color), '--led-x': `${50 + Math.cos(angle) * 42}%`, '--led-y': `${50 + Math.sin(angle) * 42}%` } as CSSProperties} />;
      })}
    </div>
    {children}
  </div>;
}
