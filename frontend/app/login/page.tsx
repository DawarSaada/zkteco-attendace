import type { Metadata } from 'next';
import { login } from './actions';
import { LoginView } from './LoginView';

export const metadata: Metadata = {
  title: 'Sign In',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return <LoginView error={error} login={login} />;
}
