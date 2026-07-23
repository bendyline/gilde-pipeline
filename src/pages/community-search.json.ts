import type { APIRoute } from 'astro';
import { communityToolsets } from '../lib/catalog';

/**
 * Static endpoint backing the community directory's client-side filter.
 * Emitted once at build time; strings are untrusted third-party content and
 * must only ever be rendered as text (the island uses textContent).
 */
export const GET: APIRoute = () => {
  return new Response(JSON.stringify(communityToolsets()), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
