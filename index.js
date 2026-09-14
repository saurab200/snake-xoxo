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
import KillSwitchOverlay from './src/overlays/KillSwitchOverlay';
import ReminderOverlay from './src/overlays/ReminderOverlay';
import SnakeOverlay from './src/overlays/SnakeOverlay';
import WidgetOverlay from './src/overlays/WidgetOverlay';
import {startSnake} from './src/state/bootstrap';
import {startWidgetTrigger} from './src/state/widgetTrigger';

AppRegistry.registerComponent(appName, () => App);

AppRegistry.registerComponent('SnakeOverlay', () => SnakeOverlay);
AppRegistry.registerComponent('BlockOverlay', () => BlockOverlay);
AppRegistry.registerComponent('WidgetOverlay', () => WidgetOverlay);
AppRegistry.registerComponent('ReminderOverlay', () => ReminderOverlay);
AppRegistry.registerComponent('KillSwitchOverlay', () => KillSwitchOverlay);

/**
 * Started at module scope, NOT from a React component.
 *
 * Android destroys MainActivity when the user leaves the app, which would unmount
 * anything mounted from App.tsx and silently kill these. The JS context outlives
 * every activity, so this is what makes the snake stay pinned to the top of the
 * screen and the Canvas widget appear over other apps.
 *
 * Registered first so the components exist before anything tries to show them.
 */
startWidgetTrigger();
startSnake();
