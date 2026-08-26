import { AppState, Button, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useEffect } from 'react';

import { PERSIST_IDS } from '@ukladjs/persist';

import { persistence, runtime } from './src/app/uklad';
import { UkladProvider, useRuntime, useSubscription } from './src/app/bindings';
import { eventIds, subscriptionIds } from './src/app/catalog';

function PersistScreen() {
  const count = useSubscription([subscriptionIds.count]);
  const status = useSubscription([PERSIST_IDS.STATUS]);
  const appRuntime = useRuntime();

  if (status !== 'hydrated') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <Text style={styles.title}>Uklad + bare React Native</Text>
          <Text style={styles.status}>Persistence: {status}</Text>
          {status === 'failed' ? (
            <View style={styles.recovery}>
              <Text style={styles.copy}>
                Saved state could not be restored. Retry hydration or clear the stored value to
                continue with the current state.
              </Text>
              <Button title="Retry hydration" onPress={() => persistence.hydrate()} />
              <Button
                title="Clear saved value"
                onPress={() => void persistence.purge().catch(() => {})}
              />
            </View>
          ) : (
            <Text style={styles.copy}>
              Restoring saved state before domain actions are enabled…
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.title}>Uklad + bare React Native</Text>
        <Text style={styles.copy}>
          This fixture uses AsyncStorage and exercises ordered async writes, hydration, purge, and
          flush().
        </Text>
        <Text style={styles.status}>Persistence: {status}</Text>
        <Text style={styles.count}>{count}</Text>
        <Button title="Increment" onPress={() => appRuntime.dispatch([eventIds.increment])} />
        <View style={styles.gap} />
        <Button
          title="Purge saved value"
          onPress={() => void persistence.purge().catch(() => {})}
        />
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        void persistence.flush().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <UkladProvider runtime={runtime}>
      <PersistScreen />
    </UkladProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#ffffff' },
  content: { flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: '#ffffff' },
  title: { color: '#111827', fontSize: 24, fontWeight: '700' },
  copy: { color: '#4b5563', fontSize: 16, lineHeight: 22 },
  status: { color: '#111827', fontSize: 16, fontWeight: '600' },
  count: { color: '#111827', fontSize: 64, fontWeight: '800', textAlign: 'center' },
  recovery: { gap: 12 },
  gap: { height: 4 },
});
