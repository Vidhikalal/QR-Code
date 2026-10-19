import { Info } from './info';

export default async function InfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Info slug={slug} />;
}
