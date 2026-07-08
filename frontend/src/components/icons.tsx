import type { SVGProps } from 'react'

export type IconName =
  | 'plus'
  | 'undo'
  | 'redo'
  | 'save'
  | 'download'
  | 'upload'
  | 'copy'
  | 'bolt'
  | 'flame'
  | 'chevron-down'
  | 'check'
  | 'x'
  | 'arrow-up'
  | 'arrow-down'
  | 'trash'

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 16, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {name === 'plus' && (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      )}
      {name === 'undo' && (
        <>
          <path d="M9 14 5 10l4-4" />
          <path d="M5 10h11a4 4 0 0 1 0 8h-1" />
        </>
      )}
      {name === 'redo' && (
        <>
          <path d="M15 14l4-4-4-4" />
          <path d="M19 10H8a4 4 0 0 0 0 8h1" />
        </>
      )}
      {name === 'save' && (
        <>
          <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
          <path d="M9 21v-6h6v6" />
          <path d="M9 3v4h6" />
        </>
      )}
      {name === 'download' && (
        <>
          <path d="M12 3v13" />
          <path d="M8 12l4 4 4-4" />
          <path d="M4 20h16" />
        </>
      )}
      {name === 'upload' && (
        <>
          <path d="M12 21V8" />
          <path d="M8 12l4-4 4 4" />
          <path d="M4 4h16" />
        </>
      )}
      {name === 'copy' && (
        <>
          <rect x="8" y="8" width="11" height="11" rx="2" />
          <path d="M5 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </>
      )}
      {name === 'bolt' && (
        <path d="M13 3 4 14h7l-1 7 9-11h-7z" />
      )}
      {name === 'flame' && (
        <path d="M12 2c1 4-2 5-2 8a2 2 0 1 0 4 0c0-1 0-1.5.5-2 1 2 2.5 3 2.5 6a5 5 0 1 1-10 0c0-4 4-6 5-12z" />
      )}
      {name === 'chevron-down' && (
        <path d="M6 9l6 6 6-6" />
      )}
      {name === 'check' && (
        <path d="M5 12l5 5 9-11" />
      )}
      {name === 'x' && (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </>
      )}
      {name === 'arrow-up' && (
        <>
          <path d="M12 19V5" />
          <path d="M8 9l4-4 4 4" />
        </>
      )}
      {name === 'arrow-down' && (
        <>
          <path d="M12 5v14" />
          <path d="M8 15l4 4 4-4" />
        </>
      )}
      {name === 'trash' && (
        <>
          <path d="M4 7h16" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
          <path d="M9 7V4h6v3" />
        </>
      )}
    </svg>
  )
}
