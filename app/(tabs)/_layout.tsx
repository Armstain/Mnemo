import { Tabs } from 'expo-router';
import { Archive, Home } from 'lucide-react-native';
import React from 'react';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#3D3A36',
        tabBarInactiveTintColor: '#9E9890',
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#F5F0EB',
          borderTopWidth: 1,
          borderTopColor: '#E2DDD6',
          height: 72,
          paddingBottom: 16,
          paddingTop: 12,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter_600SemiBold',
          fontSize: 10,
          letterSpacing: 0.5,
          marginTop: 4,
          textTransform: 'uppercase',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Home size={22} color={color} strokeWidth={1.8} />,
        }}
      />
      <Tabs.Screen
        name="archive"
        options={{
          title: 'Archive',
          tabBarIcon: ({ color }) => <Archive size={22} color={color} strokeWidth={1.8} />,
        }}
      />
      <Tabs.Screen
        name="context"
        options={{
          title: 'Detail',
          href: null,
        }}
      />
      <Tabs.Screen
        name="two"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
