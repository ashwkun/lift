import { router, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Button, HeaderAction, Screen, Text, TextField, useScrollEdge } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { authClient } from '@/features/sync/auth-client';
import { useSync } from '@/store/sync';
import { radius, spacing, useColors } from '@/theme';

type Mode = 'sign-in' | 'sign-up';

/**
 * Failed authentication, in the app's own words.
 *
 * The screen used to render the caught error's `message`, which for a dropped
 * connection is React Native's `Network request failed` and for a server fault
 * is whatever string came back over the wire. Both read as debug output pasted
 * into a form. Every branch here names what happened and what is still true,
 * because none of these outcomes cost anything: the training log lives on the
 * device and an account only adds a backup on top of it.
 *
 * The failure is read structurally rather than through better-auth's own error
 * type, so a client upgrade that reshapes it degrades to the last branch rather
 * than to a compile error on a screen nobody is looking at.
 */
function describeFailure(cause: unknown, isSignUp: boolean): string {
  const shape = (typeof cause === 'object' && cause !== null ? cause : {}) as {
    status?: unknown;
    code?: unknown;
  };
  const status = typeof shape.status === 'number' ? shape.status : undefined;
  const code = typeof shape.code === 'string' ? shape.code : '';

  if (code === 'INVALID_EMAIL_OR_PASSWORD' || status === 401) {
    return 'That email and password do not match an account.';
  }
  if (code === 'USER_ALREADY_EXISTS' || status === 422) {
    return 'There is already an account with that email. Switch to sign in below.';
  }
  if (status === 429) {
    return 'Too many attempts in a row. Wait a minute, then try again.';
  }
  if (status !== undefined && status >= 500) {
    return 'The server answered with a fault. Nothing on this device changed. Try again later.';
  }

  return isSignUp
    ? 'The account was not created. Nothing on this device changed.'
    : 'Sign-in did not go through. Nothing on this device changed.';
}

export default function SignInScreen() {
  const scrollEdge = useScrollEdge();

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

  /**
   * Leaving is never conditional on there being something behind this screen.
   * The account is optional, so a deep link straight into `lift://sign-in` must
   * still have a way out; without the fallback, `back()` on an empty history is
   * a no-op and the screen becomes the gate it is not.
   */
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile');
  }, []);

  const submit = async () => {
    if (!canSubmit || busy) return;

    setBusy(true);
    setError(null);

    try {
      const result = isSignUp
        ? await authClient.signUp.email({ email: email.trim(), password, name: name.trim() })
        : await authClient.signIn.email({ email: email.trim(), password });

      if (result.error) {
        haptics.rejected();
        setError(describeFailure(result.error, isSignUp));
        return;
      }

      // First sync happens immediately so the account's existing history is
      // present before the user reaches the dashboard.
      void sync();
      leave();
    } catch {
      // A throw here means the request never completed, which is the one case
      // the user can do nothing about and the one case that costs them least.
      haptics.rejected();
      setError(
        'Could not reach the server. Everything you have logged is still on this device. Try again later, or carry on without an account.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: isSignUp ? 'Create account' : 'Sign in',
          /*
           * The back chevron is replaced by a word. It costs no extra accent —
           * the chevron it stands in for was already the header's only control
           * — and where a chevron only says "back", "Not now" says the account
           * is a choice, on the one screen in the app that could be mistaken for
           * a gate in front of everything else.
           */
          headerBackVisible: false,
          headerLeft: () => (
            <HeaderAction label="Leave without an account" title="Not now" side="left" onPress={leave} />
          ),
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          {...scrollEdge.list}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/*
           * A tinted disc with a cloud in it, over a centred heading and a
           * centred paragraph, is the stock sign-in screen — and centring the
           * copy fights the form directly below it, every field of which is
           * left-aligned. The eye now starts at one margin and stays there.
           *
           * The heading names the feature rather than greeting the user. The
           * account adds backup and sync and nothing else, so "Welcome back"
           * told a returning user nothing and set the tone of a wall in front of
           * an app that works completely without one.
           */}
          <View style={styles.hero}>
            <Text variant="title">Backup and sync</Text>
            <Text variant="body" color="textSecondary">
              Lift keeps every workout on this phone and works the same signed out. An account adds
              a copy you can restore from, and keeps a second device in step. Nothing here is
              required.
            </Text>
          </View>

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
            <View
              accessibilityRole="alert"
              style={[styles.error, { backgroundColor: colors.dangerSurface }]}
            >
              <Text variant="label" color="danger">
                {error}
              </Text>
            </View>
          )}

          <Button
            title={isSignUp ? 'Create account' : 'Sign in'}
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
            accessibilityRole="button"
            accessibilityLabel={isSignUp ? 'Switch to signing in' : 'Switch to creating an account'}
            style={styles.switch}
          >
            <Text variant="label" color="accent" align="center">
              {isSignUp ? 'Already have an account? Sign in' : 'No account? Create one'}
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
  hero: { gap: spacing.xs, marginTop: spacing.xxl, marginBottom: spacing.lg },
  error: { padding: spacing.md, borderRadius: radius.md },
  switch: { paddingVertical: spacing.md },
});
