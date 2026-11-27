import { desktop } from '@/lib/desktop';

/**
 * Desktop: Electron content protection (Windows/macOS keep the window out of
 * screenshots and screen sharing; Linux has no such API).
 */
const active = new Set<string>();

export async function setScreenProtection(key: string, on: boolean): Promise<void> {
  if (on) active.add(key);
  else active.delete(key);
  await desktop?.setContentProtection(active.size > 0);
}
