import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export function scrubPanBeginHaptic(): void {
  if (Platform.OS === 'web') return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** Fires when scrubbed price moves to another cent (selection-style tick). */
export function scrubCentTickHaptic(): void {
  if (Platform.OS === 'web') return;
  void Haptics.selectionAsync();
}
