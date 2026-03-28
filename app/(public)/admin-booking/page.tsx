"use client";

/**
 * TEMP: Admin page to connect Google Calendar and store refresh token + email in Supabase.
 * Remove after tokens are confirmed in booking_oauth_tokens.
 */

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function AdminBookingContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get("success");
  const email = searchParams.get("email");
  const error = searchParams.get("error");

  const connectUrl = "/api/booking/oauth/connect";

  return (
    <div className="landing-page min-h-screen flex flex-col relative">
      <Link href="/" className="absolute left-6 top-6 z-10 block" aria-label="Sifter home">
        <Image
          src="/Sifter_Dark_Logo.png"
          alt="Sifter"
          width={120}
          height={32}
          className="h-8 w-auto"
          style={{ width: 'auto' }}
          priority
        />
      </Link>

      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div>
            <h1 className="text-2xl font-semibold text-[#171717]">Booking OAuth Setup</h1>
            <p className="mt-2 text-sm text-slate-600">
              Connect your Google Calendar to grant read + create events. The refresh token and email will be stored in Supabase.
            </p>
          </div>

          {success === "1" && (
            <div className="rounded-md p-3 text-sm bg-green-50 text-green-700">
              Token saved for {email || "your account"}. Check Supabase <code className="bg-green-100 px-1 rounded">booking_oauth_tokens</code> to confirm.
            </div>
          )}
          {error && (
            <div className="rounded-md p-3 text-sm bg-red-50 text-red-700">
              {error}
            </div>
          )}

          <a
            href={connectUrl}
            className="inline-flex items-center justify-center w-full sm:w-auto px-8 py-3 text-sm font-medium text-white bg-[#171717] hover:bg-slate-800 rounded transition-colors"
          >
            <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Connect with Google Calendar
          </a>

          <p className="text-xs text-slate-500">
            You will be redirected to Google to authorize calendar access. After approval, you will be redirected back and the token will be saved.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AdminBookingPage() {
  return (
    <Suspense fallback={null}>
      <AdminBookingContent />
    </Suspense>
  );
}
