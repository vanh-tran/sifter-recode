import Image from 'next/image';
import Link from 'next/link';

export default function LandingHeader() {
  return (
    <header className="shrink-0 relative z-20 flex items-center justify-between px-4 py-4 sm:px-6 sm:py-6">
      <Link
        href="/"
        className="block max-w-[40%] sm:max-w-none"
        aria-label="Sifter home"
      >
        <Image
          src="/Sifter_Dark_Logo.png"
          alt="Sifter"
          width={120}
          height={32}
          className="h-6 w-auto sm:h-8"
          priority
        />
      </Link>

      <nav className="flex items-center gap-2 sm:gap-4">
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
    </header>
  );
}
