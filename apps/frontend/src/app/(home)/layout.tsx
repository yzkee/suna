'use client';

import { Navbar } from '@/components/home/navbar';
import { SimpleFooter } from '@/components/home/simple-footer';

export default function HomeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="w-full min-h-dvh relative">
      <div className="fixed top-0 left-0 right-0 z-50">
        <Navbar isAbsolute />
      </div>
      {children}
      <SimpleFooter />
    </div>
  );
}
