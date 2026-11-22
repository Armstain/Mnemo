import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';

import { clearErrors, problemReport } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { placeReport } from '@/lib/geofence';

export function useProblemReport() {
  const [reportCopied, setReportCopied] = useState(false);
  const [logCleared, setLogCleared] = useState(false);
  return {
    reportTitle: reportCopied ? 'Problem report copied' : 'Copy problem report',
    clearTitle: logCleared ? 'Error log cleared' : 'Clear error log',
    copyReport: async () => {
      const places = await placeReport().catch(() => 'Places: unreadable');
      await Clipboard.setStringAsync(await problemReport([places]));
      haptic.success();
      setReportCopied(true);
      setLogCleared(false);
    },
    clearLog: async () => {
      await clearErrors();
      haptic.success();
      setLogCleared(true);
      setReportCopied(false);
    },
  };
}
