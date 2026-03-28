'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { CheckCircle, Upload, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  orgName: string;
}

type Step = 1 | 2 | 3 | 4 | 5;

interface Mailbox {
  id: string;
  provider: string;
  email: string;
  status: string;
}

function StepIndicator({ current, total }: { current: Step; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => i + 1).map((s) => (
        <div
          key={s}
          className={cn(
            'h-2 rounded-full transition-all',
            s < current && 'w-2 bg-brand-primary',
            s === current && 'w-4 bg-brand-primary',
            s > current && 'w-2 bg-brand-border'
          )}
        />
      ))}
    </div>
  );
}

function WelcomeStep({ orgName, onNext }: { orgName: string; onNext: () => void }) {
  return (
    <div className="text-center space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-brand-primary">
          Welcome to Sifter, {orgName}!
        </h2>
        <p className="text-brand-muted mt-2">
          Let&apos;s get you set up. This will only take a few minutes.
        </p>
      </div>
      <button
        onClick={onNext}
        className="px-6 py-2.5 rounded-md bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition-colors"
      >
        Get Started
      </button>
    </div>
  );
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Access was cancelled. Please try again.',
  oauth_error: 'Something went wrong with the provider. Please try again.',
  invalid_session: 'OAuth session expired. Please try connecting again.',
  token_exchange_failed: "Couldn't complete the connection. Please try again.",
  userinfo_failed: "Couldn't fetch your email address. Please try again.",
  connection_failed: "Couldn't save the connection. Please try again.",
};

