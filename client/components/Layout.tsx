import { ArrowUpRight, Box, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { homeUrl, isAppsScript } from '../platform';
import bntsMark from '../assets/bnts-pixels.svg?inline';
export function Layout({children, teacher=false}: {children:ReactNode;teacher?:boolean}) {
 return <><a className="skip-link" href="#main">Skip to content</a><div className="sky" aria-hidden="true">{Array.from({length:17},(_,i)=><i key={i} style={{left:`${(i*29+7)%100}%`,top:`${(i*17+11)%100}%`,width:`${8+i%4*8}px`,height:`${8+i%4*8}px`,animationDelay:`-${i*3}s`,animationDuration:`${25+i*2}s`,background:i%3===0?'#cfc2e0':i%3===1?'#704988':'#19c1ca'}}/>)}</div><header className="site-header"><a href={homeUrl} target={isAppsScript?'_top':undefined} className="brand" aria-label="BNTS Print Studio home"><img src={bntsMark} alt=""/><span><b>BNTS<span className="brand-divider">/</span><span className="brand-name">3D PRINT STUDIO</span></b><small>BANYULE NILLUMBIK TECH SCHOOL</small></span></a><span className="header-note">{teacher?<><ShieldCheck size={15}/> Teacher console</>:<><span className="live-dot"/> Student upload <ArrowUpRight size={15}/></>}</span></header><main id="main">{children}</main><footer className="site-footer"><span><Box size={16}/> 3D printing · BNTS</span><span>Banyule Nillumbik Tech School <img src={bntsMark} alt=""/></span></footer></>;
}
export function ErrorMessage({message}: {message:string}) {return message?<div className="error-message" role="alert">{message}</div>:null;}
export function Loading(){return <div className="loading-block" role="status"><span className="spinner"/> Just a moment…</div>;}
export const bytesLabel=(bytes:number)=>bytes<1024*1024?`${(bytes/1024).toFixed(0)} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;
export const dateLabel=(date:string)=>new Intl.DateTimeFormat('en-AU',{dateStyle:'medium',timeZone:'Australia/Melbourne'}).format(new Date(date));
