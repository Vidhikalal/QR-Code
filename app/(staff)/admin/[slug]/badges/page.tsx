import { Badges } from './badges';

export default async function BadgesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Badges slug={slug} />;
}
