import { ExpoConfig, getConfig } from '@expo/config';

import Analytics from '../Analytics';
import * as Android from '../Android';
import Config from '../Config';
import * as DevSession from '../DevSession';
import { shouldUseDevServer } from '../Env';
import * as ProjectSettings from '../ProjectSettings';
import * as Webpack from '../Webpack';
import * as ProjectUtils from '../project/ProjectUtils';
import { assertValidProjectRoot } from '../project/errors';
import { startTunnelsAsync, stopTunnelsAsync } from './ngrok';
import { startDevServerAsync, StartOptions } from './startDevServerAsync';
import { startExpoServerAsync, stopExpoServerAsync } from './startLegacyExpoServerAsync';
import {
  startReactNativeServerAsync,
  stopReactNativeServerAsync,
} from './startLegacyReactNativeServerAsync';

export async function startAsync(
  projectRoot: string,
  { exp = getConfig(projectRoot).exp, ...options }: StartOptions & { exp?: ExpoConfig } = {},
  verbose: boolean = true
): Promise<ExpoConfig> {
  assertValidProjectRoot(projectRoot);
  Analytics.logEvent('Start Project', {
    projectRoot,
    developerTool: Config.developerTool,
    sdkVersion: exp.sdkVersion ?? null,
  });

  if (options.webOnly) {
    await Webpack.restartAsync(projectRoot, options);
    DevSession.startSession(projectRoot, exp, 'web');
    return exp;
  } else if (shouldUseDevServer(exp) || options.devClient) {
    await startDevServerAsync(projectRoot, options);
    DevSession.startSession(projectRoot, exp, 'native');
  } else {
    await startExpoServerAsync(projectRoot);
    await startReactNativeServerAsync({ projectRoot, exp, options, verbose });
    DevSession.startSession(projectRoot, exp, 'native');
  }

  const { hostType } = await ProjectSettings.readAsync(projectRoot);

  if (!Config.offline && hostType === 'tunnel') {
    try {
      await startTunnelsAsync(projectRoot);
    } catch (e) {
      ProjectUtils.logDebug(projectRoot, 'expo', `Error starting tunnel ${e.message}`);
    }
  }
  return exp;
}

export async function stopWebOnlyAsync(projectRoot: string): Promise<void> {
  DevSession.stopSession();
  await Webpack.stopAsync(projectRoot);
}

async function stopInternalAsync(projectRoot: string): Promise<void> {
  DevSession.stopSession();
  await Webpack.stopAsync(projectRoot);
  ProjectUtils.logInfo(projectRoot, 'expo', '\u203A Closing Expo server');
  await stopExpoServerAsync(projectRoot);
  ProjectUtils.logInfo(projectRoot, 'expo', '\u203A Stopping Metro bundler');
  await stopReactNativeServerAsync(projectRoot);
  if (!Config.offline) {
    try {
      await stopTunnelsAsync(projectRoot);
    } catch (e) {
      ProjectUtils.logDebug(projectRoot, 'expo', `Error stopping ngrok ${e.message}`);
    }
  }

  await Android.maybeStopAdbDaemonAsync();
}

async function forceQuitAsync(projectRoot: string) {
  // find RN packager and ngrok pids, attempt to kill them manually
  const { packagerPid, ngrokPid } = await ProjectSettings.readPackagerInfoAsync(projectRoot);
  if (packagerPid) {
    try {
      process.kill(packagerPid);
    } catch (e) {}
  }
  if (ngrokPid) {
    try {
      process.kill(ngrokPid);
    } catch (e) {}
  }
  await ProjectSettings.setPackagerInfoAsync(projectRoot, {
    expoServerPort: null,
    packagerPort: null,
    packagerPid: null,
    expoServerNgrokUrl: null,
    packagerNgrokUrl: null,
    ngrokPid: null,
    webpackServerPort: null,
  });
}

export async function stopAsync(projectRoot: string): Promise<void> {
  const result = await Promise.race([
    stopInternalAsync(projectRoot),
    new Promise(resolve => setTimeout(resolve, 2000, 'stopFailed')),
  ]);
  if (result === 'stopFailed') {
    await forceQuitAsync(projectRoot);
  }
}
