import type { ComponentPropsWithoutRef } from "react"

type HomeLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  href?: "/" | `/#${string}`
}

/** Homepage experiments select HTML on the Node server. Next's exported root
 * Flight payload always contains control, so return links need a document load. */
export function HomeLink({ href = "/", ...props }: HomeLinkProps) {
  return <a {...props} href={href} />
}
