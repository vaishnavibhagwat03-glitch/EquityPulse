/**
 * The site's public origin, for metadata, robots.txt and the sitemap. Set
 * NEXT_PUBLIC_SITE_URL in deployment; on Vercel the deployment's own URL is
 * used when it is not set.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000')
).replace(/\/$/, '');
