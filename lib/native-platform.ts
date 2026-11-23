export type NativePlatform = 'ios' | 'android' | 'other';
type PlatformNavigator = Pick<Navigator, 'platform' | 'userAgent' | 'maxTouchPoints'> & {userAgentData?: {platform?: string}; standalone?: boolean};

export function detectNativePlatform(nav: PlatformNavigator = navigator): NativePlatform {
  const platform = nav.userAgentData?.platform || nav.platform || '';
  if (/android/i.test(platform + ' ' + nav.userAgent)) return 'android';
  if (/iphone|ipad|ipod|\bios\b/i.test(platform + ' ' + nav.userAgent) || (/mac/i.test(platform) && nav.maxTouchPoints > 1)) return 'ios';
  return 'other';
}
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as PlatformNavigator).standalone === true;
}
export function nativeHaptic() {
  if (typeof window === 'undefined' || document.documentElement.dataset.platform !== 'android') return;
  try { if (localStorage.getItem('wsj:reduce-haptics') !== '1') navigator.vibrate?.(10); } catch { /* optional feedback */ }
}
