'use client';

import { Navbar } from '@/components/home/navbar';
import { SimpleFooter } from '@/components/home/simple-footer';
import { usePathname } from 'next/navigation';

export default function HomeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const isHomePage = pathname === '/' || pathname === '/variant-2';

  return (
    <div className="w-full min-h-dvh relative">
      {/* Home / Variant-2: fixed overlay navbar (sticky hero). Other pages: sticky top with blur. */}
      <div className={isHomePage ? 'fixed top-0 left-0 right-0 z-50' : 'sticky top-0 z-50 bg-background/80 backdrop-blur-md'}>
        <Navbar isAbsolute={isHomePage} />
      </div>
      {children}
      <SimpleFooter />
    </div>
  );
}
