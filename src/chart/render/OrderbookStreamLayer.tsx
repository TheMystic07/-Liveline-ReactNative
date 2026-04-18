import { memo } from 'react';
import { Group, Text } from '@shopify/react-native-skia';
import type { SkFont } from '@shopify/react-native-skia';

import type { OrderbookStreamSlot } from '../orderbookStream/useOrderbookStream';

type OrderbookStreamRowProps = {
  slot: OrderbookStreamSlot;
  font: SkFont;
};

const OrderbookStreamRow = memo(function OrderbookStreamRow({ slot, font }: OrderbookStreamRowProps) {
  return (
    <Text
      x={slot.x}
      y={slot.y}
      text={slot.text}
      font={font}
      color={slot.color}
      opacity={slot.opacity}
    />
  );
});

type OrderbookStreamLayerProps = {
  slots: readonly OrderbookStreamSlot[];
  font: SkFont | null;
};

function OrderbookStreamLayerImpl({ slots, font }: OrderbookStreamLayerProps) {
  if (!font) return null;

  return (
    <Group opacity={1}>
      {slots.map((slot) => (
        <OrderbookStreamRow key={slot.id} slot={slot} font={font} />
      ))}
    </Group>
  );
}

export const OrderbookStreamLayer = memo(OrderbookStreamLayerImpl);
