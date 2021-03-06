import { Project } from '@expo/xdl';
import chalk from 'chalk';

import Log from './log';

export function installExitHooks(
  projectDir: string,
  onStop: (projectDir: string) => Promise<void> = Project.stopAsync
): void {
  const killSignals: ['SIGINT', 'SIGTERM'] = ['SIGINT', 'SIGTERM'];
  for (const signal of killSignals) {
    process.on(signal, () => {
      Log.nested(chalk.blue('\nStopping packager...'));
      onStop(projectDir).then(() => {
        Log.nested(chalk.green('Packager stopped.'));
        process.exit();
      });
    });
  }
}
