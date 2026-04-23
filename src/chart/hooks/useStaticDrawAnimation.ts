import { useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type DerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { rect, type SkHostRect } from '@shopify/react-native-skia';

export type DrawEasing = 'ease-out' | 'linear' | 'ease-in-out';

export type UseStaticDrawAnimationInput = {
  ready: boolean;
  chartWidth: number;
  chartHeight: number;
  padLeft: number;
  animationKey?: string | number;
  duration: number;
  easing: DrawEasing;
  onComplete?: () => void;
};

export type UseStaticDrawAnimationOutput = {
  svDrawProgress: SharedValue<number>;
  drawComplete: SharedValue<number>;
  dvClipRect: DerivedValue<SkHostRect>;
  dvDrawDotX: SharedValue<number>;
  dvGridOp: SharedValue<number>;
  dvBadgeOp: SharedValue<number>;
  dvDrawDotOp: SharedValue<number>;
  dvEndDotOp: SharedValue<number>;
};

function resolveEasing(e: DrawEasing) {
  switch (e) {
    case 'linear':
      return Easing.linear;
    case 'ease-in-out':
      return Easing.inOut(Easing.quad);
    case 'ease-out':
    default:
      return Easing.out(Easing.cubic);
  }
}

export function useStaticDrawAnimation(
  input: UseStaticDrawAnimationInput,
): UseStaticDrawAnimationOutput {
  const {
    ready,
    chartWidth,
    chartHeight,
    padLeft,
    animationKey,
    duration,
    easing,
    onComplete,
  } = input;

  const svDrawProgress = useSharedValue(0);
  const drawComplete = useSharedValue(0);
  const dvDrawDotX = useSharedValue(padLeft);
  const dvGridOp = useSharedValue(0);
  const dvBadgeOp = useSharedValue(0);
  const dvDrawDotOp = useSharedValue(0);
  const dvEndDotOp = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(svDrawProgress);
    cancelAnimation(dvDrawDotX);
    cancelAnimation(dvGridOp);
    cancelAnimation(dvBadgeOp);
    cancelAnimation(dvDrawDotOp);
    cancelAnimation(dvEndDotOp);

    if (!ready || chartWidth <= 0) {
      svDrawProgress.value = 0;
      drawComplete.value = 0;
      dvDrawDotX.value = padLeft;
      dvGridOp.value = 0;
      dvBadgeOp.value = 0;
      dvDrawDotOp.value = 0;
      dvEndDotOp.value = 0;
      return;
    }

    svDrawProgress.value = 0;
    drawComplete.value = 0;
    dvDrawDotX.value = padLeft;
    dvGridOp.value = 0;
    dvBadgeOp.value = 0;
    dvDrawDotOp.value = 0;
    dvEndDotOp.value = 0;

    dvDrawDotX.value = withTiming(padLeft + chartWidth, {
      duration,
      easing: resolveEasing(easing),
    });
    dvGridOp.value = withTiming(1, {
      duration: Math.max(1, duration * 0.15),
      easing: Easing.out(Easing.quad),
    });
    dvBadgeOp.value = withTiming(1, {
      duration: Math.max(1, duration * 0.15),
      easing: Easing.out(Easing.quad),
    });
    svDrawProgress.value = withTiming(
      1,
      { duration, easing: resolveEasing(easing) },
      (finished) => {
        'worklet';
        if (finished) {
          drawComplete.value = 1;
          dvEndDotOp.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) });
          if (onComplete) runOnJS(onComplete)();
        }
      },
    );
  }, [
    animationKey,
    ready,
    chartWidth,
    duration,
    easing,
    onComplete,
    padLeft,
    svDrawProgress,
    drawComplete,
    dvDrawDotX,
    dvGridOp,
    dvBadgeOp,
    dvDrawDotOp,
    dvEndDotOp,
  ]);

  const dvClipRect = useDerivedValue(() => {
    const width = svDrawProgress.value * chartWidth;
    return rect(padLeft - 1, 0, width + 2, chartHeight);
  }, [padLeft, chartWidth, chartHeight]);

  return {
    svDrawProgress,
    drawComplete,
    dvClipRect,
    dvDrawDotX,
    dvGridOp,
    dvBadgeOp,
    dvDrawDotOp,
    dvEndDotOp,
  };
}
