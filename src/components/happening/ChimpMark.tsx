import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

/** Chimp's mark: a simple, friendly chimp face (original drawing). */
export function ChimpMark({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="Chimp">
      {/* ears */}
      <Circle cx="16" cy="50" r="13" fill="#1B1B1F" />
      <Circle cx="84" cy="50" r="13" fill="#1B1B1F" />
      <Circle cx="16" cy="50" r="7" fill="#F2D7BE" />
      <Circle cx="84" cy="50" r="7" fill="#F2D7BE" />
      {/* head */}
      <Circle cx="50" cy="48" r="36" fill="#1B1B1F" />
      {/* face */}
      <Path d="M50 26c-10 0-17 5-19 12-8 2-12 9-12 17 0 13 13 23 31 23s31-10 31-23c0-8-4-15-12-17-2-7-9-12-19-12z" fill="#F2D7BE" />
      {/* eyes */}
      <Ellipse cx="40" cy="45" rx="4.2" ry="5.2" fill="#1B1B1F" />
      <Ellipse cx="60" cy="45" rx="4.2" ry="5.2" fill="#1B1B1F" />
      <Circle cx="41.4" cy="43.4" r="1.4" fill="#FFFFFF" />
      <Circle cx="61.4" cy="43.4" r="1.4" fill="#FFFFFF" />
      {/* nose + smile */}
      <Ellipse cx="46" cy="57" rx="1.8" ry="1.4" fill="#1B1B1F" />
      <Ellipse cx="54" cy="57" rx="1.8" ry="1.4" fill="#1B1B1F" />
      <Path d="M39 64c6 6 16 6 22 0" stroke="#1B1B1F" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}
