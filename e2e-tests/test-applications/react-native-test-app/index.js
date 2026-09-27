/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {PostHogProvider} from 'posthog-react-native';

function Main() {
  return (
      <App />
  );
}

AppRegistry.registerComponent(appName, () => Main);
