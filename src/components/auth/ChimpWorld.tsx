import { memo } from 'react';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { auth } from './palette';

/**
 * Chimp's brand illustration (Phase 6A): flat 2D vector, no photos, no 3D.
 * A chimp looking up and out at a huge world of possibilities — stars,
 * planets, a plane, a city, a mountain, a path to the water.
 *
 *   welcome   the chimp's head bottom-left, the world opening above it
 *   phone     the chimp sitting on a cliff with a backpack, facing the city
 *   quiet     just sky, stars and a planet (verify / onboarding headers)
 *
 * Drawn on a 390 × 560 canvas and scaled to fit (`slice`, like a cover image).
 */
type Variant = 'welcome' | 'phone' | 'quiet';

export const ChimpWorld = memo(function ChimpWorld({ variant, width, height }: { variant: Variant; width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 390 560" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#15163A" />
          <Stop offset="0.45" stopColor="#3B2C78" />
          <Stop offset="0.72" stopColor="#B8467E" />
          <Stop offset="1" stopColor="#FF8C6B" />
        </LinearGradient>
        <LinearGradient id="night" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={auth.bg} />
          <Stop offset="0.55" stopColor="#1B1840" />
          <Stop offset="1" stopColor="#2A1F55" />
        </LinearGradient>
        <LinearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FF9C7E" />
          <Stop offset="1" stopColor="#6B4FB0" />
        </LinearGradient>
        <LinearGradient id="moon" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FF9A7E" />
          <Stop offset="1" stopColor="#F0507E" />
        </LinearGradient>
        <ClipPath id="portal">
          <Path d="M 60 390 C 110 310, 228 236, 262 164 C 282 120, 292 60, 300 0 L 390 0 L 390 520 C 300 500, 170 460, 60 390 Z" />
        </ClipPath>
      </Defs>

      <Rect x="0" y="0" width="390" height="560" fill={auth.bg} />

      {variant === 'welcome' ? <Welcome /> : variant === 'phone' ? <Phone /> : <Quiet />}
    </Svg>
  );
});

// ─── Shared pieces ──────────────────────────────────────────────────────────

const STARS: [number, number, number][] = [
  [40, 60, 1.6], [92, 140, 1.2], [150, 40, 1.4], [210, 96, 1.1], [262, 30, 1.8], [318, 74, 1.2], [360, 130, 1.5], [120, 210, 1.1],
  [250, 170, 1.3], [300, 210, 1], [180, 180, 1.2], [340, 20, 1], [70, 250, 1.1], [20, 170, 1.3],
];

function Stars({ opacity = 1 }: { opacity?: number }) {
  return (
    <G opacity={opacity}>
      {STARS.map(([x, y, r], i) => (
        <Circle key={i} cx={x} cy={y} r={r} fill={i % 4 === 0 ? auth.peach : auth.cream} />
      ))}
    </G>
  );
}

function Sparkle({ x, y, s = 1, color = auth.cream }: { x: number; y: number; s?: number; color?: string }) {
  return <Path d={`M ${x} ${y - 9 * s} L ${x + 2.2 * s} ${y - 2.2 * s} L ${x + 9 * s} ${y} L ${x + 2.2 * s} ${y + 2.2 * s} L ${x} ${y + 9 * s} L ${x - 2.2 * s} ${y + 2.2 * s} L ${x - 9 * s} ${y} L ${x - 2.2 * s} ${y - 2.2 * s} Z`} fill={color} />;
}

function Plane({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <G transform={`translate(${x} ${y}) rotate(-18) scale(${s})`}>
      {/* trail */}
      <Path d="M -150 16 L -4 2 L -4 8 Z" fill={auth.coral} opacity={0.85} />
      <Path d="M -120 22 L -6 8 L -6 11 Z" fill={auth.peach} opacity={0.6} />
      {/* body */}
      <Path d="M -6 2 C 10 -4, 40 -5, 52 0 C 56 2, 54 6, 48 7 L -4 9 C -8 9, -9 4, -6 2 Z" fill={auth.cream} />
      <Path d="M 18 3 L 6 -14 L 13 -14 L 30 2 Z" fill={auth.cream} />
      <Path d="M 18 7 L 8 22 L 15 22 L 30 7 Z" fill="#E8DCD4" />
      <Path d="M -4 3 L -10 -8 L -4 -8 L 4 2 Z" fill={auth.cream} />
    </G>
  );
}

