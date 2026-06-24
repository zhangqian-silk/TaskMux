import { runStorageMigrations } from "../storage/storageSchema.js";
import { createStorageBackup } from "../storage/storageBackup.js";

export function runBackupCommand(rootDir: string): string {
  const backup = createStorageBackup(rootDir);

  return `Created backup ${backup.path}\n`;
}

export function runMigrateCommand(rootDir: string): string {
  const result = runStorageMigrations(rootDir);

  if (!result.changed) {
    return `Storage schema already up to date: ${result.toVersion}\n`;
  }

  if (result.fromVersion === null) {
    return `Initialized storage schema ${result.toVersion}\n`;
  }

  return [
    `Migrated storage schema ${result.fromVersion} -> ${result.toVersion}`,
    result.backup === undefined ? null : `Backup: ${result.backup.path}`
  ]
    .filter((line): line is string => line !== null)
    .join("\n")
    .concat("\n");
}
