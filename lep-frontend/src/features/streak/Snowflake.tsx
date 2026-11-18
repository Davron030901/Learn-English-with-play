import Svg, { Circle, G, Path } from 'react-native-svg';

/**
 * A streak freeze (docs/16 icon plan: snowflake): six arms with little branches. Filled when the
 * freeze is ready, a dashed ring while one is on its way back. Decorative — the card says the
 * number in words.
 */
export function Snowflake({ size = 32, color, ready, track }: { size?: number; color: string; ready: boolean; track: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      {ready ? (
        <G stroke={color} strokeWidth={2.2} strokeLinecap="round" fill="none">
          {[0, 60, 120].map((a) => (
            <G key={a} transform={`rotate(${a} 16 16)`}>
              <Path d="M16 4 L16 28" />
              <Path d="M12.5 7 L16 10 L19.5 7" />
              <Path d="M12.5 25 L16 22 L19.5 25" />
            </G>
          ))}
        </G>
      ) : (
        <Circle cx={16} cy={16} r={11} fill="none" stroke={track} strokeWidth={2} strokeDasharray="3 3" />
      )}
    </Svg>
  );
}
