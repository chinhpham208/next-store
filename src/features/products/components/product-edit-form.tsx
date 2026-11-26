'use client'

import Link from 'next/link'
import { unstable_rethrow } from 'next/navigation'
import { useActionState, useEffect, useTransition, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input, INPUT_CLASS } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import { updateProductAction } from '@/features/products/actions'
import {
  PRODUCT_EDIT_HINTS,
  PRODUCT_EDIT_NETWORK_ERROR,
  PRODUCT_EDIT_SAVING,
  productEditErrorMessage,
  productEditStateMessage,
} from '@/features/products/edit-messages'
import type { AdminProductForm, ProductEditField, ProductEditFieldErrors, ProductEditState } from '@/features/products/types'

// The admin edit form of US-13 (plan M5 Task 10, design-system "Component M5"). It lives with its action in
// features/products, not in features/admin (audit PR #107 M-2, ticket NS-125): from there it would import the
// products index, which pulls 'use cache' queries and the admin reads into the client graph, and products → admin
// → products is a cycle. The page passes the product in; the form imports only the action reference, its text and
// its types.

const LOGIN_PATH = '/admin/login'
// A path under /admin that no route serves (a `_` folder is private in the App Router). Without a session the proxy
// answers it with a 307 to /admin/login; with one it reaches Next.js and gets a plain 404. Nothing is read.
const SESSION_PROBE_PATH = '/admin/_session-probe'

// DOM order, which is also the order focus looks for the first error in (Gate 2 spec).
const FIELD_ORDER: readonly ProductEditField[] = ['name', 'price', 'stock', 'description']

const LABELS: Record<ProductEditField, string> = { name: 'Tên', price: 'Giá (₫)', stock: 'Tồn kho', description: 'Mô tả' }

const FIELD_CLASS = 'aria-invalid:border-danger'
const AMOUNT_CLASS = cn('font-mono', FIELD_CLASS)
const MESSAGE_LINK_CLASS = 'underline underline-offset-4 hover:decoration-2'
const SHOP_LINK_CLASS = 'inline-flex min-h-11 items-center text-link underline underline-offset-4 hover:decoration-2'

const fieldId = (field: ProductEditField): string => `product-${field}`

/** What the form shows: the action's answer, or `network` when the action itself rejected with the session there. */
export type ProductEditFormState = {
  result: ProductEditState | { status: 'network' }
  // updated_at of the last save, or of the load: sent as expectedUpdatedAt, so saving twice in a row is no conflict.
  updatedAt: string
}

const IDLE: ProductEditState = { status: 'idle' }

/** The first field with an error, in DOM order. */
export const firstErrorField = (errors: ProductEditFieldErrors): ProductEditField | undefined =>
  FIELD_ORDER.find((field) => errors[field] !== undefined)

/**
 * After the action rejected: is the session gone? The proxy answers an action POST without a session with an
 * empty 401 before the action runs (audit PR #106 M1), and Next.js rejects with nothing that says so; a network
 * failure rejects the same way. So ask the proxy directly. A redirect (or a 401) means no session; any other answer
 * means the session is there and the failure was something else. Offline, the probe fails too: not "ended".
 */
export const sessionEnded = async (): Promise<boolean> => {
  try {
    const response = await fetch(SESSION_PROBE_PATH, { method: 'HEAD', redirect: 'manual', cache: 'no-store' })
    return response.type === 'opaqueredirect' || response.status === 401
  } catch {
    return false
  }
}

// Gate 2 decision 6: a refusal comes back as a ProductEditState; only a 401 from the proxy, a network failure, a 500
// or a stale action id after a deploy rejects. Caught here, so the form keeps what was typed instead of falling into
// error.tsx. Session gone → a full load of /admin/login (the 401 has already cleared the cookie), as submitLogout.
export const submitProductEdit = async (
  previous: ProductEditFormState,
  formData: FormData,
): Promise<ProductEditFormState> => {
  try {
    const result = await updateProductAction(previous.result.status === 'network' ? IDLE : previous.result, formData)
    return { result, updatedAt: result.status === 'saved' ? result.updatedAt : previous.updatedAt }
  } catch (error) {
    unstable_rethrow(error)
    if (await sessionEnded()) {
      window.location.assign(LOGIN_PATH)
      return { result: IDLE, updatedAt: previous.updatedAt }
    }
    return { result: { status: 'network' }, updatedAt: previous.updatedAt }
  }
}

const generalMessage = (result: ProductEditFormState['result'], slug: string): ReactNode => {
  if (result.status === 'network') return PRODUCT_EDIT_NETWORK_ERROR
  const message = productEditStateMessage(result, slug)
  if (message === null) return null
  return (
    <>
      {message.before}
      <Link href={message.link.href} className={MESSAGE_LINK_CLASS}>
        {message.link.label}
      </Link>
      {message.after}
    </>
  )
}

type FieldProps = {
  field: ProductEditField
  error: string | undefined
  children: (props: { id: string; name: ProductEditField; 'aria-invalid'?: true; 'aria-describedby': string }) => ReactNode
}