function Planet({ x, y, r, color = auth.purple2, ring = auth.coral }: { x: number; y: number; r: number; color?: string; ring?: string }) {
  return (
    <G>
      <Circle cx={x} cy={y} r={r} fill={color} />
      <Ellipse cx={x} cy={y + 2} rx={r * 1.9} ry={r * 0.42} fill="none" stroke={ring} strokeWidth={3} transform={`rotate(-16 ${x} ${y})`} />
      <Path d={`M ${x - r} ${y} A ${r} ${r} 0 0 0 ${x + r} ${y}`} fill={color} />
    </G>
  );
}

function Cloud({ x, y, s = 1, color = auth.salmon }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Circle cx={0} cy={0} r={22} fill={color} />
      <Circle cx={24} cy={-10} r={28} fill={color} />
      <Circle cx={54} cy={-2} r={22} fill={color} />
      <Rect x={-22} y={0} width={98} height={22} rx={11} fill={color} />
    </G>
  );
}

function City({ x, y, s = 1, color = auth.purple }: { x: number; y: number; s?: number; color?: string }) {
  // x,y = baseline left.
  const towers: [number, number, number][] = [
    [0, 44, 16], [18, 70, 14], [34, 52, 18], [54, 118, 12], [68, 86, 16], [86, 60, 14], [102, 96, 18], [122, 48, 16], [140, 74, 14], [156, 40, 18],
  ];
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      {towers.map(([tx, h, w], i) => (
        <Rect key={i} x={tx} y={-h} width={w} height={h} fill={color} />
      ))}
      {/* spire on the tallest */}
      <Path d="M 57 -118 L 60 -140 L 63 -118 Z" fill={color} />
      <Rect x={-10} y={0} width={190} height={6} fill={color} />
    </G>
  );
}

function Mountain({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Path d="M 0 0 L 70 -92 L 150 0 Z" fill={auth.purple2} />
      <Path d="M 70 -92 L 52 -68 L 62 -62 L 72 -72 L 82 -60 L 90 -68 Z" fill={auth.cream} />
      <Path d="M 70 -92 L 150 0 L 110 0 L 76 -70 Z" fill="#5A479E" />
    </G>
  );
}

function Palm({ x, y, s = 1, color = '#15122E' }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Path d="M -2 0 C 2 -30, 4 -50, 10 -70 L 14 -70 C 9 -48, 7 -30, 4 0 Z" fill={color} />
      <Path d="M 12 -70 C 30 -80, 44 -74, 52 -62 C 38 -70, 26 -70, 12 -66 Z" fill={color} />
      <Path d="M 12 -70 C 0 -86, -18 -86, -28 -76 C -12 -78, 0 -76, 10 -66 Z" fill={color} />
      <Path d="M 12 -70 C 22 -92, 40 -96, 50 -90 C 36 -86, 24 -80, 14 -68 Z" fill={color} />
      <Path d="M 12 -70 C 2 -94, -10 -100, -20 -96 C -6 -90, 4 -80, 10 -68 Z" fill={color} />
    </G>
  );
}

function Pagoda({ x, y, s = 1, color = '#1A1535' }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Rect x={-10} y={-18} width={20} height={18} fill={color} />
      <Path d="M -26 -18 L 26 -18 L 16 -26 L -16 -26 Z" fill={color} />
      <Rect x={-8} y={-40} width={16} height={14} fill={color} />
      <Path d="M -22 -40 L 22 -40 L 13 -48 L -13 -48 Z" fill={color} />
      <Rect x={-6} y={-60} width={12} height={12} fill={color} />
      <Path d="M -18 -60 L 18 -60 L 10 -68 L -10 -68 Z" fill={color} />
      <Rect x={-1} y={-80} width={2} height={12} fill={color} />
      <Rect x={-4} y={-14} width={3} height={4} fill={auth.coral} />
      <Rect x={1} y={-14} width={3} height={4} fill={auth.coral} />
    </G>
  );
}

