import Link from 'next/link'

export type BreadcrumbItem = { href: string; label: string }

export type BreadcrumbProps = { crumbs: BreadcrumbItem[] }

// Link colour on background (4.79 / 5.29:1); min-h-11 keeps each link a 44 px target (design-system §2).
const CRUMB_LINK_CLASS = 'inline-flex min-h-11 items-center text-link underline underline-offset-4 hover:decoration-2'

const Separator = () => (
  <span aria-hidden="true" className="text-muted-foreground">
    /
  </span>
)

// Shared by the product page and the blog post page. Callers stop the trail at the parent: the page's h1 names the
// current page, so it is never repeated here.
export const Breadcrumb = ({ crumbs }: BreadcrumbProps) => (
  <nav aria-label="Đường dẫn">
    <ol className="flex flex-wrap items-center gap-x-2 text-sm">
      {crumbs.map((crumb, index) => (
        <li key={crumb.href} className="flex items-center gap-x-2">
          {index > 0 ? <Separator /> : null}
          <Link href={crumb.href} className={CRUMB_LINK_CLASS}>
            {crumb.label}
          </Link>
        </li>
      ))}
    </ol>
  </nav>
)
