import Image from 'next/image';
import Link from 'next/link';
// import { isValidBookingUrl } from '@/lib/utils/url';

export const metadata = {
  title: 'Contact — Sifter',
  description: 'Get in touch with Sifter. Book a meeting or email us.',
};

export default function ContactPage() {

  return (
    <div className="landing-page min-h-screen flex flex-col relative">
      {/* Logo top-left */}
      <Link href="/" className="absolute left-6 top-6 z-10 block" aria-label="Sifter home">
        <Image
          src="/Sifter_Dark_Logo.png"
          alt="Sifter"
          width={120}
          height={32}
          className="h-8 w-auto"
          priority
        />
      </Link>

      {/* Login, Register links top-right */}
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

      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div>
            <h1 className="text-2xl font-semibold text-[#171717]">Let's talk</h1>
            <p className="mt-2 text-sm text-slate-600">
              Get in touch or schedule a call with our team.
            </p>
          </div>

          <div>
            <a
              href="/book"
              className="inline-flex items-center justify-center w-full sm:w-auto px-8 py-3 text-sm font-medium text-white bg-[#171717] hover:bg-slate-800 rounded transition-colors"
            >
              Schedule a call
            </a>
          </div>
        </div>
      </div>

      {/* Footer: same as landing — email center, location right */}
      <div className="absolute bottom-6 left-6 right-6 flex flex-col gap-3 items-center sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-4 sm:items-end">
        <a
          href="mailto:office@sifterusa.com"
          className="text-xs text-slate-600 hover:underline text-center sm:col-start-2 sm:justify-self-center"
        >
          office@sifterusa.com
        </a>
        <div className="text-xs text-slate-600 shrink-0 sm:col-start-3 sm:text-right">Los Angeles, California</div>
      </div>
    </div>
  );
}