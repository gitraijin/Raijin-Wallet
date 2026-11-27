import { router } from 'expo-router';

/**
 * Clears the stack and goes through the entry gate (`/`), which redirects to
 * home, PIN setup or onboarding depending on the wallet state.
 */
export function goHome(): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace('/');
}
