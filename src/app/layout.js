import { Figtree, Schibsted_Grotesk } from 'next/font/google';
import LaunchSplash from '@/components/LaunchSplash';
import ServiceWorker from '@/components/ServiceWorker';
import { LAUNCH_SCRIPT } from '@/components/launchScript';
import './globals.css';

const heading = Schibsted_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-heading',
  display: 'swap',
});

const body = Figtree({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata = {
  title: { default: 'Daybook', template: '%s · Daybook' },
  description: 'Check in, log your day and submit your daily report.',
  applicationName: 'Daybook',
  icons: {
    icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico' }],
    apple: '/icons/icon-192.png',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#151833',
};

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: the launch script sets data-launch on <html> before React loads.
    <html lang="en" className={`${heading.variable} ${body.variable}`} suppressHydrationWarning>
      <body>
        {/* Runs while the HTML is parsed, before the splash below can paint (see launchScript.js). */}
        <script dangerouslySetInnerHTML={{ __html: LAUNCH_SCRIPT }} />
        <LaunchSplash />
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
