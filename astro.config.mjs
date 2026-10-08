import { defineConfig } from 'astro/config';

// gezelgilde.com is a redirect shell now: every page forwards to its home on
// gezel.com. No sitemap — listing redirects would only ask crawlers to fetch
// pages they should drop. `@astrojs/sitemap` stays in package.json until the
// lockfile is next refreshed.
export default defineConfig({
  site: 'https://gezelgilde.com',
});
