"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { auth } from "@/lib/supabase/client";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setMessage("");

    const { error } = await auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus("error");
      setMessage("Unable to send magic link. Please try again.");
    } else {
      setStatus("success");
      setMessage("Check your email for a magic link to complete registration.");
    }
  };

  const handleGoogleClick = async () => {
    await auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div className="landing-page min-h-screen flex flex-col">
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
          style={{ width: 'auto' }}
          priority
        />
      </Link>

      <nav className="absolute right-6 top-6 z-10 flex items-center gap-4">
        <Link
          href="/login"
          className="text-sm font-medium text-[#171717] hover:opacity-80 transition-opacity"
        >
          Login
        </Link>
        <Link
          href="/contact"
          className="text-sm font-medium text-[#171717] hover:opacity-80 transition-opacity"
        >
          Contact
        </Link>
      </nav>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-[#171717]">
              Create your account
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Automatically detect freight invoice overcharges and save on your
              AP workflow
            </p>
          </div>

          {message && (
            <div
              className={`rounded-md p-3 text-sm ${
                status === "error"
                  ? "bg-red-50 text-red-700"
                  : "bg-green-50 text-green-700"
              }`}
            >
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            <div className="rounded-md shadow-sm -space-y-px">
              <div>
                <label htmlFor="email" className="sr-only">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === "loading"}
                  className="appearance-none rounded-t-md relative block w-full px-3 py-2 border border-slate-300 placeholder-slate-500 text-[#171717] focus:outline-none focus:ring-slate-500 focus:border-slate-500 focus:z-10 sm:text-sm disabled:bg-slate-100 bg-white"
                  placeholder="Email address"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={status === "loading"}
                className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-[#171717] hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 disabled:bg-slate-400 disabled:cursor-not-allowed"
              >
                {status === "loading"
                  ? "Sending magic link..."
                  : "Continue with Email"}
              </button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-[#f0f0ed] text-slate-500">
                  Or continue with
                </span>
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={handleGoogleClick}
                disabled={status === "loading"}
                className="w-full inline-flex justify-center py-2 px-4 border border-slate-300 rounded-md shadow-sm bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                Sign up with Google
              </button>
            </div>
          </form>
          <p className="text-center text-sm text-slate-600">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-[#171717] hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// Docs: https://supabase.com/docs/guides/auth/auth-magic-link
// Docs: https://supabase.com/docs/guides/auth/social-login/auth-google?queryGroups=environment&environment=server
// Docs: https://supabase.com/docs/guides/auth/redirect-urls
