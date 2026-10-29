import Image from 'next/image';
const originalPhotos=[
 {src:'/media/0313d864c2-wj36.webp',label:'Space to focus',alt:'Shared workstations and lounge seating'},
 {src:'/media/0d8f715bc8-Meeting-Rooms-1536x1024.jpg.webp',label:'Room to collaborate',alt:'A meeting room with a conference table and seating'},
 {src:'/media/e765b41151-wj34.webp',label:'A quieter workday',alt:'A separate workspace with desks and office chairs'},
 {src:'/media/d101922042-podcast-banner.webp',label:'A place to create',alt:'A podcast panel in a recording studio'},
];
export function VenueGallery({images}:{images?:string[]}){const supplied=(images||[]).filter(src=>/^\/(?:media|uploads)\//.test(src)&&/\.(?:webp|avif|jpe?g|png)(?:\?|$)/i.test(src));const photos=supplied.length?Array.from(new Set(supplied)).map((src,i)=>({src,label:'The Junction · '+String(i+1).padStart(2,'0'),alt:'Workspace Junction gallery image '+(i+1)})):originalPhotos;return <section className="ip-wrap ip-gallery" aria-labelledby="ip-gallery-title"><div className="ip-section-heading"><div><p className="ip-eyebrow">A change of perspective</p><h2 id="ip-gallery-title">Take a closer look.</h2></div><p>Workspace and studio imagery from the Junction. Talk to our team about the space that fits your plans.</p></div><div className="ip-gallery-grid">{photos.map(photo=><figure key={photo.src}><div><Image src={photo.src} alt={photo.alt} fill sizes="(max-width:650px) calc(100vw - 40px), 570px" className="ip-gallery-photo"/></div><figcaption>{photo.label}</figcaption></figure>)}</div></section>}
