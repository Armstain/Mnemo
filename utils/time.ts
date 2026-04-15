import { formatDistanceToNowStrict } from 'date-fns';


export function formatCompactDistance(date: Date | string | number): string {
  const distance = formatDistanceToNowStrict(new Date(date));

  return distance
    .replace(' seconds', 's')
    .replace(' second', 's')
    .replace(' minutes', 'm')
    .replace(' minute', 'm')
    .replace(' hours', 'h')
    .replace(' hour', 'h')
    .replace(' days', 'd')
    .replace(' day', 'd')
    .replace(' months', 'mo')
    .replace(' month', 'mo')
    .replace(' years', 'y')
    .replace(' year', 'y');
}
