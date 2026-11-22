export const threadHref = (id: string) => `/(tabs)/context?id=${id}` as const;

export const wrapupHref = (id: string, from?: 'review') => (from ? (`/wrapup?id=${id}&from=${from}` as const) : (`/wrapup?id=${id}` as const));

export const placeHref = (id?: string) => (id ? (`/place?id=${id}` as const) : ('/place' as const));

export const libraryHref = (category?: string) =>
  category ? (`/(tabs)/library?category=${category}` as const) : ('/(tabs)/library' as const);

export const captureHref = (threadId?: string) =>
  threadId ? (`/capture?threadId=${threadId}` as const) : ('/capture' as const);

export const dumpHref = (threadId?: string) =>
  threadId ? (`/dump?threadId=${threadId}` as const) : ('/dump' as const);

export const reviewHref = '/review' as const;

export const remindersCheckHref = '/reminders-check' as const;

export const settingsHref = '/modal' as const;

export const helpHref = '/help' as const;

export const privacyHref = '/privacy' as const;

export const onboardingHref = '/onboarding' as const;

export const welcomeHref = '/welcome' as const;
