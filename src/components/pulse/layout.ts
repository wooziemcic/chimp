/**
 * Geometry for Pulse's editorial canvas, measured from the approved mockup
 * on a 390pt-wide iPhone 12 and scaled at runtime. Three circles (scenes /
 * people) and three cards (boards / Moves) per page.
 */
export const CANVAS_HEIGHT = 492;

export interface CircleSlot {
  circle: { x: number; y: number; d: number };
  glow: { x: number; y: number; d: number; colors: [string, string] };
  cluster: { x: number; y: number };
  label: { x: number; y: number; align: 'left' | 'right' };
}

export interface CardSlot {
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  size: 'lg' | 'md';
  action: 'bookmark' | 'heart';
  arrow: boolean;
}

export const CIRCLE_SLOTS: CircleSlot[] = [
  {
    circle: { x: 60, y: 2, d: 94 },
    glow: { x: 8, y: 6, d: 132, colors: ['#DCE8FF', '#F5F8FF'] },
    cluster: { x: 10, y: 44 },
    label: { x: 14, y: 90, align: 'left' },
  },
  {
    circle: { x: 214, y: 220, d: 98 },
    glow: { x: 250, y: 190, d: 150, colors: ['#F7E3FF', '#FBF3FF'] },
    cluster: { x: 318, y: 222 },
    label: { x: 314, y: 270, align: 'left' },
  },
  {
    circle: { x: 74, y: 322, d: 104 },
    glow: { x: 40, y: 300, d: 140, colors: ['#DCE8FF', '#F5F8FF'] },
    cluster: { x: 16, y: 348 },
    label: { x: 18, y: 402, align: 'left' },
  },
];

export const CARD_SLOTS: CardSlot[] = [
  { x: 158, y: 8, w: 196, h: 212, rotate: 1.2, size: 'lg', action: 'bookmark', arrow: true },
  { x: 12, y: 138, w: 152, h: 188, rotate: -4, size: 'md', action: 'heart', arrow: false },
  { x: 184, y: 318, w: 190, h: 162, rotate: 2.5, size: 'md', action: 'heart', arrow: true },
];
