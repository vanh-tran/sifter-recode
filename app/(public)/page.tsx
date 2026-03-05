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
      {/* Logo top-left */}
      <Link
        href="/"
        className="absolute left-6 top-6 z-10 block"
        aria-label="Sifter home"
      >
        <Image
          src="/Sifter_Dark_Logo.png"
          alt="Sifter"
          width={120}
          height={32}
          className="h-8 w-auto"
          priority
        />
      </Link>

      {/* Login, Register, Contact top-right */}
      <nav className="absolute right-6 top-6 z-10 flex items-center gap-4">
        <Link
          href="/contact"
          className="text-sm font-medium text-[#171717] hover:opacity-80 transition-opacity"
        >
          Contact
        </Link>
        <Link
          href="/login"
          className="text-sm font-medium text-[#171717] hover:opacity-80 transition-opacity"
        >
          Login
        </Link>
        <Link
          href="/register"
          className="text-sm font-medium text-[#171717] hover:opacity-80 transition-opacity"
        >
          Register
        </Link>
      </nav>

      <div className="flex items-center justify-center w-full h-screen overflow-visible relative brand-grid-bg">
        <HeroClientWrapper />
      </div>

      {/* Footer: description and location */}
      <div className="absolute bottom-6 left-6 right-6 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-end">
        <div className="text-xs text-slate-600 sm:max-w-md pointer-events-none">
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