import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { radius, spacing, useColors } from '@/theme';

import { Button } from './button';
import { TextField } from './input';
import { Text } from './text';

export interface PromptModalProps {
  visible: boolean;
  title: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
  multiline?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

/**
 * Text-input dialog.
 *
 * React Native's `Alert.prompt` is iOS-only — on Android it silently does
 * nothing, which would make "rename routine" a dead button for most users. This
 * is the cross-platform replacement.
 */
export function PromptModal({
  visible,
  title,
  message,
  initialValue = '',
  placeholder,
  confirmLabel = 'Save',
  maxLength = 80,
  multiline = false,
  onCancel,
  onConfirm,
}: PromptModalProps) {
  const colors = useColors();
  const [value, setValue] = useState(initialValue);

  // Re-seed each time the dialog opens, so a cancelled edit doesn't persist
  // into the next one.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const trimmed = value.trim();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onCancel}>
          {/* Swallows taps inside the card so they don't dismiss the modal. */}
          <Pressable
            style={[styles.card, { backgroundColor: colors.surfaceElevated }]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text variant="subheading">{title}</Text>
            {message && (
              <Text variant="label" color="textSecondary">
                {message}
              </Text>
            )}

            <TextField
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              autoFocus
              maxLength={maxLength}
              multiline={multiline}
              style={multiline ? styles.multiline : undefined}
              onSubmitEditing={() => trimmed && onConfirm(trimmed)}
              returnKeyType="done"
            />

            <View style={styles.actions}>
              <Button title="Cancel" variant="ghost" onPress={onCancel} style={styles.action} />
              <Button
                title={confirmLabel}
                disabled={trimmed.length === 0}
                onPress={() => onConfirm(trimmed)}
                style={styles.action}
              />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  multiline: { height: 120, paddingTop: spacing.md, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
});
