import {discoveryResponse} from '@/lib/ai-discovery';

export const revalidate = 60;
export function GET() { return discoveryResponse('policy'); }
