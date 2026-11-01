// The app's entry: Expo Router, plus (on Android builds) the home-screen
// widget's handler and the place-reminder task, which Android runs even
// when the app isn't open.
import 'expo-router/entry';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

if (Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./widgets/task-handler');
  registerWidgetTaskHandler(widgetTaskHandler);
}

// Place reminders: the geofence task (lib/geofence-task.ts). Phones only;
// Expo Go can't run background location.
if ((Platform.OS === 'android' || Platform.OS === 'ios') && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
  require('./lib/geofence-task');
}
