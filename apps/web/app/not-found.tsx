import { ErrorState } from '@/components/common/ErrorState';

export default function NotFound() {
  return <ErrorState title="Page not found" message="This page does not exist." causes={['The link is mistyped or out of date.']} />;
}
