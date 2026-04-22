import { useEffect, useRef } from 'react';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
  type DerivedValue,
} from 'react-native-reanimated';
import { rect, type SkHostRect } from '@shopify/react-native-skia';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type DrawEasing = 'ease-out' | 'linear' | 'ease-in-out';

export type UseStaticDrawAnimationInput = {
  /** True when the chart has data and layout is ready. */
  ready: boolean;
  /** Chart content width (layoutWidth - pad.left - pad.right). */
  chartWidth: number;
  /** Full layout height (used for clip rect). */
  chartHeight: number;
  /** Left padding (clip rect starts here). */
  padLeft: number;
  /** Draw animation duration in ms (default 1200). */
  duration: number;
  /** Easing curve (default 'ease-out'). */
  easing: DrawEasing;
  /** Called on the JS thread when the draw animation completes. */
  onComplete?: () => void;
};

export type UseStaticDrawAnimationOutput = {
  /** 0→1 progress of the draw animation. */
  svDrawProgress: SharedValue<number>;
  /** 0 during animation, 1 when complete. */
  drawComplete: SharedValue<number>;
  /** Animated clip rect that reveals the chart left-to-right. */
  dvClipRect: DerivedValue<SkHostRect>;
  /** X position of the leading edge of the clip (for the drawing dot). */
  dvDrawDotX: DerivedValue<number>;
  /** Grid opacity (fades in fast, 0→15% of draw progress). */
  dvGridOp: DerivedValue<number>;
  /** Badge opacity (fades in at 85%→100% of draw progress). */
  dvBadgeOp: DerivedValue<number>;
  /** Drawing dot opacity (1 during draw, fades out on complete). */
  dvDrawDotOp: DerivedValue<number>;
  /** Static end dot opacity (0 during draw, 1 on complete). */
  dvEndDotOp: DerivedValue<number>;
};

/* ------------------------------------------------------------------ */
/*  Easing map                                                         */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useStaticDrawAnimation(
  input: UseStaticDrawAnimationInput,
): UseStaticDrawAnimationOutput {
  const { ready, chartWidth, chartHeight, padLeft, duration, easing, onComplete } = input;

  const svDrawProgress = useSharedValue(0);
  const drawComplete = useSharedValue(0);
  const startedRef = useRef(false);

  // Fire the animation once when ready
  useEffect(() => {
    if (!ready || chartWidth <= 0 || startedRef.current) return;
    startedRef.current = true;

    svDrawProgress.value = withTiming(
      1,
      { duration, easing: resolveEasing(easing) },
      (finished) => {
        'worklet';
        if (finished) {
          drawComplete.value = 1;
          if (onComplete) runOnJS(onComplete)();
        }
      },
    );
  }, [ready, chartWidth, duration, easing, onComplete, svDrawProgress, drawComplete]);

  // Clip rect: expands from padLeft to padLeft + chartWidth
  const dvClipRect = useDerivedValue(() => {
    const w = svDrawProgress.value * chartWidth;
    return rect(padLeft - 1, 0, w + 2, chartHeight);
  }, [padLeft, chartWidth, chartHeight]);

  // Drawing dot X position (leading edge of clip)
  const dvDrawDotX = useDerivedValue(
    () => padLeft + svDrawProgress.value * chartWidth,
    [padLeft, chartWidth],
  );

  // Grid opacity: fast fade-in (0→15% of progress maps to 0→1 opacity)
  const dvGridOp = useDerivedValue(
    () => Math.min(1, svDrawProgress.value * (1 / 0.15)),
  );

  // Badge opacity: fades in at 85%→100% of progress
  const dvBadgeOp = useDerivedValue(() => {
    const p = svDrawProgress.value;
    return p > 0.85 ? (p - 0.85) / 0.15 : 0;
  });

  // Drawing dot opacity: visible during draw, 0 when complete
  const dvDrawDotOp = useDerivedValue(
    () => (drawComplete.value === 1 ? 0 : Math.min(1, svDrawProgress.value * 4)),
  );

  // Static end dot: visible only after draw completes
  const dvEndDotOp = useDerivedValue(
    () => drawComplete.value,
  );

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
