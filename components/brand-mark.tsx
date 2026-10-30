import Image from 'next/image';
import logo from '@/components/logo.png';
import { cn } from '@/lib/utils';

export function BrandMark({ name = 'Datathon', size = 'default', className }: {
  name?: string;
  size?: 'default' | 'large';
  className?: string;
}) {
  const pixels = size === 'large' ? 30 : 28;
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5 font-mono text-base font-semibold tracking-normal text-[#E8F2FF]', className)}>
      <Image src={logo} alt="" width={pixels} height={pixels} unoptimized className="shrink-0" />
      <span className="truncate">{name}</span>
    </div>
  );
}
