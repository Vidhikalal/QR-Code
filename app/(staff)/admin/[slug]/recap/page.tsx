import { Recap } from './recap';

export default async function RecapPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Recap slug={slug} />;
}
