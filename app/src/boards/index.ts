import type { BoardDefinition, Profile } from './types';

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
export async function loadProfiles(): Promise<Profile[]> {
  const index = await json<(string | { id: string })[] | { boards: (string | { id: string })[] }>('/boards/index.json');
  const entries = Array.isArray(index) ? index : index.boards;
  return Promise.all(entries.map(entry => json<Profile>(`/boards/${encodeURIComponent(typeof entry === 'string' ? entry : entry.id)}/profile.json`)));
}
export function loadBoard(profile: Profile): Promise<BoardDefinition> {
  return json(`/boards/${encodeURIComponent(profile.id)}/${profile.board}`);
}
