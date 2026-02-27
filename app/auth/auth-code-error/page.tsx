import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <div className="landing-page min-h-screen flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-[#171717]">
            Authentication Error
          </h1>
          <p className="text-sm text-slate-600">
            Something went wrong while signing you in. The link may have expired
            or already been used.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Link
            href="/login"
            className="w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-[#171717] hover:bg-slate-800 transition-colors"
          >
            Try signing in again
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-slate-600 hover:text-[#171717] transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
