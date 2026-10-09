import { Register } from './register';

export default async function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Register slug={slug} />;
}
