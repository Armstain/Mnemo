// Registered here, not in a screen: Android runs the widget handler and the place-reminder task with the app closed.
import 'expo-router/entry';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

if (Platform.OS === 'android' && !inExpoGo) {
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./widgets/task-handler');
  registerWidgetTaskHandler(widgetTaskHandler);
}

// Expo Go can't run background location.
if ((Platform.OS === 'android' || Platform.OS === 'ios') && !inExpoGo) {
  require('./lib/geofence-task');
}
