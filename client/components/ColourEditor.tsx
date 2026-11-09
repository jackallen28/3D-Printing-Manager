import {useId} from 'react';
import {Check,Palette,Plus,AlertTriangle} from 'lucide-react';
import {ADVANCED_FILAMENT,ADVANCED_HEX} from '../../shared/catalog.js';
import type {LoadedModel} from '../lib/model';
import type {Colour} from '../types';
type Mapping={source:string;target:string};
export default function ColourEditor({model,mapping,colours,customEnabled,selectedPart,onSelect,onMapping,customColour,advancedNote,onCustom,onAdvanced}:{model:LoadedModel|null;mapping:Mapping[];colours:Colour[];customEnabled:boolean;selectedPart:string;onSelect:(v:string)=>void;onMapping:(v:Mapping[])=>void;customColour:string;advancedNote:string;onCustom:(v:string)=>void;onAdvanced:(v:string)=>void}) {
 const groupName=useId();
 const selected=mapping.find(m=>m.source===selectedPart)||mapping[0];
 const partName=(source:string)=>model?.parts?.find(p=>p.source===source)?.name||`Part ${Math.max(0,mapping.findIndex(m=>m.source===source))+1}`;
 const colourHex=(name:string)=>name===ADVANCED_FILAMENT?ADVANCED_HEX:colours.find(c=>c.name===name)?.hex||'#cfc2e0';
 const assign=(target:string)=>{if(selected)onMapping(mapping.map(m=>m.source===selected.source?{...m,target}:m));};
 const anotherPart=()=>{const index=mapping.findIndex(m=>m.source===selected?.source);onSelect(mapping[(index+1)%mapping.length].source);};
 const advanced=mapping.some(m=>m.target===ADVANCED_FILAMENT),custom=mapping.some(m=>m.target==='Custom');
 const option=(name:string)=>{
  const checked=selected?.target===name;
  return <label key={name} className={'colour-option '+(checked?'selected':'')}>
   <input className="colour-radio" type="radio" name={groupName} value={name} checked={checked} onChange={()=>assign(name)}/>
   <span className={'swatch '+(name===ADVANCED_FILAMENT?'glitter-swatch':name==='Custom'?'custom-swatch':'')} style={{backgroundColor:colourHex(name)}}>{checked&&<Check size={12}/>}</span>{name}
  </label>;
 };
 return <section className="panel colour-panel">
  <div className="section-label"><Palette size={18}/> Choose your colours</div>
  <p className="single-colour-note">Most parts will be printed in a single colour unless arranged otherwise.</p>
  <p className="small muted">Choose one colour for each part. Choosing a new colour replaces its previous colour.</p>
  <div className="part-list" role="group" aria-label="Model parts">{mapping.map(m=><button type="button" key={m.source} className={'part-button '+(selected?.source===m.source?'selected':'')} onClick={()=>onSelect(m.source)} aria-pressed={selected?.source===m.source}><i className={'swatch '+(m.target===ADVANCED_FILAMENT?'glitter-swatch':'')} style={{backgroundColor:colourHex(m.target)}}/><span>{partName(m.source)}<small>{m.target}</small></span></button>)}</div>
  {mapping.length>1?<div className="print-colour-choices"><button type="button" className="button secondary" onClick={anotherPart} title="Select another part, then choose its colour"><Plus size={16}/> Add another colour</button><span className="small muted">Select a different part to use another colour.</span></div>:<p className="small muted">One part was found. Different colours need separate parts in the CAD file, or an arrangement with staff.</p>}
  <p className="slot-label">Choose a colour for {selected?partName(selected.source):'your part'}</p>
  <div className="swatches" role="radiogroup" aria-label="Available print colours">{colours.map(c=>option(c.name))}{customEnabled&&option('Custom')}{option(ADVANCED_FILAMENT)}</div>
  <p className="small muted">Bambu PLA Basic swatches are approximate.</p>
  {custom&&<label className="field">Custom colour request<input maxLength={80} value={customColour} onChange={e=>onCustom(e.target.value)} placeholder="Describe the colour you would like"/></label>}
  {advanced&&<label className="field full">Advanced filament request<textarea required maxLength={800} rows={3} value={advancedNote} onChange={e=>onAdvanced(e.target.value)} placeholder="Describe the filament you need…"/><small>Advanced filaments are available only by arrangement. The glitter-purple preview represents your request.</small></label>}
  {model?.notices.map(n=><p className="notice small" key={n}><AlertTriangle size={15}/>{n}</p>)}
 </section>;
}
