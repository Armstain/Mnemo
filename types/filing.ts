export interface ThreadCandidate {
  id: string;
  title: string;
  category: string;
  nextStep?: string;
  latest?: string;
  focused?: boolean;
  /** e.g. "spent (EUR, sum)". */
  tracks?: string[];
  idleDays?: number;
}

export interface CaptureContext {
  candidates: ThreadCandidate[];
  tracks?: string[];
}

export interface ThreadMatch {
  match: 'existing' | 'new';
  threadId: string;
  confidence: number;
  reason: string;
}
