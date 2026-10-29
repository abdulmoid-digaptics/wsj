/** Explicit browser origins only; no wildcard, credentials, paths or query strings. */
export function frontendOrigins(env:Record<string,string|undefined>=process.env):string[]{
 if(!env.FRONTEND_URL?.trim())throw new Error('FRONTEND_URL is required');
 const values=[env.FRONTEND_URL,...(env.FRONTEND_URLS?.trim()?env.FRONTEND_URLS.split(','):[])];
 return [...new Set(values.map(value=>{
  try{const raw=value.trim(),url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||raw.includes('*'))throw new Error();return url.origin;}
  catch{throw new Error('FRONTEND_URL and FRONTEND_URLS must contain explicit HTTP(S) origins only');}
 }))];
}
