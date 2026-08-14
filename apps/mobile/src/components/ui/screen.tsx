import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/theme';

export interface ScreenProps {
  children: ReactNode;
  /**
   * Which edges get safe-area padding. Screens inside the tab navigator should
   * usually omit 'bottom' — the tab bar already covers that inset, and padding
   * it twice leaves a visible gap.
   */
  edges?: ('top' | 'bottom')[];
  style?: ViewStyle;
  /** Use the raised surface colour, e.g. for modals presented over a screen. */
  elevated?: boolean;
}

export function Screen({ children, edges = [], style, elevated = false }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const colors = useColors();

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: elevated ? colors.surface : colors.background },
        edges.includes('top') && { paddingTop: insets.top },
        edges.includes('bottom') && { paddingBottom: insets.bottom },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
