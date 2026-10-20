import { Teams } from './teams';

export default async function TeamsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Teams slug={slug} />;
}
