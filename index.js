/**
 * Every overlay is a SEPARATE React root, registered here by name.
 *
 * `Overlay.show('SnakeOverlay', ...)` on the JS side asks native to create a
 * floating window and mount the component registered under that exact string.
 * If you add a new overlay, you MUST register it here or show() will silently
 * render nothing.
 */
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

import BlockOverlay from './src/overlays/BlockOverlay';
import SnakeOverlay from './src/overlays/SnakeOverlay';
import WidgetOverlay from './src/overlays/WidgetOverlay';
import {startWidgetTrigger} from './src/state/widgetTrigger';

/**
 * Started at module scope, NOT from a React component.
 *
 * Android destroys MainActivity when the user leaves the app, which would unmount
 * anything mounted from App.tsx and silently kill the foreground-app listener --
 * so the Canvas widget would never appear over other apps. The JS context outlives
 * every activity, so starting it here is what makes the feature work at all.
 */
startWidgetTrigger();

AppRegistry.registerComponent(appName, () => App);

AppRegistry.registerComponent('SnakeOverlay', () => SnakeOverlay);
AppRegistry.registerComponent('BlockOverlay', () => BlockOverlay);
AppRegistry.registerComponent('WidgetOverlay', () => WidgetOverlay);
