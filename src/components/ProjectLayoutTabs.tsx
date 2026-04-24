'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { label: 'Dashboard', segment: 'dashboard' },
  { label: 'Chat', segment: 'chat' },
  { label: 'Pipeline', segment: 'pipeline' },
  { label: 'Sources', segment: 'sources' },
] as const;

export default function ProjectLayoutTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-0.5 -mb-px">
      {TABS.map(({ label, segment }) => {
        const href = `/project/${projectId}/${segment}`;
        const isActive = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={segment}
            href={href}
            className={`px-3 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              isActive
                ? 'border-[#1a1a1a] text-[#1a1a1a]'
                : 'border-transparent text-[#999] hover:text-[#666] hover:border-[#ddd]'
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
