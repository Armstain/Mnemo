export function generateId(prefix?: string): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
  return prefix ? `${prefix}-${id}` : id;
}
