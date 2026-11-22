import { router } from 'expo-router';

import { haptic } from '@/lib/haptics';
import { threadHref } from '@/lib/routes';

export const openThread = (id: string) => router.push(threadHref(id));

export const swapToThread = (id: string) => router.replace(threadHref(id));

export function openSaved(saved: { threadId: string }) {
  haptic.success();
  swapToThread(saved.threadId);
}
