/** Short, advisory results for the trial layer preview.
 * @param {ReturnType<typeof import('./geometry.js').analyseGeometry>} analysis
 * @param {{code:string}[]} warnings
 * @param {{supports?:boolean,supportsRemoved?:boolean}} options
 */
export function printTestResult(analysis,warnings,options={}) {
 const codes=new Set(warnings.map(w=>w.code)),fixes=[];
 const supported=!!options.supports&&analysis.supportContacts.length>0,removed=!!options.supportsRemoved;
 const loose=analysis.floating>0,overhang=analysis.sagMaxDrop>0;
 if(codes.has('floating')&&(!supported||removed))fixes.push('Move floating parts so they touch the model.');
 if(codes.has('thin')||codes.has('thin-features'))fixes.push('Make the amber areas thicker.');
 if(codes.has('parts'))fixes.push('Join parts that should print as one object.');
 if(codes.has('mesh')||codes.has('degenerate'))fixes.push('Export a solid model from your CAD program.');
 if(codes.has('size'))fixes.push('Make the model smaller to fit the printer.');
 if(codes.has('units'))fixes.push('Check the size shown in mm.');
 if(!analysis.complete)fixes.push('Ask staff to check this detailed model.');
 const failed=['thin','thin-features','mesh','degenerate','size',...(!supported||removed?['floating']:[])].some(code=>codes.has(code));
 let state=failed?'failed':fixes.length?'check':'finished',title=failed?'Your print may fail.':fixes.length?'Check before printing.':'Preview finished.',message='';
 if(supported&&!removed){
  if(!failed){state='supported';title='Printed with supports.';}
  message='This preview only works with supports.'+(loose?' The loose parts will separate when the supports are removed.':' The supports keep the overhangs from sagging.');
 }else if(removed){
  if(loose){title='Loose parts separate.';message='The loose parts fall away when the supports are removed.';}
  else{message='The overhang stays attached. Removing supports may leave a rough underside.';if(!failed&&!fixes.length)title='Supports removed.';}
 }else if(overhang){
  message='The overhangs sagged without supports.';
  if(!failed){state='support-check';title='Try this print with supports.';fixes.unshift('Turn on Print with supports and try again.');}
 }
 return {state,title,message,canRemoveSupports:supported&&!removed,fixes:fixes.length?[...fixes.slice(0,2),'Ask your teacher to check your model.']:[]};
}