/** The world seen through the portal: layered, flat, warm. */
function Vista() {
  return (
    <G>
      <Rect x="0" y="0" width="390" height="560" fill="url(#sky)" />
      <Stars opacity={0.9} />
      <Sparkle x={330} y={70} s={1.1} />
      <Sparkle x={196} y={214} s={0.8} color={auth.peach} />
      <Planet x={300} y={120} r={20} />
      <Circle cx={196} cy={190} r={13} fill={auth.salmon} />
      <Circle cx={345} cy={220} r={62} fill="url(#moon)" />
      <Circle cx={330} cy={205} r={10} fill="#FF9F86" opacity={0.6} />
      <Circle cx={362} cy={240} r={7} fill="#E8476F" opacity={0.5} />
      <Plane x={300} y={214} s={0.9} />
      <Cloud x={280} y={276} s={1} color={auth.salmon} />
      <Cloud x={150} y={300} s={0.8} color={auth.peach} />
      <Mountain x={250} y={330} s={1.1} />
      <City x={150} y={335} s={0.9} />
      {/* water + path */}
      <Rect x="0" y="335" width="390" height="60" fill="url(#water)" />
      <Path d="M 150 350 C 220 356, 290 350, 390 352 L 390 360 C 290 360, 220 364, 150 360 Z" fill={auth.peach} opacity={0.7} />
      <Path d="M 390 380 C 300 380, 240 400, 260 440 C 270 470, 330 480, 390 500 L 390 520 C 310 500, 230 480, 230 440 C 228 400, 300 372, 390 368 Z" fill={auth.peach} opacity={0.9} />
      {/* foreground hills and palms */}
      <Path d="M 100 420 C 160 380, 220 400, 260 420 L 260 560 L 100 560 Z" fill="#221A45" />
      <Path d="M 300 430 C 330 400, 370 400, 390 410 L 390 560 L 300 560 Z" fill="#221A45" />
      <Palm x={330} y={440} s={0.9} />
      <Palm x={362} y={470} s={1.1} />
      <Palm x={160} y={410} s={0.7} />
      <Pagoda x={352} y={372} s={0.9} />
      <Cloud x={330} y={410} s={0.7} color={auth.pink} />
    </G>
  );
}

// ─── Welcome: head bottom-left, the world opening above it ─────────────────

function Welcome() {
  return (
    <G>
      <Stars opacity={0.5} />
      <G clipPath="url(#portal)">
        <Vista />
      </G>
      {/* The opened lid: a coral crescent along the portal edge. */}
      <Path d="M 30 400 C 70 320, 180 250, 232 190 C 206 250, 120 320, 60 392 Z" fill={auth.coral} />
      <Path d="M 14 410 C 40 340, 110 280, 190 226" stroke={auth.cream} strokeWidth={10} strokeLinecap="round" fill="none" />
      {/* Head (dark on dark) with a cream rim, ear and face looking up-right. */}
      <G transform="translate(150 440)">
        <Circle cx={0} cy={0} r={150} fill="#080A15" />
        {/* ear */}
        <Circle cx={-120} cy={20} r={46} fill={auth.cream} />
        <Circle cx={-112} cy={22} r={28} fill="#080A15" />
        <Path d="M -140 -2 C -150 10, -150 30, -140 42" stroke={auth.cream} strokeWidth={8} strokeLinecap="round" fill="none" />
        {/* face mask */}
        <G transform="rotate(-14)">
          <Circle cx={6} cy={-26} r={42} fill={auth.cream} />
          <Circle cx={80} cy={-40} r={46} fill={auth.cream} />
          <Ellipse cx={58} cy={30} rx={86} ry={64} fill={auth.cream} />
          {/* eyes looking up */}
          <Ellipse cx={14} cy={-34} rx={11} ry={15} fill="#080A15" />
          <Ellipse cx={82} cy={-46} rx={11} ry={15} fill="#080A15" />
          <Circle cx={18} cy={-40} r={3.5} fill={auth.cream} />
          <Circle cx={86} cy={-52} r={3.5} fill={auth.cream} />
          {/* brow line */}
          <Path d="M -12 -64 C 20 -80, 50 -78, 70 -86" stroke="#080A15" strokeWidth={6} strokeLinecap="round" fill="none" />
          {/* nostrils */}
          <Ellipse cx={56} cy={4} rx={6} ry={4} fill="#080A15" />
          <Ellipse cx={80} cy={0} rx={6} ry={4} fill="#080A15" />
          {/* smile */}
          <Path d="M 20 44 C 50 64, 96 60, 130 36" stroke="#080A15" strokeWidth={6} strokeLinecap="round" fill="none" />
        </G>
        {/* shoulders */}
        <Path d="M -150 110 C -120 80, -80 80, -60 100" stroke={auth.cream} strokeWidth={9} strokeLinecap="round" fill="none" />
        <Path d="M 110 120 C 140 110, 170 130, 190 160" stroke={auth.cream} strokeWidth={9} strokeLinecap="round" fill="none" />
      </G>
    </G>
  );
}

// ─── Phone: the chimp on a cliff with a backpack, facing the city ──────────

