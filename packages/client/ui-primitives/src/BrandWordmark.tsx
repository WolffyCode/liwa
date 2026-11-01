import type { IconProps } from './icons/props.ts'

/** Display options for the official brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading whale mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the full brand wordmark. The artwork is a neutral placeholder (the mark plus a monoline "Liwa") until
 * the owner supplies the official Liwa wordmark; sizes and the mark switch keep their contract.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const width = includeMark ? 182 : 156
  return (
    <svg
      width={(size * width) / 24}
      height={size}
      className={className}
      viewBox={includeMark ? '0 0 182 24' : '26 0 156 24'}
      fill="none"
      aria-hidden="true"
    >
      {includeMark && (
        <>
          <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 6.5V17H16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M31 4V20H41" />
        <path d="M47 10V20" />
        <path d="M53 10L57 20L61 12L65 20L69 10" />
        <circle cx="79" cy="15" r="5" />
        <path d="M84 10V20" />
      </g>
      <circle cx="47" cy="5.5" r="1.4" fill="currentColor" />
    </svg>
  )
}
