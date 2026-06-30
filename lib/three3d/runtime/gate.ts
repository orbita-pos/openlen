export interface Capabilities {
  reducedMotion: boolean;
  saveData: boolean;
  deviceMemory: number;
  webgl: boolean;
}

export function shouldEnable3D(c: Capabilities): boolean {
  if (c.reducedMotion) return false;
  if (c.saveData) return false;
  if (c.deviceMemory < 4) return false;
  if (!c.webgl) return false;
  return true;
}
