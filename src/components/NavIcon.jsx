// Sidebar icons. The design canvas draws its own line icons (close to lucide, but not the same
// shapes), so they are traced here from the artboards on lucide's 24-unit grid and drawn the way
// lucide draws (currentColor, round caps and joins). Keys are the icon names used in
// src/config/navigation.js; an unknown name (a nav item added later) shows a plain circle until
// its shape is added here.
import { Circle } from 'lucide-react';

const SHAPES = {
  // Today
  House: {
    width: 2,
    body: <path d="M4.07 11.19 12.96 3.9l8.89 7.29v11.58h-6.67V16.1h-4.44v6.67H4.07Z" />,
  },
  // My log
  FileText: {
    body: (
      <>
        <rect x="5.22" y="3.55" width="15.55" height="19.02" rx="2" />
        <path d="M9.6 9.23h6.5M9.6 13.68h6.5M9.6 18.13h4.1" />
      </>
    ),
  },
  // Projects
  Folder: {
    body: (
      <path d="M21 20a2 2 0 0 0 2-2V8.67a2 2 0 0 0-2-2h-9.8L9.5 4.45H5a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2Z" />
    ),
  },
  // Team
  Users: {
    width: 2,
    body: (
      <>
        <circle cx="9.6" cy="7.95" r="3.8" />
        <path d="M2.43 21.5a7.21 7.6 0 0 1 14.42 0M16.6 4.25a3.85 3.85 0 1 1 0 7.5M19.3 15.4c2.3.8 4.2 3 4.2 6.1" />
      </>
    ),
  },
  // Attendance
  CalendarDays: {
    body: (
      <>
        <rect x="3" y="4.22" width="20" height="17.78" rx="2" />
        <path d="M3 9.78h20M8.5 2.2v4M17.4 2.2v4" />
      </>
    ),
  },
  // People
  SquareUser: {
    body: (
      <>
        <rect x="3" y="2.89" width="20" height="17.78" rx="2" />
        <circle cx="10.2" cy="9.7" r="2.2" />
        <path d="M7.4 16.8a2.8 3 0 0 1 5.6 0M15.45 8.45h4M15.45 12.89h4" />
      </>
    ),
  },
  // Roles
  Shield: {
    body: (
      <path d="M20.77 11c0 5-3.47 8.4-7.42 10.15a.9.9 0 0 1-.7 0C8.7 19.4 5.22 16 5.22 11V5.6q0-.7.58-1l6.4-3.2q.75-.4 1.5 0l6.5 3.2q.57.3.57 1Z" />
    ),
  },
  // Settings
  SlidersHorizontal: {
    width: 2,
    body: (
      <>
        <path d="M3.85 7h11.4M19.55 7h2.2M3.85 18.1h4.75M12.85 18.1h8.9" />
        <circle cx="17.4" cy="7" r="2.12" />
        <circle cx="10.72" cy="18.1" r="2.12" />
      </>
    ),
  },
  // Overview
  LayoutDashboard: {
    width: 2,
    body: (
      <path d="M4.07 3.9h7.83v7.77H4.07ZM4.07 13.87h7.83v7.81H4.07ZM14.1 3.9h7.75v4.46H14.1ZM14.1 10.56h7.75v11.12H14.1Z" />
    ),
  },
  // Screen time (not on the canvas: drawn to match the others, on the same 3..23 box as the
  // calendar and folder, with the stand's base as wide as the file icon's lines)
  Monitor: {
    body: (
      <>
        <rect x="3" y="3.9" width="20" height="13.55" rx="2" />
        <path d="M13 17.45v3.75M8.75 21.2h8.5" />
      </>
    ),
  },
  // Requests
  Inbox: {
    body: (
      <>
        <path d="M4.07 12 6.3 5.6q.25-.71 1-.71h11.4q.75 0 1 .71L21.85 12v5.95a2.5 2.5 0 0 1-2.5 2.5H6.57a2.5 2.5 0 0 1-2.5-2.5Z" />
        <path d="M4.07 12H8.6l1.6 3.46h5.5L17.3 12h4.55" />
      </>
    ),
  },
};

/** @param {{ name: string, size?: number, className?: string }} props */
export function NavIcon({ name, size = 18, className }) {
  const shape = SHAPES[name];
  if (!shape)
    return <Circle size={size} strokeWidth={1.8} className={className} aria-hidden="true" />;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={shape.width ?? 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="translate(-.22 -.22)">{shape.body}</g>
    </svg>
  );
}
