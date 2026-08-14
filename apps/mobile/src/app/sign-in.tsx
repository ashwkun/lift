import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Screen, Text, TextField } from '@/components/ui';
import { authClient } from '@/features/sync/auth-client';
import { useSync } from '@/store/sync';
import { radius, spacing, useColors } from '@/theme';

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const colors = useColors();
  const sync = useSync((state) => state.sync);

  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === 'sign-up';
  const canSubmit =
    email.trim().length > 0 && password.length >= 8 && (!isSignUp || name.trim().length > 0);

  const submit = async () => {
    if (!canSubmit || busy) return;

    setBusy(true);
    setError(null);

    try {
      const result = isSignUp
        ? await authClient.signUp.email({ email: email.trim(), password, name: name.trim() })
        : await authClient.signIn.email({ email: email.trim(), password });

      if (result.error) {
        setError(result.error.message ?? 'Something went wrong. Try again.');
        return;
      }

      // First sync happens immediately so the account's existing history is
      // present before the user reaches the dashboard.
      void sync();
      router.back();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: isSignUp ? 'Create Account' : 'Sign In' }} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.hero, { backgroundColor: colors.accentSurface }]}>
            <Ionicons name="cloud-outline" size={28} color={colors.accent} />
          </View>

          <Text variant="heading" align="center">
            {isSignUp ? 'Back up your training' : 'Welcome back'}
          </Text>
          <Text variant="body" color="textSecondary" align="center" style={styles.subtitle}>
            An account syncs your workouts across devices. Everything keeps working offline either
            way.
          </Text>

          {isSignUp && (
            <TextField
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              autoCapitalize="words"
              textContentType="name"
            />
          )}

          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />

          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secureTextEntry
            textContentType={isSignUp ? 'newPassword' : 'password'}
            hint={isSignUp ? 'Minimum 8 characters.' : undefined}
            onSubmitEditing={() => void submit()}
          />

          {error && (
            <View style={[styles.error, { backgroundColor: colors.dangerSurface }]}>
              <Text variant="label" color="danger">
                {error}
              </Text>
            </View>
          )}

          <Button
            title={isSignUp ? 'Create Account' : 'Sign In'}
            size="lg"
            fullWidth
            loading={busy}
            disabled={!canSubmit}
            onPress={() => void submit()}
          />

          <Pressable
            onPress={() => {
              setMode(isSignUp ? 'sign-in' : 'sign-up');
              setError(null);
            }}
            style={styles.switch}
          >
            <Text variant="label" color="accent" align="center">
              {isSignUp ? 'Already have an account? Sign in' : "No account? Create one"}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  hero: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: spacing.xl,
  },
  subtitle: { marginBottom: spacing.lg },
  error: { padding: spacing.md, borderRadius: radius.md },
  switch: { paddingVertical: spacing.md },
});
