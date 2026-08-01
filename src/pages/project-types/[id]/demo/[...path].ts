import type { APIRoute } from 'astro';
import { projectTypeDemoAssets } from '../../../../lib/catalog';
import type { ProjectTypeDemoAsset } from '../../../../lib/catalog';

export function getStaticPaths() {
  return projectTypeDemoAssets().map((asset) => ({
    params: { id: asset.projectTypeId, path: asset.path },
    props: { asset },
  }));
}

export const GET: APIRoute = ({ props }) => {
  const asset = props.asset as ProjectTypeDemoAsset;
  return new Response(asset.bytes, {
    headers: {
      'Content-Type': asset.contentType,
      'Cache-Control': 'public, max-age=3600',
      'Content-Security-Policy': [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        "img-src data:",
        "font-src data:",
        "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'self'",
      ].join('; '),
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
