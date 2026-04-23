import { useEffect, useRef, useState } from 'react';

import {
  WINDOW_TRANSITION_MS,
  lerpWindowLogSpace,
} from '../math/windowTransition';

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function useStaticWindowTransition(targetWindow: number) {
  const [effectiveWindow, setEffectiveWindow] = useState(targetWindow);
  const effectiveRef = useRef(targetWindow);
  const targetRef = useRef(targetWindow);

  useEffect(() => {
    effectiveRef.current = effectiveWindow;
  }, [effectiveWindow]);

  useEffect(() => {
    if (Math.abs(targetRef.current - targetWindow) < 1e-6) return;
    targetRef.current = targetWindow;

    const from = effectiveRef.current;
    const to = targetWindow;
    const start = nowMs();
    let rafId = 0;

    const tick = () => {
      const progress = Math.min(1, (nowMs() - start) / WINDOW_TRANSITION_MS);
      const next = lerpWindowLogSpace(from, to, progress);
      effectiveRef.current = next;
      setEffectiveWindow(next);

      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      effectiveRef.current = to;
      setEffectiveWindow(to);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [targetWindow]);

  return effectiveWindow;
}
