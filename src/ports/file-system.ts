/** Text-only file operations required by workspace artifact use cases. */
export interface FileSystem {
  exists(filePath: string): boolean;
  joinPath(...parts: string[]): string;
  readText(filePath: string): string;
  writeText(filePath: string, content: string): void;
}
