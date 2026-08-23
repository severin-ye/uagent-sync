/** Text-only file operations required by workspace artifact use cases. */
export interface FileSystem {
  readText(filePath: string): string;
  writeText(filePath: string, content: string): void;
}
