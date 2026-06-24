export type StorageMigration = {
  fromVersion: number;
  toVersion: number;
  run(rootDir: string): void;
};

export const migrateStorageV0ToV1: StorageMigration = {
  fromVersion: 0,
  toVersion: 1,
  run() {
    // Version 1 introduces the global storage schema manifest.
  }
};
