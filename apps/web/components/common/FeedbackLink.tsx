import { MessageSquare } from 'lucide-react';

const FEEDBACK_URL =
  'https://github.com/morningstar0521/Readme-Intelligence/issues/new?template=extraction-feedback.yml';

export function FeedbackLink({ className = '' }: { className?: string }) {
  return (
    <a
      href={FEEDBACK_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 font-medium text-link hover:underline ${className}`}
      data-testid="feedback-link"
    >
      <MessageSquare className="h-4 w-4" aria-hidden /> Give feedback
    </a>
  );
}
