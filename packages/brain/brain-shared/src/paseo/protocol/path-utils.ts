// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/protocol/src/path-utils.ts；原地改动见包内 NOTICE。
export function stripCwdPrefix(filePath: string, cwd?: string): string {
  if (!cwd || !filePath) {
    return filePath;
  }

  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = filePath.replace(/\\/g, "/");
  const prefix = `${normalizedCwd}/`;

  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }
  if (normalizedPath === normalizedCwd) {
    return ".";
  }
  return filePath;
}
