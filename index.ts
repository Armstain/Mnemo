// The app's entry: Expo Router, plus (on Android builds) the home-screen
// widget's handler, which Android runs even when the app isn't open.
import 'expo-router/entry';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

if (Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./widgets/task-handler');
  registerWidgetTaskHandler(widgetTaskHandler);
}
