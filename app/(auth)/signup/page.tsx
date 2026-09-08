import { redirect } from 'next/navigation'
import { signUpAction } from '../actions'
import { getCurrentUser } from '@/lib/auth'
import { AuthForm } from '@/components/layout/AuthForm'
import { safeInternalPath } from '@/lib/utils/url'

export const metadata = { title: 'Create your account' }

export default async function SignUpPage({ searchParams }: PageProps<'/signup'>) {
  if (await getCurrentUser()) redirect('/home')

  const params = await searchParams
  const next = safeInternalPath(params.next, '/onboarding')

  return <AuthForm mode="signup" action={signUpAction} next={next} />
}
