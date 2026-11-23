import type { Metadata, Viewport } from 'next';
import {Manrope, Newsreader} from 'next/font/google';
import {loadBusiness} from '@/lib/site';
import {PwaRegistration} from '@/components/pwa-registration';
import './globals.css';
import './design.css';
import './responsive.css';
import './type-scale.css';
import './platform.css';
import './homepage.css';
import './inner-pages.css';
import './platform-components.css';
import './inquiry-design.css';
import './classic.css';
import './design-system.css';
import './inner-redesign.css';
import './services-redesign.css';
import './consistency-system.css';
import './button-system.css';
import './requested-pages-polish.css';
import './mega-menu.css';
import './motion-system.css';
// Brand layer: chapter art direction, header route strip, Inter-only display type. Loaded last.
import './junction-system.css';
// Atelier: the editorial redesign layer (serif display, pill controls, soft media). Loaded last.
import './atelier.css';
import './alignment.css';
// Route-scoped sheets load with their route (still last in the cascade):
//   figma-pages.css -> components/figma-page/*, community-network.css -> community/service pricing sections
//   _home/junction-home.css -> app/_home/junction-page.tsx (homepage), contact-page.css -> components/contact-view.tsx

// Two typefaces: Newsreader (editorial serif, with italics) for display, Manrope for reading text and UI.
const sans = Manrope({subsets:['latin'], variable:'--font-sans', display:'swap'});
const serif = Newsreader({subsets:['latin'], variable:'--font-serif', display:'swap', style:['normal','italic'], axes:['opsz']});
export const viewport:Viewport = {themeColor:'#0E3421'};
const defaultMetadata:Metadata={metadataBase:new URL(process.env.NEXT_PUBLIC_SITE_URL||'https://workspacejunction.com'),title:{default:'Workspace Junction | Work. Connect. Grow.',template:'%s | Workspace Junction'},description:'Coworking, meeting rooms, creative studios and business services in Oakbrook Terrace, Illinois.',openGraph:{siteName:'Workspace Junction',locale:'en_US',type:'website'}};
export async function generateMetadata():Promise<Metadata>{const b=await loadBusiness();return {...defaultMetadata,applicationName:'Workspace Junction',appleWebApp:{capable:true,title:'WSJ',statusBarStyle:'default'},icons:{apple:[180,152,167].map(size=>({url:`/icons/apple-touch-icon-${size}.png`,sizes:`${size}x${size}`,type:'image/png'}))},...(b?.seoTitle?{title:{default:b.seoTitle,template:'%s | Workspace Junction'}}:{}),description:b?.seoDescription||defaultMetadata.description}}
export default function RootLayout({children}:{children:React.ReactNode}){/* Browser extensions (e.g. ColorZilla's cz-shortcut-listen, Grammarly) add attributes to <html>/<body> before React loads. suppressHydrationWarning covers only these two elements' own attributes; mismatches inside the page are still reported. */
return <html lang="en" className={sans.variable+' '+serif.variable} suppressHydrationWarning><body suppressHydrationWarning>{children}<PwaRegistration/></body></html>}