// Label → hint → field → error (Gate 2 decision 3). aria-describedby is the hint, then the error when there is one.
const Field = ({ field, error, children }: FieldProps) => {
  const id = fieldId(field)
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {LABELS[field]}
      </label>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {PRODUCT_EDIT_HINTS[field]}
      </p>
      {children({
        id,
        name: field,
        'aria-invalid': error === undefined ? undefined : true,
        'aria-describedby': error === undefined ? `${id}-hint` : `${id}-hint ${id}-error`,
      })}
      {error !== undefined && (
        <p
          id={`${id}-error`}
          className="flex items-center gap-2 text-sm font-medium text-danger before:size-2 before:shrink-0 before:bg-danger"
        >
          {error}
        </p>
      )}
    </div>
  )
}

export type ProductEditFormViewProps = {
  product: AdminProductForm
  state: ProductEditFormState
  isPending: boolean
  action?: (formData: FormData) => void
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
}

/** The form for a given state, without hooks: what ProductEditForm renders. */
export const ProductEditFormView = ({ product, state, isPending, action, onSubmit }: ProductEditFormViewProps) => {
  // A new submit clears the previous answer: while waiting only "Đang lưu…" is shown.
  const result = isPending ? IDLE : state.result
  const fieldErrors = result.status === 'invalid' ? result.fieldErrors : {}
  const errorOf = (field: ProductEditField): string | undefined => {
    const error = fieldErrors[field]
    return error === undefined ? undefined : productEditErrorMessage(field, error)
  }
  const message = generalMessage(result, product.slug)

  // Uncontrolled fields (defaultValue): what was typed stays after a refused save. No type="number" (it swallows
  // "-" and "e") and no maxLength (it cuts silently): the server answers with words.
  return (
    <form noValidate action={action} onSubmit={onSubmit} className="flex max-w-xl flex-col gap-6">
      <input type="hidden" name="slug" value={product.slug} />
      <input type="hidden" name="expectedUpdatedAt" value={state.updatedAt} />
      <Field field="name" error={errorOf('name')}>
        {(props) => <Input {...props} type="text" defaultValue={product.name} className={FIELD_CLASS} />}
      </Field>
      <div className="grid gap-6 md:grid-cols-2">
        <Field field="price" error={errorOf('price')}>
          {(props) => (
            <Input
              {...props}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={String(product.price)}
              className={AMOUNT_CLASS}
            />
          )}
        </Field>
        <Field field="stock" error={errorOf('stock')}>
          {(props) => (
            <Input
              {...props}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={String(product.stock)}
              className={AMOUNT_CLASS}
            />
          )}
        </Field>
      </div>
      <Field field="description" error={errorOf('description')}>
        {(props) => (
          <textarea
            {...props}
            rows={4}
            defaultValue={product.description}
            className={cn(INPUT_CLASS, 'min-h-32 resize-y py-3', FIELD_CLASS)}
          />
        )}
      </Field>
      {/* The label never changes while waiting, so the button keeps its accessible name. */}
      <Button type="submit" aria-disabled={isPending || undefined} className="w-full md:w-auto md:self-start">
        Lưu
      </Button>
      {/* Both regions are in the DOM from the first render, empty, so a screen reader announces what appears. */}
      <div className="-mt-2 flex flex-col">
        <div role="status">
          {isPending && <p className="flex min-h-11 items-center text-muted-foreground">{PRODUCT_EDIT_SAVING}</p>}
          {result.status === 'saved' && (
            <div className="flex flex-wrap items-center gap-x-4">
              <p className="flex min-h-11 items-center gap-2 font-medium before:size-2 before:shrink-0 before:bg-foreground">
                Đã lưu.
              </p>
              <Link href={`/products/${product.slug}`} className={SHOP_LINK_CLASS}>
                Xem trên cửa hàng
              </Link>
            </div>
          )}
        </div>
        <div role="alert">
          {message !== null && (
            <p className="flex min-h-11 items-center gap-2 font-medium text-danger before:size-2 before:shrink-0 before:bg-danger">
              <span>{message}</span>
            </p>
          )}
        </div>
      </div>
    </form>
  )
}

export type ProductEditFormProps = { product: AdminProductForm }

export const ProductEditForm = ({ product }: ProductEditFormProps) => {
  const [state, dispatch, isPending] = useActionState(submitProductEdit, { result: IDLE, updatedAt: product.updatedAt })
  const [, startTransition] = useTransition()

  // Field errors: focus moves to the first field in error (Gate 2 spec); its description reads the error. No summary
  // is added to the alert.
  useEffect(() => {
    if (isPending || state.result.status !== 'invalid') return
    const field = firstErrorField(state.result.fieldErrors)
    if (field !== undefined) document.getElementById(fieldId(field))?.focus()
  }, [state, isPending])

  // Dispatched by hand rather than through the form's action: React resets a form after its action, and the fields
  // must keep what was typed after a refusal. While waiting a second submit is dropped: it would be a conflict. The
  // action prop stays for its javascript: URL before hydration, so a submit then goes nowhere.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPending) return
    const formData = new FormData(event.currentTarget)
    startTransition(() => dispatch(formData))
  }

  return <ProductEditFormView product={product} state={state} isPending={isPending} action={dispatch} onSubmit={submit} />
}
