// Line icons for the panel and the settings page: 24-unit strokes in the text colour, hidden from assistive
// technology (the button around each one carries the label). Drawn for this project.
import type { ReactNode, SVGProps } from 'react';

type IconProps = { size?: number; className?: string };

function Svg({ size = 16, className = '', children }: IconProps & { children: ReactNode }) {
  const props: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  return (
    <svg aria-hidden focusable="false" className={`shrink-0 ${className}`} {...props}>
      {children}
    </svg>
  );
}

/** New chat: a pen over an open square. */
export const NewChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    <path d="M17.6 3.6a2 2 0 0 1 2.8 2.8L12 14.8l-3.5 1 1-3.5z" />
  </Svg>
);

/** History: a clock with an arrow turning back. */
export const HistoryIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
    <path d="M3.5 4v4.5H8M12 7.5V12l3 2" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18.8 9.7L21.4 10.1V13.9L18.8 14.3L18.4 15.2L20 17.3L17.3 20L15.2 18.4L14.3 18.8L13.9 21.4H10.1L9.7 18.8L8.8 18.4L6.7 20L4 17.3L5.6 15.2L5.2 14.3L2.6 13.9V10.1L5.2 9.7L5.6 8.8L4 6.7L6.7 4L8.8 5.6L9.7 5.2L10.1 2.6H13.9L14.3 5.2L15.2 5.6L17.3 4L20 6.7L18.4 8.8Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const MicIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
);

export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);

export const StopIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
  </Svg>
);

export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" />
  </Svg>
);

/** Copy: two overlapping sheets. */
export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </Svg>
);

/** Restart from a message: an arrow turning back on itself. */
export const RestartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5" />
    <path d="M4 4v4.5h4.5" />
  </Svg>
);

/** Jump to the latest message. */
export const ArrowDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
);

export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);

/** Show a hidden value: an open eye. */
export const EyeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

/** Hide it again: the eye struck through. */
export const EyeOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
    <path d="M4 4l16 16" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);

/** Work in progress: three quarters of a ring, spun by the caller. */
/** A pinned shortcut: a five-pointed star, filled when pinned. */
export const StarIcon = ({ filled = false, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p}>
    <path
      d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Svg>
);

export const SpinnerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Svg>
);

export const ChevronIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12l5 5 9-10" />
  </Svg>
);

export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Svg>
);

/** A keyboard: Settings → General → Keyboard shortcut. */
export const KeyboardIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
  </Svg>
);

/** The brand's mark (icon-128.png, the toolbar icon). */
/** The browser's Extensions button, as Chrome draws it: a rounded square with bumps on the top and right, a notch on the left. */
export const ExtensionsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 7h3.7a1.8 1.8 0 0 1 3.6 0h3.7a1.5 1.5 0 0 1 1.5 1.5v3.3a1.8 1.8 0 0 1 0 3.6V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19v-2.8a2.4 2.4 0 0 0 0-4.8V8.5A1.5 1.5 0 0 1 5.5 7z" />
  </Svg>
);

/** The Extensions button as Edge draws it: a rounded square with bumps on the top, left and bottom, a notch on the right. */
export const EdgeExtensionsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 6H11A2 2 0 0 1 15 6h2.5A1.5 1.5 0 0 1 19 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5H15a2 2 0 0 1-4 0H8.5A1.5 1.5 0 0 1 7 16.5V14a2 2 0 0 1 0-4V7.5A1.5 1.5 0 0 1 8.5 6z" />
  </Svg>
);

/** Chrome's pin in the Extensions menu: a pushpin. */
export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3h8M9 3v6l-3 4h12l-3-4V3M12 13v8" />
  </Svg>
);

/** Edge's pin in the Extensions menu: the same pushpin, slanted with its head to the top right. */
export const SlantedPinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path transform="rotate(45 12 12)" d="M8 3h8M9 3v6l-3 4h12l-3-4V3M12 13v8" />
  </Svg>
);

export function LogoMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return <img src="/icon-128.png" alt="" width={size} height={size} className={`shrink-0 ${className}`} />;
}

/** The brand's horizontal logo: the mark and "Nanobrowser". */
export function Logo({ height = 28, className = '' }: { height?: number; className?: string }) {
  return (
    <img
      src="/brand/logo-horizontal.png"
      alt="Nanobrowser"
      height={height}
      style={{ height, width: 'auto' }}
      className={className}
    />
  );
}
