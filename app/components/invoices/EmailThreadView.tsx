'use client';

import { useState, useEffect, useRef } from 'react';

const DOMPURIFY_CONFIG = {
  // img removed: external src leaks IP to senders (tracking pixels); style removed: enables CSS injection
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'div', 'span'],
  ALLOWED_ATTR: ['href', 'alt', 'title', 'class'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
};

function SanitizedEmailBody({ html, text }: { html: string; text: string }) {
  const [sanitized, setSanitized] = useState<string | null>(null);

  useEffect(() => {
    import('isomorphic-dompurify').then(({ default: DOMPurify }) => {
      setSanitized(DOMPurify.sanitize(html, DOMPURIFY_CONFIG));
    });
  }, [html]);

  if (sanitized === null) {
    return <div className="whitespace-pre-wrap">{text}</div>;
  }
  return (
    <div
      className="prose prose-sm max-w-none"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

interface EmailMessage {
  id: string;
  gmail_message_id: string;
  thread_id: string;
  subject: string;
  from: {
    email: string;
    name?: string;
  };
  to: string[];
  cc: string[];
  date: string;
  internalDate: number;
  direction: 'sent' | 'received';
  html?: string;
  text: string;
  snippet: string;
  hasAttachments: boolean;
  attachments: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
}

interface EmailThreadViewProps {
  disputeDocumentId: string;
  onClose: () => void;
}

interface ReplyModalProps {
  to: string[];
  cc: string[];
  subject: string;
  onSend: (to: string[], cc: string[], subject: string, message: string, htmlMessage?: string) => Promise<void>;
  onClose: () => void;
}

function ReplyModal({ to, cc, subject, onSend, onClose }: ReplyModalProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!message.trim()) {
      setError('Message is required');
      return;
    }

    setSending(true);
    setError(null);

    try {
      await onSend(to, cc, subject, message);
      onClose();
    } catch {
      setError('Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Compose Reply</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
              <input
                type="text"
                value={to.join(', ')}
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
              />
            </div>

            {cc.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CC</label>
                <input
                  type="text"
                  value={cc.join(', ')}
                  readOnly
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <input
                type="text"
                value={subject}
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Type your message here..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={onClose}
              disabled={sending}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !message.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EmailThreadView({ disputeDocumentId, onClose }: EmailThreadViewProps) {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [replyToMessage, setReplyToMessage] = useState<EmailMessage | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 0) {
      const lastTwo = messages.slice(-2);
      const newExpanded = new Set(expandedMessages);
      lastTwo.forEach(msg => newExpanded.add(msg.id));
      setExpandedMessages(newExpanded);
    }
  }, [messages.length]);

  const fetchJson = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error('Request failed');
    }
    return response.json();
  };

  const getProvider = async (): Promise<'gmail' | 'outlook'> => {
    const providerData = await fetchJson(`/api/disputes/${disputeDocumentId}/email-thread/provider`);
    return providerData.provider === 'outlook' ? 'outlook' : 'gmail';
  };

  const fetchEmailThread = async (pageToken: string | null = null) => {
    try {
      if (pageToken) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const provider = await getProvider();
      const endpoint = provider === 'outlook' ? 'realtime-outlook' : 'realtime-gmail';
      const url = new URL(`/api/disputes/${disputeDocumentId}/email-thread/${endpoint}`, window.location.origin);
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const data = await fetchJson(url.toString());

      if (pageToken) {
        setMessages(prev => [...(data.messages || []), ...prev]);
      } else {
        setMessages(data.messages || []);
      }

      setNextPageToken(data.nextPageToken);
      setHasMore(data.hasMore || false);
    } catch {
      setError('Failed to load email thread');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchEmailThread();
  }, [disputeDocumentId]);

  const handleRefresh = () => {
    fetchEmailThread();
  };

  const handleLoadMore = () => {
    if (nextPageToken && !loadingMore) {
      fetchEmailThread(nextPageToken);
    }
  };

  const toggleExpand = (messageId: string) => {
    const newExpanded = new Set(expandedMessages);
    if (newExpanded.has(messageId)) {
      newExpanded.delete(messageId);
    } else {
      newExpanded.add(messageId);
    }
    setExpandedMessages(newExpanded);
  };

  const handleReply = (message: EmailMessage) => {
    setReplyToMessage(message);
    setShowReplyModal(true);
  };

  const handleSendReply = async (
    to: string[],
    cc: string[],
    subject: string,
    message: string,
    htmlMessage?: string
  ) => {
    const provider = await getProvider();
    const endpoint = provider === 'outlook' ? 'reply-outlook' : 'reply-gmail';
    await fetchJson(`/api/disputes/${disputeDocumentId}/email-thread/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to,
        cc,
        subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        message,
        htmlMessage,
      }),
    });

    await fetchEmailThread();
    setShowReplyModal(false);
    setReplyToMessage(null);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getInitials = (name: string | undefined, email: string): string => {
    if (name) {
      const parts = name.split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return name[0].toUpperCase();
    }
    return email[0].toUpperCase();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-4 text-sm text-gray-500">Loading email thread...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
          <div className="p-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900">Email Thread</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRefresh}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md"
                title="Refresh"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
                {error}
              </div>
            )}

            {messages.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-sm">No email messages found in this thread.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {hasMore && (
                  <div className="text-center py-2">
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                    >
                      {loadingMore ? 'Loading...' : `Load ${messages.length > 0 ? 'older' : ''} messages`}
                    </button>
                  </div>
                )}

                {messages.map((message, index) => {
                  const isExpanded = expandedMessages.has(message.id);
                  const isLastTwo = index >= messages.length - 2;
                  const showFull = isExpanded || isLastTwo;

                  return (
                    <div
                      key={message.id}
                      className="border-b border-gray-200 pb-4 last:border-b-0"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0">
                          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-medium text-sm">
                            {getInitials(message.from.name, message.from.email)}
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between mb-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-gray-900">
                                {message.from.name || message.from.email}
                              </span>
                              <span className="text-sm text-gray-500">
                                &lt;{message.from.email}&gt;
                              </span>
                              {message.cc.length > 0 && (
                                <span className="text-xs text-gray-400">
                                  CC: {message.cc.join(', ')}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 whitespace-nowrap">
                                {formatDate(message.date)}
                              </span>
                              <button
                                onClick={() => handleReply(message)}
                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                                title="Reply"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          {message.subject && (
                            <div className="text-sm font-medium text-gray-700 mb-2">
                              {message.subject}
                            </div>
                          )}

                          {showFull ? (
                            <div className="text-sm text-gray-700">
                              {message.html ? (
                                <SanitizedEmailBody html={message.html} text={message.text} />
                              ) : (
                                <div className="whitespace-pre-wrap">{message.text}</div>
                              )}

                              {message.hasAttachments && message.attachments.length > 0 && (
                                <div className="mt-4 space-y-2">
                                  {message.attachments.map((attachment) => (
                                    <div
                                      key={attachment.attachmentId}
                                      className="flex items-center gap-2 p-2 bg-gray-50 rounded border border-gray-200"
                                    >
                                      <span className="text-sm text-gray-600">📎</span>
                                      <span className="text-sm text-gray-700 flex-1">{attachment.filename}</span>
                                      <span className="text-xs text-gray-500">
                                        {(attachment.size / 1024).toFixed(1)} KB
                                      </span>
                                      <a
                                        href={`/api/disputes/${disputeDocumentId}/attachments/${message.gmail_message_id}/${attachment.attachmentId}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-indigo-600 hover:text-indigo-800"
                                      >
                                        Download
                                      </a>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-sm text-gray-600">
                              {message.snippet}
                              <button
                                onClick={() => toggleExpand(message.id)}
                                className="ml-2 text-indigo-600 hover:text-indigo-800 text-xs"
                              >
                                Show more
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {messages.length > 0 && (
            <div className="p-4 border-t border-gray-200">
              <button
                onClick={() => {
                  const lastMessage = messages[messages.length - 1];
                  handleReply(lastMessage);
                }}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
              >
                Reply
              </button>
            </div>
          )}
        </div>
      </div>

      {showReplyModal && replyToMessage && (
        <ReplyModal
          to={replyToMessage.direction === 'sent' ? replyToMessage.to : [replyToMessage.from.email]}
          cc={replyToMessage.cc}
          subject={replyToMessage.subject}
          onSend={handleSendReply}
          onClose={() => {
            setShowReplyModal(false);
            setReplyToMessage(null);
          }}
        />
      )}
    </>
  );
}
