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
import TaskCardOverlay from './src/overlays/TaskCardOverlay';
import WidgetOverlay from './src/overlays/WidgetOverlay';
import XpBarOverlay from './src/overlays/XpBarOverlay';
import {startSnake} from './src/state/bootstrap';
import {initializeGamification} from './src/state/gamificationStore';
import {startWidgetTrigger} from './src/state/widgetTrigger';

AppRegistry.registerComponent(appName, () => App);

AppRegistry.registerComponent('SnakeOverlay', () => SnakeOverlay);
AppRegistry.registerComponent('BlockOverlay', () => BlockOverlay);
AppRegistry.registerComponent('WidgetOverlay', () => WidgetOverlay);
AppRegistry.registerComponent('ReminderOverlay', () => ReminderOverlay);
AppRegistry.registerComponent('KillSwitchOverlay', () => KillSwitchOverlay);
AppRegistry.registerComponent('TaskCardOverlay', () => TaskCardOverlay);
AppRegistry.registerComponent('XpBarOverlay', () => XpBarOverlay);

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
/**
 * Gamification goes first: it hydrates persisted points and installs the single
 * session-completion listener. Same reasoning as the two below -- a component
 * effect would be torn down when Android destroys MainActivity, and a session
 * that completes while the user is in Instagram would never be credited.
 * initializeGamification() is idempotent, so a re-import cannot double-register.
 */
initializeGamification();
startWidgetTrigger();
startSnake();
