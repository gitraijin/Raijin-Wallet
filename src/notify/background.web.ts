/** No background tasks on the web / desktop: notifications work while the app is open. */
export const PAYMENT_CHECK_TASK = 'raijin-payment-check';

export async function setBackgroundChecks(_enabled: boolean): Promise<void> {}
