const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker images use the standalone server (build guide 15.4): DAYBOOK_STANDALONE=true npm run build.
  // cPanel/Passenger (server.cjs) and `npm run start` serve the normal build.
  output: process.env.DAYBOOK_STANDALONE === 'true' ? 'standalone' : undefined,
  poweredByHeader: false,
  // The dev-only "N" badge would sit on top of the sidebar avatar in screenshots.
  devIndicators: false,
  // Local development through an HTTPS tunnel (Slack sign-in needs an https:// redirect URL).
  // Only affects `next dev`; production ignores it.
  allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok.app', '*.trycloudflare.com'],
  // Server-only packages with native or dynamic requires stay out of the bundle.
  serverExternalPackages: [
    'knex',
    'mysql2',
    'exceljs',
    '@slack/web-api',
    'pino',
    'node-cron',
    'web-push',
  ],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
