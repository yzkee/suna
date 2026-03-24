import * as React from 'react';
import { View } from 'react-native';
import { IntegrationsPageContent } from '@/components/settings/IntegrationsPage';

export default function IntegrationsScreen() {
  return (
    <View className="flex-1 bg-background">
      <View className="flex-1 px-6 pt-3">
        <IntegrationsPageContent noPadding />
      </View>
    </View>
  );
}
