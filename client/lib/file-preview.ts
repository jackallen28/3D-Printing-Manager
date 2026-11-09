export function filePreview(file: File): Promise<Blob> {
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;const context=canvas.getContext('2d')!;
  context.fillStyle='#101f2c';context.fillRect(0,0,640,400);context.strokeStyle='#75babb';context.lineWidth=3;
  context.strokeRect(282,85,76,92);context.fillStyle='#c9e3e6';context.font='600 25px system-ui';context.textAlign='center';
  context.fillText(file.name.split('.').at(-1)!.toUpperCase(),320,228);context.font='15px system-ui';context.fillStyle='#a5bbc9';context.fillText('Preview not supported for this file type',320,265);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not prepare the file thumbnail.')),'image/png'));
}
