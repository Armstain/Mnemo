import { Redirect } from 'expo-router';

/**
 * Legacy route — redirects to the new unified capture screen.
 */
export default function ManualRedirect() {
  return <Redirect href="/capture" />;
}
