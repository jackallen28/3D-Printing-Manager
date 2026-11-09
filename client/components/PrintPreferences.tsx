import {PREFERENCES} from '../../shared/catalog.js';
import type {Details} from '../types';
export type FilePrintOptions=Pick<Details,'supports'|'printer'|'quality'|'copies'|'notes'|'designLink'>;
export function printOptions(details:Details):FilePrintOptions {
 const {supports,printer,quality,copies,notes,designLink}=details;return {supports,printer,quality,copies,notes,designLink};
}
export default function PrintPreferences({value,onChange}:{value:Details;onChange:(patch:Partial<Details>)=>void}) {
 return <div className="form-grid">
  {(['supports','printer','quality'] as const).map(key=><label className="field" key={key}>{({supports:'Supports',printer:'Printer',quality:'Print quality'})[key]}<select value={value[key]} onChange={e=>onChange({[key]:e.target.value})}>{PREFERENCES[key].map(option=><option key={option}>{option}</option>)}</select></label>)}
  <label className="field">Number of copies<select value={value.copies} onChange={e=>onChange({copies:Number(e.target.value)})}>{Array.from({length:10},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label>
  <label className="field full">Additional notes <span className="optional">optional</span><textarea maxLength={800} rows={3} value={value.notes} onChange={e=>onChange({notes:e.target.value})} placeholder="Supports, printer, or something the team should know…"/><small>Use this note for any custom preferences or model warnings. {value.notes.length}/800</small></label>
  <label className="field full">Link to your design <span className="optional">optional</span><input type="url" pattern="https://.*" maxLength={500} value={value.designLink} onChange={e=>onChange({designLink:e.target.value})} placeholder="https://… your Tinkercad or Fusion design"/><small>Use a shareable https link that staff can open.</small></label>
 </div>;
}
