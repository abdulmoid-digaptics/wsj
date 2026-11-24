import type {Metadata} from 'next';
import {withPageSeo} from '@/lib/seo';
export {default} from './_home/junction-page';
export async function generateMetadata(): Promise<Metadata> {
  return withPageSeo('/', {alternates: {canonical: '/'}});
}
