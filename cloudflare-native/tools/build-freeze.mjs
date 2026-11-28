import fs from 'node:fs';
import {parse} from 'acorn';
const original=fs.readFileSync(new URL('../../apps-script/Code.gs',import.meta.url),'utf8'),ast=parse(original,{ecmaVersion:'latest'});
const targets=new Set(['doPost','ft_tick','ft_timerTick_','ft_pdfWorker_']);let output=original;
for(const node of [...ast.body].reverse())if(node.type==='FunctionDeclaration'&&targets.has(node.id.name)){
 const gate=node.id.name==='doPost'?"\n if(PropertiesService.getScriptProperties().getProperty('FT_CF_WRITE_FREEZE')==='true')return ft_gatewayResponse_({ok:false,status:503,error:'FireTime Pro wird gerade umgestellt. Bitte später erneut öffnen.'});\n":"\n if(PropertiesService.getScriptProperties().getProperty('FT_CF_WRITE_FREEZE')==='true')return {frozen:true};\n";
 output=output.slice(0,node.body.start+1)+gate+output.slice(node.body.start+1);targets.delete(node.id.name);
}
if(targets.size)throw Error('Fehlende Freeze-Einstiegspunkte: '+[...targets]);
output+='\n// Freeze preparation: inactive until explicitly enabled.\nfunction ft_cloudflareFreezeOn(){PropertiesService.getScriptProperties().setProperty("FT_CF_WRITE_FREEZE","true");return "Alte API und Zeit-/PDF-Trigger gesperrt. Finalen Export starten.";}\nfunction ft_cloudflareFreezeOff(){PropertiesService.getScriptProperties().deleteProperty("FT_CF_WRITE_FREEZE");return "Altes Backend wieder freigegeben. Nur vor neuen Cloudflare-Buchungen verwenden.";}\n';
fs.writeFileSync(new URL('../dist/Code_Freeze_Vorbereitung.gs',import.meta.url),output);
console.log('Vollständige optionale Code.gs mit zunächst inaktiver Umschaltsperre erstellt.');
