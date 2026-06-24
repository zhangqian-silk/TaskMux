import { runStorageMigrations } from "../storage/storageSchema.js";

export function runMigrateCommand(rootDir: string): string {
  const result = runStorageMigrations(rootDir);

  if (!result.changed) {
    return `Storage schema already up to date: ${result.toVersion}\n`;
  }

  if (result.fromVersion === null) {
    return `Initialized storage schema ${result.toVersion}\n`;
  }

  return `Migrated storage schema ${result.fromVersion} -> ${result.toVersion}\n`;
}
