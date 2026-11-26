'use client'

import { unstable_rethrow } from 'next/navigation'
import { useActionState, useEffect, useRef, useTransition, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loginAction } from '@/features/admin/actions'
import { LOGIN_NETWORK_ERROR, LOGIN_PENDING_MESSAGE, loginErrorMessage } from '@/features/admin/messages'
import type { LoginError, LoginState } from '@/features/admin/types'

const INPUT_ID = 'admin-password'
const ERROR_ID = 'admin-password-error'

// What the form shows: the action's own state, or `network` when the action itself rejected.
type FormState = LoginState | { status: 'network' }

const IDLE: FormState = { status: 'idle' }

// Only these two are about what was typed, so only they mark the field and move focus to it (Gate 2 spec). A lock,
// a closed admin area or a database failure is not the password's fault.
const isFieldError = (error: LoginError): boolean => error === 'invalid' || error === 'wrong-password'

// Gate 2 decision 6: a business refusal comes back as a LoginState; only a network failure, a 500 or a stale action
// id after a deploy rejects. Caught here, it shows under the field instead of an error page that loses what was
// typed. A right password redirects, which Next.js signals by rejecting too: unstable_rethrow lets that through.
const submitLogin = async (previous: FormState, formData: FormData): Promise<FormState> => {
  try {
    return await loginAction(previous.status === 'network' ? IDLE : previous, formData)
  } catch (error) {
    unstable_rethrow(error)
    return { status: 'network' }
  }
}

const messageOf = (state: FormState): string | undefined => {
  if (state.status === 'network') return LOGIN_NETWORK_ERROR
  if (state.status === 'error') return loginErrorMessage(state.error)
  return undefined
}

// US-12 on /admin/login. noValidate (Gate 2 decision 2): an empty field reaches the server and comes back as
// `invalid`, shown in the alert, instead of the browser's bubble.
export const LoginForm = () => {
  const [state, dispatch, isPending] = useActionState(submitLogin, IDLE)
  const [, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  // A new submit clears the previous answer: while waiting only "Đang đăng nhập…" is shown.
  const fieldError = !isPending && state.status === 'error' && isFieldError(state.error)
  const message = isPending ? undefined : messageOf(state)

  useEffect(() => {
    if (fieldError) inputRef.current?.focus()
  }, [state, fieldError])

  // Dispatched by hand rather than through the form's action: React resets a form after its action, and the field
  // must keep what was typed after an error (Gate 2 spec). While waiting a second submit is dropped: a second wrong
  // password would be counted too. The action prop stays for its javascript: URL before hydration, so a submit then
  // never sends the password anywhere.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPending) return
    const formData = new FormData(event.currentTarget)
    startTransition(() => dispatch(formData))
  }

  return (
    <>
      <form noValidate action={dispatch} onSubmit={submit} className="flex max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label htmlFor={INPUT_ID} className="text-sm font-medium">
            Mật khẩu
          </label>
          <Input
            ref={inputRef}
            id={INPUT_ID}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-describedby={ERROR_ID}
            aria-invalid={fieldError || undefined}
            className="aria-invalid:border-danger"
          />
          {/* In the DOM from the first render, empty, so a screen reader announces what appears. */}
          <div role="alert" id={ERROR_ID}>
            {message !== undefined && (
              <p className="flex items-center gap-2 text-sm font-medium text-danger before:size-2 before:shrink-0 before:bg-danger">
                {message}
              </p>
            )}
          </div>
        </div>
        {/* The label never changes while waiting, so the button keeps its accessible name. */}
        <Button type="submit" aria-disabled={isPending || undefined} className="w-full md:w-auto md:self-start">
          Đăng nhập
        </Button>
      </form>
      <div role="status">
        {isPending && <p className="flex min-h-11 items-center text-muted-foreground">{LOGIN_PENDING_MESSAGE}</p>}
      </div>
    </>
  )
}
