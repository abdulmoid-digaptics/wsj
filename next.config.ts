import type {NextConfig} from 'next';
import redirects from './data/redirects.json';
const apiUrl=process.env.API_URL||'http://localhost:4000/api';
const apiOrigin=new URL(apiUrl).origin;
const publicApi=process.env.NEXT_PUBLIC_API_URL?.startsWith('http')?new URL(process.env.NEXT_PUBLIC_API_URL):new URL(apiOrigin);
const config:NextConfig={
 distDir:process.env.NEXT_DIST_DIR||'.next',
 trailingSlash:true,
 async rewrites(){return [{source:'/api/:path*',destination:apiUrl+'/:path*'},{source:'/uploads/:path*',destination:apiOrigin+'/uploads/:path*'}]},
 async redirects(){return (redirects as {source:string;destination:string}[]).map(r=>({...r,statusCode:301}))},
 images:{formats:['image/avif','image/webp'],remotePatterns:[{protocol:publicApi.protocol.replace(':','') as 'http'|'https',hostname:publicApi.hostname,port:publicApi.port,pathname:'/uploads/**'}]},
 turbopack:{rules:{'*.css':{loaders:['@tailwindcss/turbopack'],as:'*.css'}}},
 async headers(){return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'X-Frame-Options',value:'SAMEORIGIN'},{key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'}]}]}
};
export default config;