function ConnectMailboxStep({ onNext }: { onNext: () => void }) {
  const [oauthError, setOauthError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      setOauthError(OAUTH_ERROR_MESSAGES[error] ?? 'Something went wrong. Please try again.');
      const params = new URLSearchParams(searchParams.toString());
      params.delete('error');
      router.replace(`${pathname}${params.size > 0 ? `?${params}` : ''}`);
    }
  }, [searchParams, router, pathname]);

  const { data, isLoading } = useQuery<{ mailboxes: Mailbox[] }>({
    queryKey: ['mailboxes'],
    queryFn: async () => {
      const res = await fetch('/api/mailboxes');
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    refetchInterval: 5000,
  });

  const connected = (data?.mailboxes ?? []).filter((m) => m.status === 'active');
  const hasConnection = connected.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-primary">Connect your mailbox</h2>
        <p className="text-brand-muted text-sm mt-1">
          Sifter scans your inbox to collect freight invoices automatically.
        </p>
      </div>

      {oauthError && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{oauthError}</span>
          <button
            onClick={() => setOauthError(null)}
            className="shrink-0 text-red-400 hover:text-red-600"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <a
          href="/api/oauth/gmail/connect?return_to=onboarding"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-brand-border bg-brand-surface text-sm font-medium text-brand-primary hover:bg-brand-surface-muted transition-colors"
        >
          Connect Gmail
        </a>
        <a
          href="/api/oauth/outlook/connect?return_to=onboarding"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-brand-border bg-brand-surface text-sm font-medium text-brand-primary hover:bg-brand-surface-muted transition-colors"
        >
          Connect Outlook
        </a>
      </div>

      {isLoading && <p className="text-sm text-brand-muted">Checking connections…</p>}

      {connected.length > 0 && (
        <ul className="space-y-1">
          {connected.map((mb) => (
            <li key={mb.id} className="flex items-center gap-2 text-sm text-brand-primary">
              <CheckCircle className="w-4 h-4 text-green-500" />
              {mb.email}
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={onNext}
        disabled={!hasConnection}
        className="px-6 py-2.5 rounded-md bg-brand-primary text-white font-medium disabled:opacity-50 hover:bg-brand-primary/90 transition-colors"
      >
        Next
      </button>
    </div>
  );
}

interface UploadStepProps {
  title: string;
  description: string;
  uploadUrl: string;
  accuracyNote: string;
  onNext: () => void;
  onSkip: () => void;
}

function UploadStep({ title, description, uploadUrl, accuracyNote, onNext, onSkip }: UploadStepProps) {
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      if (file.type !== 'application/pdf') continue;
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch(uploadUrl, { method: 'POST', body: form });
        if (res.ok) setUploadedFiles((prev) => [...prev, file.name]);
      } catch {
        // silent — user can retry
      }
    }
    setUploading(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-primary">{title}</h2>
        <p className="text-brand-muted text-sm mt-1">{description}</p>
      </div>

      <div className="p-3 rounded-md bg-blue-50 border border-blue-200 text-sm text-blue-700">
        {accuracyNote}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={cn(
          'border-2 border-dashed rounded-lg p-10 text-center transition-colors',
          dragOver ? 'border-brand-primary bg-brand-primary/5' : 'border-brand-border'
        )}
      >
        <Upload className="w-8 h-8 mx-auto text-brand-muted mb-3" />
        <p className="text-sm text-brand-muted">
          Drag &amp; drop PDFs here, or{' '}
          <label className="text-brand-primary cursor-pointer underline">
            browse
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
        </p>
        {uploading && <Loader2 className="w-5 h-5 mx-auto mt-3 text-brand-muted animate-spin" />}
      </div>

      {uploadedFiles.length > 0 && (
        <ul className="space-y-1">
          {uploadedFiles.map((f) => (
            <li key={f} className="flex items-center gap-2 text-sm text-brand-primary">
              <CheckCircle className="w-4 h-4 text-green-500" />
              {f}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-4 items-center">
        <button
          onClick={onNext}
          className="px-6 py-2.5 rounded-md bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition-colors"
        >
          Next
        </button>
        <button onClick={onSkip} className="text-sm text-brand-muted hover:text-brand-primary">
          Skip for now
        </button>
      </div>
    </div>
  );
}

function DoneStep({ onFinish, isFinishing }: { onFinish: () => void; isFinishing: boolean }) {
  return (
    <div className="text-center space-y-6">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
        <CheckCircle className="w-8 h-8 text-green-600" />
      </div>
      <div>
        <h2 className="text-2xl font-semibold text-brand-primary">You&apos;re all set!</h2>
        <p className="text-brand-muted mt-2">Processing your email backlog…</p>
        <Loader2 className="w-5 h-5 mx-auto mt-3 text-brand-muted animate-spin" />
      </div>
      <button
        onClick={onFinish}
        disabled={isFinishing}
        className="px-6 py-2.5 rounded-md bg-brand-primary text-white font-medium disabled:opacity-50 hover:bg-brand-primary/90 transition-colors"
      >
        {isFinishing ? 'Redirecting…' : 'Go to Dashboard'}
      </button>
    </div>
  );
}

export default function OnboardingWizard({ orgName }: Props) {
  const [step, setStep] = useState<Step>(1);
  const router = useRouter();

  const completeOnboarding = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/org', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_completed: true }),
      });
      if (!res.ok) throw new Error('Failed to complete onboarding');
    },
    onSuccess: () => router.push('/dashboard'),
  });

  return (
    <div className="min-h-screen bg-brand-background flex items-center justify-center px-4">
      <div className="w-full max-w-lg bg-brand-surface rounded-xl border border-brand-border p-8 shadow-sm">
        <StepIndicator current={step} total={5} />

        {step === 1 && <WelcomeStep orgName={orgName} onNext={() => setStep(2)} />}
        {step === 2 && <ConnectMailboxStep onNext={() => setStep(3)} />}
        {step === 3 && (
          <UploadStep
            title="Upload rate sheets"
            description="Rate sheets let Sifter verify the exact rates your carriers agreed to."
            uploadUrl="/api/documents/upload?type=rate_sheet"
            accuracyNote="~60% accuracy without rate sheets. Upload for ~90% accuracy."
            onNext={() => setStep(4)}
            onSkip={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <UploadStep
            title="Upload Bills of Lading (BOLs)"
            description="BOLs help Sifter cross-check shipment details and accessorial charges."
            uploadUrl="/api/documents/upload?type=bol"
            accuracyNote="BOLs allow Sifter to catch detention, accessorial, and BOL mismatch findings."
            onNext={() => setStep(5)}
            onSkip={() => setStep(5)}
          />
        )}
        {step === 5 && (
          <DoneStep
            onFinish={() => completeOnboarding.mutate()}
            isFinishing={completeOnboarding.isPending}
          />
        )}
      </div>
    </div>
  );
}
