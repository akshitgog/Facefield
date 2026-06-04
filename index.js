import * as Worklets from 'react-native-worklets-core';
console.log("Worklets forced load: ", !!Worklets);
import {AppRegistry} from 'react-native';
import App from './App';

// The app name must match the one used in MainApplication.kt / MainActivity.kt
// For the default React Native template, it is usually the name in app.json.
// If it's a bare template, we'll try 'helloworld' or 'FieldAttend'.
AppRegistry.registerComponent('HelloWorld', () => App);
