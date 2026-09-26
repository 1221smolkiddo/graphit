export const supportedNodeRange = '>=22.0.0';
export function nodeSupported(version = process.versions.node): boolean {
  return /^(?:v)?\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) && Number(version.replace(/^v/, '').split('.')[0]) >= 22;
}
export function requireSupportedNode(): void {
  if (!nodeSupported()) throw new Error(`Graphit requires Node.js ${supportedNodeRange}; current: ${process.version}. Install a supported Node release and reinstall Graphit.`);
}
