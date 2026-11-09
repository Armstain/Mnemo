// The one function tests/store-completion.test.ts uses, typed here instead of adding @types/react-dom.
declare module 'react-dom/server' {
  export function renderToString(element: import('react').ReactElement): string;
}
