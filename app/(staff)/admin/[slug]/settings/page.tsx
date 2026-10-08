import { Settings } from './settings';

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Settings slug={slug} />;
}
