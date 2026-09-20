/* Builds data/basemap.json — the map background the Guests page draws itself, so the page
   never fetches map tiles from an outside service.

   Source: Natural Earth 1:50m (public domain, naturalearthdata.com), downloaded as GeoJSON:
     ne_admin1.json     ne_50m_admin_1_states_provinces   -> US states + Canadian provinces
     ne_countries.json  ne_50m_admin_0_countries          -> Mexico (land context south of the border)
     ne_lakes.json      ne_50m_lakes                      -> the large lakes

     node tools/build-basemap.cjs <download-folder>
*/
const fs=require('fs'),path=require('path');
const src=process.argv[2];if(!src){console.error('usage: node tools/build-basemap.cjs <download-folder>');process.exit(1);}
const read=f=>JSON.parse(fs.readFileSync(path.join(src,f),'utf8'));

// Two decimals is about half a mile — far finer than a bubble map needs, and a third of the size.
const r2=n=>Math.round(n*100)/100;
function ring(coords){
  const out=[];let prev=null;
  coords.forEach(([x,y])=>{const p=[r2(x),r2(y)];if(!prev||p[0]!==prev[0]||p[1]!==prev[1]){out.push(p);prev=p;}});
  return out.length>=4?out:null;
}
function geom(g){
  const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
  const out=polys.map(p=>p.map(ring).filter(Boolean)).filter(p=>p.length);
  return out.length?{type:'MultiPolygon',coordinates:out}:null;
}
// keep North America only: drop Hawaii-side / far-flung pieces nobody drives from
const inView=g=>{let ok=false;g.coordinates.forEach(p=>p[0].forEach(([x,y])=>{if(x>-170&&x<-50&&y>13&&y<75)ok=true;}));return ok;};

const features=[];
read('ne_admin1.json').features.forEach(f=>{
  const p=f.properties;if(p.iso_a2!=='US'&&p.iso_a2!=='CA')return;
  const g=geom(f.geometry);if(!g||!inView(g))return;
  features.push({type:'Feature',properties:{k:'state',c:p.iso_a2,code:p.postal||'',name:p.name},geometry:g});
});
read('ne_countries.json').features.forEach(f=>{
  if(f.properties.ADM0_A3!=='MEX')return;
  const g=geom(f.geometry);if(g)features.push({type:'Feature',properties:{k:'land',name:'Mexico'},geometry:g});
});
read('ne_lakes.json').features.forEach(f=>{
  const g=geom(f.geometry);if(!g||!inView(g))return;
  if((f.properties.scalerank||9)>3)return;                       // the big ones only
  features.push({type:'Feature',properties:{k:'lake',name:f.properties.name||''},geometry:g});
});
const out={type:'FeatureCollection',source:'Natural Earth 1:50m, public domain (naturalearthdata.com)',features};
const file=path.join(__dirname,'..','data','basemap.json');
fs.writeFileSync(file,JSON.stringify(out));
const n=k=>features.filter(f=>f.properties.k===k).length;
console.log('states/provinces:',n('state'),'| land:',n('land'),'| lakes:',n('lake'),'| size:',fs.statSync(file).size,'bytes');
