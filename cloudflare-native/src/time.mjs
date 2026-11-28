// The legacy domain code relies on local Date getters/constructors. Workers run UTC.
// This request-local Date class preserves Europe/Vienna, including DST, without globals.
const NativeDate = globalThis.Date;
const formats = new Map();
export function parts(value, zone = 'Europe/Vienna') {
 let fmt = formats.get(zone);
 if (!fmt) {fmt = new Intl.DateTimeFormat('en-GB', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});formats.set(zone,fmt);}
 return Object.fromEntries(fmt.formatToParts(new NativeDate(+value)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
}
export function localEpoch(y,m,d,h=0,min=0,s=0,ms=0) {
 const wall = NativeDate.UTC(y,m,d,h,min,s,ms);
 let t = wall;
 for (let i=0;i<4;i++) {
  const p=parts(t), represented=NativeDate.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second,((t%1000)+1000)%1000);
  const next=t+(wall-represented);
  if(next===t){const before=parts(t-3600000);if(before.year===p.year&&before.month===p.month&&before.day===p.day&&before.hour===p.hour&&before.minute===p.minute&&before.second===p.second)return t-3600000;return t;}
  t=next;
 }
 // Gap at spring DST: advance by the gap, matching Date's compatible disambiguation.
 const possibilities=[t,t-3600000,t+3600000];
 return possibilities.filter(x=>{const p=parts(x);return NativeDate.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)>=wall;}).sort((a,b)=>a-b)[0]??t;
}
export function formatDate(value, zone, pattern) {
 const p=parts(value,zone), pad=n=>String(n).padStart(2,'0');
 const weekday=new NativeDate(NativeDate.UTC(p.year,p.month-1,p.day)).getUTCDay()||7;
 const tokens={yyyy:String(p.year),MM:pad(p.month),dd:pad(p.day),HH:pad(p.hour),mm:pad(p.minute),ss:pad(p.second),H:String(p.hour),d:String(p.day),u:String(weekday)};
 return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss|H|d|u/g,(all,literal)=>literal??tokens[all]);
}
export class ViennaDate extends NativeDate {
 constructor(...args){
  if(args.length>1){let [y,m,d=1,h=0,min=0,s=0,ms=0]=args;y=Number(y);super(localEpoch(y>=0&&y<=99?y+1900:y,Number(m),Number(d),Number(h),Number(min),Number(s),Number(ms)));}
  else if(typeof args[0]==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(args[0])){
   const [y,m,d,h,min,s=0,ms=0]=args[0].split(/[-T:.]/).map(Number);super(localEpoch(y,m-1,d,h,min,s,ms));
  } else if(args.length)super(args[0]); else super();
 }
 _p(){return Number.isFinite(+this)?parts(this):null;}
 getFullYear(){return this._p()?.year??NaN;} getMonth(){return (this._p()?.month??NaN)-1;}
 getDate(){return this._p()?.day??NaN;} getHours(){return this._p()?.hour??NaN;}
 getMinutes(){return this._p()?.minute??NaN;} getSeconds(){return this._p()?.second??NaN;}
 getDay(){const p=this._p();return p?new NativeDate(NativeDate.UTC(p.year,p.month-1,p.day)).getUTCDay():NaN;}
 getTimezoneOffset(){const p=this._p();return p?(+this-NativeDate.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second,this.getUTCMilliseconds()))/60000:NaN;}
 _set(changes){const p=this._p();if(!p)return this.setTime(NaN);const v={y:p.year,m:p.month-1,d:p.day,h:p.hour,min:p.minute,s:p.second,ms:this.getUTCMilliseconds(),...changes};return this.setTime(localEpoch(v.y,v.m,v.d,v.h,v.min,v.s,v.ms));}
 setDate(d){return this._set({d});} setMonth(m,d=this.getDate()){return this._set({m,d});}
 setFullYear(y,m=this.getMonth(),d=this.getDate()){return this._set({y,m,d});}
 setHours(h,min=this.getMinutes(),s=this.getSeconds(),ms=this.getUTCMilliseconds()){return this._set({h,min,s,ms});}
 setMinutes(min,s=this.getSeconds(),ms=this.getUTCMilliseconds()){return this._set({min,s,ms});}
 setSeconds(s,ms=this.getUTCMilliseconds()){return this._set({s,ms});}
 static parse(s){return +new ViennaDate(s);}
}
