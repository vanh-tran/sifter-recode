import Image from 'next/image';
import Link from 'next/link';
import HeroClientWrapper from '../components/landing-page/HeroClientWrapper';

export const metadata = {
  title: 'Sifter — Freight Invoice Auditor',
  description: 'Sifter is an AI-powered freight audit service for construction and aggregate companies.',
};

export default function Home() {
  return (
    <main className="landing-page min-h-screen relative overflow-hidden">
      {/* Logo top-left - smaller on mobile to avoid nav overlap */}
      <Link
        href="/"
        className="absolute left-4 top-4 sm:left-6 sm:top-6 z-10 block max-w-[40%] sm:max-w-none"
        aria-label="Sifter home"
      >
        <Image
          src="/Sifter_Dark_Logo.png"
          alt="Sifter"
          width={120}
          height={32}
          className="h-6 w-auto sm:h-8"
          style={{ width: 'auto' }}
          priority
        />
      </Link>

      {/* Login, Register, Contact top-right */}
      <nav className="absolute right-4 top-4 sm:right-6 sm:top-6 z-10 flex items-center gap-2 sm:gap-4">
        <Link
          href="/contact"
          className="text-xs sm:text-sm font-medium text-[#171717] hover:opacity-80 transition-opacity"
        >
          Contact
        </Link>
        <Link
          href="/login"
          className="text-xs sm:text-sm font-medium text-[#171717] hover:opacity-80 transition-opacity"
        >
          Login
        </Link>
        <Link
          href="/register"
          className="text-xs sm:text-sm font-medium text-[#171717] hover:opacity-80 transition-opacity"
        >
          Register
        </Link>
      </nav>

      <div className="flex items-center justify-center w-full h-screen overflow-hidden relative brand-grid-bg pt-14 pb-16 sm:pt-16 sm:pb-20 px-2 sm:px-6">
        <HeroClientWrapper />
      </div>

      {/* Footer: description and location - responsive padding for mobile */}
      <div className="absolute bottom-4 left-4 right-4 sm:bottom-6 sm:left-6 sm:right-6 flex flex-col gap-2 sm:gap-3 sm:flex-row sm:justify-between sm:items-end pointer-events-none">
        <div className="text-xs text-slate-600 sm:max-w-md">
          Sifter is an AI-powered freight audit service for construction
          <br className="hidden sm:block" />
          {' '}and aggregate companies. We automatically review your freight
          <br className="hidden sm:block" />
          {' '}invoices, catch billing errors, and help you recover overcharges
          <br className="hidden sm:block" />
          {' '}— so you stop paying more than you owe.
        </div>
        <div className="text-xs text-slate-600 shrink-0">Los Angeles, California</div>
      </div>
    </main>
  );
}