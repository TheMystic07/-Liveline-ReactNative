import { useState } from 'react';

export type InteractionConfig = {
  scrubNumberFlow: boolean;
  setScrubNumberFlow: (v: boolean | ((prev: boolean) => boolean)) => void;
  scrubHaptics: boolean;
  setScrubHaptics: (v: boolean | ((prev: boolean) => boolean)) => void;
  snapToPointScrubbing: boolean;
  setSnapToPointScrubbing: (v: boolean | ((prev: boolean) => boolean)) => void;
  pinchToZoom: boolean;
  setPinchToZoom: (v: boolean | ((prev: boolean) => boolean)) => void;
};

export function useInteractionConfig(): InteractionConfig {
  const [scrubNumberFlow, setScrubNumberFlow] = useState<boolean>(false);
  const [scrubHaptics, setScrubHaptics] = useState<boolean>(true);
  const [snapToPointScrubbing, setSnapToPointScrubbing] = useState<boolean>(false);
  const [pinchToZoom, setPinchToZoom] = useState<boolean>(false);

  return {
    scrubNumberFlow,
    setScrubNumberFlow,
    scrubHaptics,
    setScrubHaptics,
    snapToPointScrubbing,
    setSnapToPointScrubbing,
    pinchToZoom,
    setPinchToZoom,
  };
}
