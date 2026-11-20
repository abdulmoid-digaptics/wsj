import {journalFeed} from '@/lib/journal-feed';

export const revalidate = 600;

export function GET() {
  return journalFeed();
}
