export interface BundleDigest {
  manifest: string;
  digest: string;
}
export function unsignedMachOHash(buffer: Buffer): string | null;
export function bundleDigest(app: string): Promise<BundleDigest>;
export function contentDigest(app: string): Promise<BundleDigest>;
export function removeEmptyDirectories(directory: string): string[];
