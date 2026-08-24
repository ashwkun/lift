/**
 * The frame every settings page draws in.
 *
 * Settings is a hub and five pages rather than one screen seven sections long,
 * and those five would otherwise repeat the same plumbing verbatim: a title for
 * the native header, a scroll view whose offset lights the header's edge, and
 * cards sitting on the app's 16pt gutter.
 *
 * It lives here rather than in `components/ui` because none of it is a decision
 * another screen gets to make. What it encodes is what a settings page looks
 * like, which is only useful to the pages under `app/settings`.
 */

import { Stack } from 'expo-router';
import { type ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Screen, Text, useScrollEdge } from '@/components/ui';
import { spacing } from '@/theme';

export interface SettingsPageProps {
  /** The native header's title. Matches the hub row that leads here. */
  title: string;
  children: ReactNode;
}

export function SettingsPage({ title, children }: SettingsPageProps) {
  const scrollEdge = useScrollEdge();

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title }} />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        {children}
      </ScrollView>
    </Screen>
  );
}

/**
 * A note under a card, in the tertiary tier.
 *
 * Inset past the card's own edge rather than aligned to it, which is where the
 * eye expects a caption about the thing above it. Flush left, it reads as
 * another row that lost its background.
 */
export function Footnote({ children }: { children: ReactNode }) {
  return (
    <Text variant="caption" color="textTertiary" style={styles.footnote}>
      {children}
    </Text>
  );
}

/**
 * Where a card sits on a settings page.
 *
 * `first` is the one the split added. A page whose title is in the native
 * header opens on a card instead of on a section header, and the header's
 * bottom padding was what used to hold that card off the top of the page.
 * `section` is a card under a header, `sectionStacked` a second card under the
 * first: closer than two sections are to each other, which is what says the two
 * belong together.
 */
export const settingsStyles = StyleSheet.create({
  first: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  section: { marginHorizontal: spacing.lg },
  sectionStacked: { marginHorizontal: spacing.lg, marginTop: spacing.sm },
});

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  footnote: {
    marginHorizontal: spacing.lg + spacing.xs,
    marginTop: spacing.sm,
  },
});
