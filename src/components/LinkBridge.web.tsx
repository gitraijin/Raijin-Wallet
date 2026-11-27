import { router } from 'expo-router';
import { useEffect } from 'react';

import { desktop } from '@/lib/desktop';
import { classifyLink } from '@/lib/links';

/** Desktop: lightning:/bitcoin:/cashu: links from the browser or other apps open the matching screen. */
export function LinkBridge() {
  useEffect(() => {
    if (!desktop) return;
    const open = (url: string | null) => {
      const route = url ? classifyLink(url) : null;
      if (route) router.push(route);
    };
    desktop.takePendingLink().then(open, () => {});
    return desktop.onOpenLink(open);
  }, []);
  return null;
}
