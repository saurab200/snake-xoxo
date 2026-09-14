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

AppRegistry.registerComponent(appName, () => App);

AppRegistry.registerComponent('SnakeOverlay', () => SnakeOverlay);
AppRegistry.registerComponent('BlockOverlay', () => BlockOverlay);
AppRegistry.registerComponent('WidgetOverlay', () => WidgetOverlay);
