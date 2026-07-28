import type { APIRoute } from 'astro';
import { craftbookLogoBytes, craftbooks } from '../../../lib/catalog';
import type { Craftbook } from '../../../lib/catalog';

export function getStaticPaths() {
  return craftbooks()
    .filter((book) => book.logoUrl)
    .map((book) => ({ params: { id: book.id }, props: { book } }));
}

export const GET: APIRoute = ({ props }) => {
  const book = props.book as Craftbook;
  const logo = craftbookLogoBytes(book);

  if (!logo) {
    return new Response(null, { status: 404 });
  }

  return new Response(logo, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
