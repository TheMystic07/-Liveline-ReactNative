import { Circle, Line as SkiaLine } from '@shopify/react-native-skia';
import { memo } from 'react';

type Vec2 = { x: number; y: number };

type CrosshairCanvasProps = {
  lineP1: Vec2 | any;
  lineP2: Vec2 | any;
  lineOpacity: number | any;
  dotX: number | any;
  dotY: number | any;
  dotRadius: number | any;
  dotOpacity: number | any;
  lineColor: string;
  dotColor: string;
};

function CrosshairCanvasImpl({
  lineP1,
  lineP2,
  lineOpacity,
  dotX,
  dotY,
  dotRadius,
  dotOpacity,
  lineColor,
  dotColor,
}: CrosshairCanvasProps) {
  return (
    <>
      <SkiaLine
        p1={lineP1}
        p2={lineP2}
        color={lineColor}
        strokeWidth={1}
        opacity={lineOpacity}
      />

      <Circle
        cx={dotX}
        cy={dotY}
        r={dotRadius}
        color={dotColor}
        opacity={dotOpacity}
      />
    </>
  );
}

export const CrosshairCanvas = memo(CrosshairCanvasImpl);
