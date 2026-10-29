'use client';
import {useEffect,useState,type ReactNode} from 'react';
import dynamic from 'next/dynamic';
const BookingDialog=dynamic(()=>import('./booking-dialog').then(m=>m.BookingDialog),{ssr:false,loading:()=> <div role="status" className="booking-loading">Opening inquiry…</div>});
type Request={service?:string;trigger?:HTMLElement};
function open(service?:string,trigger?:HTMLElement){window.dispatchEvent(new CustomEvent<Request>('wj:book',{detail:{service,trigger}}))}
export function BookingButton({children,className,service}:{children:ReactNode;className?:string;service?:string}){return <button type="button" aria-haspopup="dialog" className={className||'btn btn-primary'} onClick={e=>open(service,e.currentTarget)}>{children}</button>}
export function BookingLauncher(){const [request,setRequest]=useState<Request|null>(null);useEffect(()=>{const handler=(event:Event)=>setRequest((event as CustomEvent<Request>).detail||{});const legacy=(event:MouseEvent)=>{const target=event.target instanceof Element?event.target.closest('a[href="#wj-booking"]'):null;if(target instanceof HTMLElement){event.preventDefault();open(document.querySelector('main h1')?.textContent||undefined,target)}};window.addEventListener('wj:book',handler);document.addEventListener('click',legacy);return()=>{window.removeEventListener('wj:book',handler);document.removeEventListener('click',legacy)}},[]);return request?<BookingDialog service={request.service} onClose={()=>{const trigger=request.trigger;setRequest(null);requestAnimationFrame(()=>trigger?.focus())}}/>:null}
