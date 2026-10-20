'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const code=fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8');
const js=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
const fragment=(s,start,end)=>{
 const a=s.indexOf(start),b=s.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Expected source section '+start);
 return s.slice(a,b);
};
test('complete frontend and backend JS syntax is valid',()=>{
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.doesNotThrow(()=>new vm.Script(code));
});
test('staff accepts free-form comma decimals, not fixed steps',()=>{
 const parser=fragment(js,'function ftStaffParseDecimal_','function ftStaffFormatDecimal_');
 const fn=vm.runInNewContext(parser+';ftStaffParseDecimal_;');
 assert.equal(fn('24,9','Stunden',0,300),24.9);
 assert.equal(fn('-54,753159','Startsaldo',-10000,10000),-54.753159);
 assert.equal(fn('24.1234567','Stunden',0,300),24.1234567);
 assert.match(html,/step="any"/);
});
const pickerScript=fragment(js,'function ftDirectActivityOptions_','function ftTimerPanel_');
function pickerContext(){
 const ctx={
  ST:{h:{activityDefaultsSupported:true,activityTypes:[
   {id:'custom-a',type:'OTHER',label:'Sonderauftrag',active:true},
   {id:'inactive',type:'OTHER',label:'Alt',active:false}
  ]}},
  Date,
  ftViennaParts:()=>({year:'2026',month:'10',day:'20'}),
  select:(name,label,items,current)=>({name,label,items,current}),
  E:s=>String(s),
  shiftedEnd:s=>{
   const d=new Date(s+':00');d.setHours(d.getHours()+1);
   return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')+
    'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }
 };
 return vm.runInNewContext(pickerScript+
  ';({ftDirectActivityOptions_,ftActivityPicker_,ftDirectActivityPayload_,ftTimeToday_,ftTimeSyncEndDate_})',ctx);
}
test('six direct activities retain correct billing categories',()=>{
 const h=pickerContext();
 const items=h.ftDirectActivityOptions_();
 for(const name of ['Bereitschaftseinsatz (von Abfahrt bis Einsatzende)','Wartungsarbeiten','Feuerlöscher','Büro','Sonstige']){
  assert.ok(items.some(x=>x[1]===name),name);
 }
 assert.deepEqual(Object.fromEntries(Object.entries(h.ftDirectActivityPayload_('INCIDENT|FT_STD_INCIDENT'))),
  {type:'INCIDENT',activityOptionId:'FT_STD_INCIDENT'});
 assert.equal(h.ftDirectActivityPayload_('OTHER|FT_STD_EXTINGUISHER').type,'OTHER');
 assert.equal(h.ftActivityPicker_('OTHER','custom-a').current,'OTHER|custom-a');
 assert.equal(h.ftActivityPicker_('OTHER','inactive').current,'OTHER|inactive');
});
test('new time starts today and moving its beginning also moves its end',()=>{
 const h=pickerContext();
 assert.equal(h.ftTimeToday_(),'2026-10-20');
 assert.match(js,/edit\?stampInput\(edit.start\):ftTimeToday_\(\)\+'T08:00'/);
 const entries={start:{value:'2026-10-24T08:00'},end:{value:'2026-10-20T15:30'}};
 h.ftTimeSyncEndDate_({elements:{namedItem:n=>entries[n]}});
 assert.equal(entries.end.value,'2026-10-24T15:30');
 entries.start.value='2026-10-25T18:00';
 h.ftTimeSyncEndDate_({elements:{namedItem:n=>entries[n]}});
 assert.equal(entries.end.value,'2026-10-25T19:00'); // keep chronology when new start is later
 entries.start.value='2026-10-26T17:45';
 entries.end.value='2026-10-25T16:30';
 h.ftTimeSyncEndDate_({elements:{namedItem:n=>entries[n]}});
 assert.equal(entries.end.value,'2026-10-26T18:45');
});
test('7-column roster shows full local dates and assigned workers; read-only',()=>{
 const body=fragment(js,'function ftRosterDate_','function standby(){');
 const shifts=[
  {id:'s1',day:'2026-10-22',userId:'u1',status:'PUBLISHED',start:'2026-10-22T05:00:00Z',end:'2026-10-23T05:00:00Z'},
  {id:'s2',day:'2026-10-23',userId:'u2',status:'PUBLISHED',start:'2026-10-23T05:00:00Z',end:'2026-10-24T05:00:00Z'},
  {id:'draft',day:'2026-10-24',userId:'u2',status:'DRAFT',start:'2026-10-24T05:00:00Z',end:'2026-10-25T05:00:00Z'}
 ];
 const ST={month:'2026-10',h:{shifts,segments:[]}};
 function calendar(admin){
  return vm.runInNewContext(body+';({ftRosterMonthGrid_,ftRosterDate_,ftRosterDayDetail_})',{
   ST,Date,Math,
   has:k=>k==='STANDBY',isAdmin:()=>admin,me:()=>({id:'u1'}),
   who:id=>({name:id==='u1'?'Michael Test':'Anna Beispiel'}),
   E:s=>String(s),days:()=>31,ftTimeToday_:()=> '2026-10-20',
   ftPdfMonthLabel:()=> 'Oktober 2026',DT:x=>x
  });
 }
 const staff=calendar(false);
 const markup=staff.ftRosterMonthGrid_();
 assert.match(markup,/22\.10\.2026/);
 assert.match(markup,/data-act="rosterInspect"/);
 assert.match(markup,/Mein Dienst/);
 assert.doesNotMatch(staff.ftRosterDayDetail_('2026-10-24'),/Anna Beispiel/);
 assert.match(calendar(true).ftRosterDayDetail_('2026-10-24'),/Entwurf/);
 assert.equal(shifts[0].status,'PUBLISHED');
});
test('backend standard activities are not inserted into customer spreadsheet',()=>{
 const codeBlock=fragment(code,'const FT_STANDARD_ACTIVITIES_','function ft_activityTypesGet_');
 const api=vm.runInNewContext(codeBlock+';({ft_activityTypesFor_})',{
  ft_db_:()=>({getSheetByName:()=>true}),
  ft_get_:()=>[{id:'customer-1',companyId:'c1',type:'OTHER',label:'Kundeneintrag',active:true,sort:3}],
  ft_bool_:v=>Boolean(v),
  Number,Math
 });
 const a=api.ft_activityTypesFor_({id:'c1'});
 const b=api.ft_activityTypesFor_({id:'c2'});
 assert.ok(a.some(x=>x.id==='FT_STD_INCIDENT'&&x.type==='INCIDENT'));
 assert.ok(a.some(x=>x.id==='FT_STD_EXTINGUISHER'&&x.type==='OTHER'));
 assert.ok(a.some(x=>x.id==='customer-1'));
 assert.ok(!b.some(x=>x.id==='customer-1'));
});
test('auto stop mail contains 19:00 and edit notice, with unique activity reference',()=>{
 const body=fragment(code,'function ft_timerAutoNotice_','function ft_timerRetryNotices_');
 const calls=[],sent=new Set();
 const fn=vm.runInNewContext(body+';ft_timerAutoNotice_;',{
  ft_clientUrl_:()=> 'https://firetime-pro.example.test/',
  ft_publicGithubUrl_:()=> 'https://firetime-pro.example.test/',
  ft_notification_:(c,u,kind,id,subject,text)=>{
   if(sent.has(id))return false;sent.add(id);calls.push({kind,id,subject,text});return true;
  },
  Utilities:{formatDate:()=> '20.10.2026 19:00'},FT_TZ:'Europe/Vienna',Date
 });
 const company={id:'c',name:'BSB3100'},user={id:'u',email:'employee@example.test',name:'Mitarbeiter'};
 const a={id:'activity-x',end:'2026-10-20T17:00:00Z'};
 assert.equal(fn(company,user,a),true);
 assert.equal(fn(company,user,a),false);
 assert.equal(calls.length,1);
 assert.equal(calls[0].kind,'TIMER_AUTO_CLOSE');
 assert.match(calls[0].text,/19:00 Uhr/);
 assert.match(calls[0].text,/Bearbeiten/);
 assert.ok(calls[0].text.includes('\n\n'),'Mail uses real line breaks');
});
