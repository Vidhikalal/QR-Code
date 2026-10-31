import { ImportCsv } from './import-csv';

export default async function ToolsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ImportCsv slug={slug} />;
}