function Phone() {
  return (
    <G>
      <Rect x="0" y="0" width="390" height="560" fill="url(#night)" />
      <Stars />
      <Sparkle x={120} y={60} s={1} />
      <Sparkle x={300} y={120} s={0.9} color={auth.coral} />
      <Sparkle x={70} y={110} s={0.7} color={auth.coral} />
      {/* crescent moon */}
      <Circle cx={330} cy={62} r={26} fill={auth.coral} />
      <Circle cx={340} cy={56} r={24} fill={auth.bg} />
      <Plane x={300} y={128} s={0.95} />
      {/* big warm sun-moon behind the city */}
      <Circle cx={240} cy={300} r={96} fill="url(#moon)" />
      <Cloud x={20} y={250} s={1.3} color={auth.salmon} />
      <Cloud x={-20} y={300} s={1.1} color={auth.coral} />
      <Cloud x={300} y={280} s={0.9} color={auth.salmon} />
      <City x={170} y={340} s={0.95} />
      {/* bridge */}
      <Path d="M 300 330 L 390 330" stroke={auth.purple} strokeWidth={3} />
      <Path d="M 318 330 L 318 302 M 360 330 L 360 302" stroke={auth.purple} strokeWidth={4} />
      <Path d="M 300 318 C 318 300, 340 318, 360 302 C 372 312, 384 318, 390 320" stroke={auth.purple} strokeWidth={2} fill="none" />
      <Rect x="0" y="340" width="390" height="60" fill="url(#water)" />
      <Path d="M 170 350 C 230 356, 300 350, 390 352 L 390 360 C 300 360, 230 364, 170 360 Z" fill={auth.peach} opacity={0.7} />
      <Pagoda x={346} y={420} s={1.2} />
      <Palm x={30} y={330} s={1.1} color="#171331" />
      {/* cliff */}
      <Path d="M 0 400 C 60 360, 150 370, 210 420 C 250 450, 290 500, 300 560 L 0 560 Z" fill="#1E1A3E" />
      <Path d="M 0 430 C 70 400, 150 404, 200 440 C 230 462, 250 500, 256 560 L 0 560 Z" fill="#15122E" />
      <Path d="M 290 520 L 322 470 L 318 520 Z M 312 530 L 350 490 L 336 534 Z" fill={auth.coral} />
      {/* the chimp, sitting, seen from behind-left, looking right */}
      <G transform="translate(118 356)">
        {/* backpack */}
        <Rect x={-58} y={-6} width={46} height={58} rx={14} fill={auth.coral} />
        <Rect x={-54} y={24} width={38} height={18} rx={7} fill="#E4544E" />
        {/* body */}
        <Ellipse cx={0} cy={22} rx={44} ry={48} fill="#080A15" />
        <Path d="M -20 -10 C -10 20, 10 30, 30 34" stroke={auth.coral} strokeWidth={7} strokeLinecap="round" fill="none" />
        {/* head */}
        <Circle cx={10} cy={-46} r={40} fill="#080A15" />
        <Circle cx={-24} cy={-44} r={16} fill={auth.cream} />
        <Circle cx={-21} cy={-43} r={9} fill="#080A15" />
        {/* face profile (looking right and up) */}
        <G transform="rotate(-12 30 -50)">
          <Circle cx={30} cy={-58} r={18} fill={auth.cream} />
          <Ellipse cx={40} cy={-36} rx={24} ry={18} fill={auth.cream} />
          <Ellipse cx={34} cy={-60} rx={4} ry={6} fill="#080A15" />
          <Path d="M 36 -28 C 44 -24, 52 -26, 58 -32" stroke="#080A15" strokeWidth={3} strokeLinecap="round" fill="none" />
        </G>
      </G>
    </G>
  );
}

function Quiet() {
  return (
    <G>
      <Rect x="0" y="0" width="390" height="560" fill="url(#night)" />
      <Stars />
      <Sparkle x={70} y={80} s={1} />
      <Sparkle x={320} y={160} s={0.9} color={auth.coral} />
      <Planet x={300} y={96} r={22} />
      <Circle cx={80} cy={180} r={12} fill={auth.salmon} />
      <Plane x={220} y={200} s={0.8} />
      <Cloud x={-20} y={330} s={1.4} color={auth.salmon} />
      <Cloud x={290} y={360} s={1.1} color={auth.coral} />
      <City x={110} y={420} s={1} color={auth.purple} />
      <Path d="M 0 420 L 390 420 L 390 560 L 0 560 Z" fill="#15122E" />
    </G>
  );
}
