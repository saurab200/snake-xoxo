#!/usr/bin/env node
/**
 * Writes android/local.properties for whatever machine this is.
 *
 * Exists because the Android SDK lives somewhere different on every OS, and
 * because local.properties is a Java properties file where BACKSLASHES ARE
 * ESCAPE CHARACTERS -- so a pasted Windows path like C:\Users\me\AppData
 * silently fails. We always write forward slashes, which Gradle accepts on
 * every platform including Windows.
 *
 * Run: npm run setup
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function candidates() {
  const home = os.homedir();
  const env = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const list = env ? [env] : [];

  if (process.platform === 'darwin') {
    list.push(path.join(home, 'Library', 'Android', 'sdk'));
  } else if (process.platform === 'win32') {
    const localAppData =
      process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    list.push(path.join(localAppData, 'Android', 'Sdk'));
  } else {
    list.push(path.join(home, 'Android', 'Sdk'));
  }

  return list;
}

function looksLikeSdk(dir) {
  return fs.existsSync(path.join(dir, 'platform-tools'));
}

const searched = candidates();
const found = searched.find(looksLikeSdk);

if (!found) {
  console.error('\nCould not find your Android SDK. Looked in:');
  searched.forEach(dir => console.error('  ' + dir));
  console.error(
    '\nInstall Android Studio, open it once so it downloads the SDK, then\n' +
      're-run `npm run setup`. If your SDK is somewhere custom, set ANDROID_HOME\n' +
      'and re-run, or write android/local.properties by hand using FORWARD\n' +
      'slashes:\n\n  sdk.dir=C:/Users/you/AppData/Local/Android/Sdk\n',
  );
  process.exit(1);
}

const sdkPath = found.split(path.sep).join('/');
const target = path.join(__dirname, '..', 'android', 'local.properties');
fs.writeFileSync(target, `sdk.dir=${sdkPath}\n`);

console.log(`Wrote android/local.properties\n  sdk.dir=${sdkPath}`);
