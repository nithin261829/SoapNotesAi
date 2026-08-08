import { Feather } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { isRecordingActive, triggerDiscardRecording } from '@/recording/recordingFlag';
import { useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

function makeBlocker(
  target: '/(tabs)/patients' | '/(tabs)/profile',
  router: ReturnType<typeof useRouter>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (e: any) => {
    if (!isRecordingActive()) return;
    e.preventDefault();
    Alert.alert(
      'Recording in progress',
      'You have an active or paused recording. Discard it and leave this tab?',
      [
        { text: 'Stay & continue', style: 'cancel' },
        {
          text: 'Discard recording',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await triggerDiscardRecording();
              router.push(target);
            })();
          },
        },
      ],
    );
  };
}

export default function TabsLayout() {
  const router = useRouter();
  const c = useThemeColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          borderTopWidth: 1,
          height: 86,
          paddingTop: 8,
          paddingBottom: 28,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.displayBold,
          fontSize: 11,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          marginTop: 2,
        },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen
        name="record"
        options={{
          title: 'Record',
          tabBarIcon: ({ color, focused }) => (
            <Feather name="mic" size={focused ? 24 : 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="patients"
        options={{
          title: 'Patients',
          tabBarIcon: ({ color, focused }) => (
            <Feather name="users" size={focused ? 24 : 22} color={color} />
          ),
        }}
        listeners={{ tabPress: makeBlocker('/(tabs)/patients', router) }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Feather name="user" size={focused ? 24 : 22} color={color} />
          ),
        }}
        listeners={{ tabPress: makeBlocker('/(tabs)/profile', router) }}
      />
    </Tabs>
  );
}
