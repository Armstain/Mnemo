import { useGlobalSearchParams, usePathname } from 'expo-router';

export function useViewingThreadId(): string | undefined {
  const pathname = usePathname();
  const { id } = useGlobalSearchParams<{ id?: string }>();
  return pathname.includes('context') && typeof id === 'string' ? id : undefined;
}
