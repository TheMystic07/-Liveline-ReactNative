import { DashPathEffect, Group, Line as SkiaLine } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

type ReferenceLineCanvasProps = {
  label?: string;
  y: number | SharedValue<number>;
  opacity: number | SharedValue<number>;
  padLeft: number;
  padRight: number;
  layoutWidth: number;
  lineColor: string;
};

const LABEL_GAP = 10;
const LABEL_CHAR_W = 7;
const REF_DASH_INTERVALS = [4, 4];

function readWorklet(v: number | SharedValue<number>): number {
  'worklet';
  return typeof v === 'number' ? v : v.value;
}

export function ReferenceLineCanvas({
  label,
  y,
  opacity,
  padLeft,
  padRight,
  layoutWidth,
  lineColor,
}: ReferenceLineCanvasProps) {
  const hasLabel = !!label;
  const centerX = layoutWidth / 2;
  const labelWidth = hasLabel ? Math.max(44, label.length * LABEL_CHAR_W + 8) : 0;

  const yPos = useDerivedValue(() => readWorklet(y), [y]);
  const opacityVal = useDerivedValue(() => readWorklet(opacity), [opacity]);

  const p1Seg1 = useDerivedValue(() => ({ x: padLeft, y: yPos.value }));
  const p2Seg1 = useDerivedValue(() => ({ x: centerX - labelWidth / 2 - LABEL_GAP, y: yPos.value }));
  const p1Seg2 = useDerivedValue(() => ({ x: centerX + labelWidth / 2 + LABEL_GAP, y: yPos.value }));
  const p2Seg2 = useDerivedValue(() => ({ x: layoutWidth - padRight, y: yPos.value }));
  const p1Full = useDerivedValue(() => ({ x: padLeft, y: yPos.value }));
  const p2Full = useDerivedValue(() => ({ x: layoutWidth - padRight, y: yPos.value }));

  return (
    <Group opacity={opacityVal}>
      {hasLabel ? (
        <>
          <SkiaLine p1={p1Seg1} p2={p2Seg1} color={lineColor} strokeWidth={1} />
          <SkiaLine p1={p1Seg2} p2={p2Seg2} color={lineColor} strokeWidth={1} />
        </>
      ) : (
        <SkiaLine p1={p1Full} p2={p2Full} color={lineColor} strokeWidth={1}>
          <DashPathEffect intervals={REF_DASH_INTERVALS} />
        </SkiaLine>
      )}
    </Group>
  );
}
