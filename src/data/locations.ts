import type { Location } from '@/types/models';

/** Location nodes. Cities hang off countries (LOCATED_IN). */
export const LOCATIONS: Location[] = [
  { id: 'japan', label: 'Japan', kind: 'country', interestId: 'i_japan' },
  { id: 'tokyo', label: 'Tokyo', kind: 'city', parentId: 'japan', interestId: 'i_japan' },
  { id: 'kyoto', label: 'Kyoto', kind: 'city', parentId: 'japan', interestId: 'i_japan' },
  { id: 'osaka', label: 'Osaka', kind: 'city', parentId: 'japan', interestId: 'i_japan' },
  { id: 'usa', label: 'United States', kind: 'country' },
  { id: 'boston', label: 'Boston', kind: 'city', parentId: 'usa' },
  { id: 'nyc', label: 'New York', kind: 'city', parentId: 'usa' },
  { id: 'italy', label: 'Italy', kind: 'country', interestId: 'i_italy' },
  { id: 'amalfi', label: 'Amalfi Coast', kind: 'region', parentId: 'italy', interestId: 'i_italy' },
  { id: 'portugal', label: 'Portugal', kind: 'country' },
  { id: 'lisbon', label: 'Lisbon', kind: 'city', parentId: 'portugal' },
  { id: 'korea', label: 'South Korea', kind: 'country' },
  { id: 'seoul', label: 'Seoul', kind: 'city', parentId: 'korea' },
  { id: 'nepal', label: 'Nepal', kind: 'country' },
  { id: 'kathmandu', label: 'Kathmandu', kind: 'city', parentId: 'nepal' },
];

export const LOCATION_BY_ID: Record<string, Location> = Object.fromEntries(LOCATIONS.map((l) => [l.id, l]));

/** Maps free-text city labels ("Tokyo, JP", "Boston, MA") to location ids. */
export function locationForCity(city: string | undefined): string | undefined {
  if (!city) return undefined;
  const c = city.toLowerCase();
  if (c.includes('tokyo') || c.includes('shinjuku') || c.includes('shibuya')) return 'tokyo';
  if (c.includes('kyoto')) return 'kyoto';
  if (c.includes('osaka')) return 'osaka';
  if (c.includes('boston') || c.includes('cambridge') || c.includes('somerville')) return 'boston';
  if (c.includes('new york') || c.includes('nyc')) return 'nyc';
  if (c.includes('lisbon')) return 'lisbon';
  if (c.includes('seoul')) return 'seoul';
  if (c.includes('amalfi')) return 'amalfi';
  if (c.includes('italy')) return 'italy';
  if (c.includes('japan')) return 'japan';
  return undefined;
}

/** Location and all its ancestors (Tokyo → Japan). */
export function locationLineage(id: string | undefined): string[] {
  const out: string[] = [];
  let cur = id ? LOCATION_BY_ID[id] : undefined;
  while (cur && !out.includes(cur.id)) {
    out.push(cur.id);
    cur = cur.parentId ? LOCATION_BY_ID[cur.parentId] : undefined;
  }
  return out;
}
