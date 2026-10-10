import { Screen } from './screen';

export default async function ScreenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Screen slug={slug} />;
}
