import { IPointCloudTreeNode } from '../types';

export function getIndexFromName(name: string) {
  return parseInt(name.charAt(name.length - 1), 10) || 0;
}

/**
 * When passed to `[].sort`, sorts the array by level and index: r, r0, r3, r4, r01, r07, r30, ...
 */
export function byLevelAndIndex(a: IPointCloudTreeNode, b: IPointCloudTreeNode) {
  const na = a.name;
  const nb = b.name;
  if (na.length !== nb.length) {
    return na.length - nb.length;
  } else if (na < nb) {
    return -1;
  } else if (na > nb) {
    return 1;
  } else {
    return 0;
  }
}

export function gsToPath(gs: string) {
  return gs.replace('gs://', 'https://storage.googleapis.com/');
}
