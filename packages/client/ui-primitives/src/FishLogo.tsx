import type { IconProps } from './icons/props.ts'

/**
 * Render the brand mark. The artwork is a neutral placeholder (an "L" in a rounded square) until the owner
 * supplies the official Liwa logo; the component keeps its name and props so every brand slot keeps working.
 * @param props.size - width and height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the mark svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 6.5V17H16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
