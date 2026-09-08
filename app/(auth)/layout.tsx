import { Logo } from '@/components/layout/Logo'

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="mx-auto w-full max-w-6xl px-5 py-5">
        <Logo />
      </header>
      <main
        id="main"
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 pb-16"
      >
        {children}
      </main>
    </div>
  )
}
