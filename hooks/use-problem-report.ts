import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';

import { clearErrors, problemReport } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { placeReport } from '@/lib/geofence';
import { voiceReport } from '@/lib/voice-log';

export function useProblemReport() {
  const [reportCopied, setReportCopied] = useState(false);
  const [logCleared, setLogCleared] = useState(false);
  return {
    reportTitle: reportCopied ? 'Problem report copied' : 'Copy problem report',
    clearTitle: logCleared ? 'Error log cleared' : 'Clear error log',
    copyReport: async () => {
      const [places, voice] = await Promise.all([placeReport().catch(() => 'Places: unreadable'), voiceReport()]);
      await Clipboard.setStringAsync(await problemReport([places, voice]));
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
