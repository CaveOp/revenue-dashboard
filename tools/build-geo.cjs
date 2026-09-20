/* Builds the two lookup files the Guests page uses, so the page never looks anything up online.

     data/us-cities.json    city + state  ->  [lat, lng]        (United States and Canada)
     data/area-codes.json   area code     ->  [label, state, lat, lng]

   Run from a folder holding these downloads:
     cities500.txt, admin1CodesASCII.txt   https://download.geonames.org/export/dump/  (CC BY 4.0)
     ac.csv, ac_ca.csv                     area code -> cities it serves (public NANPA / CNA facts),
                                           used ONLY to pick each code's principal city. Coordinates
                                           always come from GeoNames, never from that list.

     node tools/build-geo.cjs <download-folder>
*/
const fs=require('fs'),path=require('path');
const src=process.argv[2];if(!src){console.error('usage: node tools/build-geo.cjs <download-folder>');process.exit(1);}
const outDir=path.join(__dirname,'..','data');fs.mkdirSync(outDir,{recursive:true});

// Must match normCity() in guests.html exactly.
function norm(s){
  return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
    .replace(/\bst\.?\s+/g,'saint ').replace(/\bste\.?\s+/g,'sainte ').replace(/\bmt\.?\s+/g,'mount ').replace(/\bft\.?\s+/g,'fort ')
    .replace(/[^a-z0-9]+/g,' ').trim();
}

// ---- states / provinces ----
const stateCode={};   // normalised full name -> 2-letter code
const CA_PROV={'01':'AB','02':'BC','03':'MB','04':'NB','05':'NL','07':'NS','08':'ON','09':'PE','10':'QC','11':'SK','12':'YT','13':'NT','14':'NU'};
fs.readFileSync(path.join(src,'admin1CodesASCII.txt'),'utf8').split('\n').forEach(l=>{
  const [code,name,ascii]=l.split('\t');if(!code)return;
  const [cc,a1]=code.split('.');
  if(cc==='US'){stateCode[norm(name)]=a1;stateCode[norm(ascii)]=a1;stateCode[a1.toLowerCase()]=a1;}
  if(cc==='CA'&&CA_PROV[a1]){stateCode[norm(name)]=CA_PROV[a1];stateCode[norm(ascii)]=CA_PROV[a1];stateCode[CA_PROV[a1].toLowerCase()]=CA_PROV[a1];}
});
stateCode['washington dc']='DC';stateCode['district of columbia']='DC';

// ---- cities ----
const cities={},pop={};   // cities[ST][normName]=[lat,lng]
fs.readFileSync(path.join(src,'cities500.txt'),'utf8').split('\n').forEach(l=>{
  const f=l.split('\t');if(f.length<15)return;
  const cc=f[8];if(cc!=='US'&&cc!=='CA')return;
  const st=cc==='US'?f[10]:CA_PROV[f[10]];if(!st)return;
  const p=parseInt(f[14])||0,ll=[Math.round(f[4]*1000)/1000,Math.round(f[5]*1000)/1000];
  [f[1],f[2]].forEach(n=>{const k=norm(n);if(!k)return;const id=st+'|'+k;
    if(pop[id]===undefined||p>pop[id]){pop[id]=p;(cities[st]=cities[st]||{})[k]=ll;}});
});
let nCities=0;Object.values(cities).forEach(o=>nCities+=Object.keys(o).length);
fs.writeFileSync(path.join(outDir,'us-cities.json'),JSON.stringify({source:'GeoNames cities500, CC BY 4.0 (geonames.org)',states:stateCode,cities}));

// ---- area codes ----
function csv(line){const out=[];let cur='',q=false;for(const ch of line){if(ch==='"'){q=!q;continue;}if(ch===','&&!q){out.push(cur);cur='';continue;}cur+=ch;}out.push(cur);return out;}
const byCode={};
['ac.csv','ac_ca.csv'].forEach(file=>{
  fs.readFileSync(path.join(src,file),'utf8').split('\n').forEach(l=>{
    if(!l.trim())return;const [code,city,state]=csv(l);
    if(!/^\d{3}$/.test(code))return;
    const st=stateCode[norm(state)];if(!st)return;
    const k=norm(city),ll=cities[st]&&cities[st][k];if(!ll)return;            // coordinates from GeoNames only
    (byCode[code]=byCode[code]||[]).push({city,st,ll,p:pop[st+'|'+k]||0});
  });
});
const areaCodes={};
Object.entries(byCode).forEach(([code,list])=>{
  list.sort((a,b)=>b.p-a.p);
  const top=list[0],second=list.find(x=>x.city!==top.city&&x.st===top.st);
  areaCodes[code]=[second?top.city+' / '+second.city:top.city,top.st,top.ll[0],top.ll[1]];
});
/* Codes added after the reference list was compiled. Each is an overlay: it serves exactly the
   same area as the older code beside it, so it takes that code's entry. Only overlays that are
   certain are listed; an unlisted code simply counts as "unknown" on the page, never as a guess. */
const OVERLAYS={'279':'916','341':'510','350':'209','369':'707','820':'805','840':'909','837':'530','738':'213',
  '445':'215','223':'717','332':'212','463':'317','564':'360','726':'210','838':'518','986':'208','680':'315','934':'631',
  '640':'609','659':'205','326':'937','447':'217','448':'850','464':'708','572':'405','582':'814','656':'813','728':'561',
  '771':'202','826':'540','839':'803','943':'404','945':'214','948':'757','983':'303','329':'845','363':'516','324':'904',
  '227':'301','283':'513','353':'608','472':'910','557':'314','645':'305','730':'618','861':'309','835':'610','975':'816','624':'716'};
/* Set by hand: the reference list leaves the principal city out of several codes (916 without
   Sacramento, 415 without San Francisco) and files some cities under the wrong code. These are
   the codes Cave Springs guests actually carry, plus the largest national metros.
   [label, state, city whose GeoNames coordinates anchor the bubble]
   530 and 541 each cover a huge area; they are anchored on the part nearest Dunsmuir (Redding,
   Medford) because that is where a guest with that code most plausibly drives from. */
const HAND={
  '209':['Stockton / Modesto','CA','Stockton'],'213':['Los Angeles','CA','Los Angeles'],'323':['Los Angeles','CA','Los Angeles'],
  '310':['West LA / South Bay','CA','Santa Monica'],'424':['West LA / South Bay','CA','Santa Monica'],
  '408':['San Jose / South Bay','CA','San Jose'],'669':['San Jose / South Bay','CA','San Jose'],
  '415':['San Francisco / Marin','CA','San Francisco'],'628':['San Francisco / Marin','CA','San Francisco'],
  '510':['Oakland / East Bay','CA','Oakland'],'341':['Oakland / East Bay','CA','Oakland'],
  '530':['Redding / Chico / far Northern CA','CA','Redding'],'837':['Redding / Chico / far Northern CA','CA','Redding'],
  '559':['Fresno / Central Valley','CA','Fresno'],'562':['Long Beach','CA','Long Beach'],
  '619':['San Diego','CA','San Diego'],'858':['San Diego','CA','San Diego'],'626':['Pasadena / San Gabriel Valley','CA','Pasadena'],
  '650':['Peninsula (San Mateo / Palo Alto)','CA','San Mateo'],'661':['Bakersfield / Santa Clarita','CA','Bakersfield'],
  '707':['Santa Rosa / North Bay & North Coast','CA','Santa Rosa'],'369':['Santa Rosa / North Bay & North Coast','CA','Santa Rosa'],
  '714':['Anaheim / Orange County','CA','Anaheim'],'657':['Anaheim / Orange County','CA','Anaheim'],
  '760':['Oceanside / Palm Springs','CA','Oceanside'],'442':['Oceanside / Palm Springs','CA','Oceanside'],
  '805':['Central Coast (Santa Barbara / Ventura)','CA','Santa Barbara'],'820':['Central Coast (Santa Barbara / Ventura)','CA','Santa Barbara'],
  '818':['San Fernando Valley','CA','Glendale'],'747':['San Fernando Valley','CA','Glendale'],
  '831':['Monterey / Santa Cruz','CA','Salinas'],'909':['Inland Empire','CA','San Bernardino'],'840':['Inland Empire','CA','San Bernardino'],
  '916':['Sacramento','CA','Sacramento'],'279':['Sacramento','CA','Sacramento'],'925':['Walnut Creek / Tri-Valley','CA','Concord'],
  '949':['Irvine / South Orange County','CA','Irvine'],'951':['Riverside','CA','Riverside'],
  '503':['Portland','OR','Portland'],'971':['Portland','OR','Portland'],
  '541':['Oregon outside Portland (Medford / Eugene / Bend)','OR','Medford'],'458':['Oregon outside Portland (Medford / Eugene / Bend)','OR','Medford'],
  '206':['Seattle','WA','Seattle'],'253':['Tacoma','WA','Tacoma'],'425':['Bellevue / Eastside','WA','Bellevue'],'509':['Spokane / Eastern WA','WA','Spokane'],
  '360':['Western WA (Olympia / Vancouver)','WA','Olympia'],'564':['Western WA (Olympia / Vancouver)','WA','Olympia'],
  '702':['Las Vegas','NV','Las Vegas'],'725':['Las Vegas','NV','Las Vegas'],'775':['Reno / Northern NV','NV','Reno'],
  '602':['Phoenix','AZ','Phoenix'],'480':['Scottsdale / East Valley','AZ','Scottsdale'],'520':['Tucson','AZ','Tucson'],
  '208':['Boise / Idaho','ID','Boise'],'986':['Boise / Idaho','ID','Boise'],'801':['Salt Lake City','UT','Salt Lake City'],'385':['Salt Lake City','UT','Salt Lake City'],
  '303':['Denver','CO','Denver'],'720':['Denver','CO','Denver'],'983':['Denver','CO','Denver'],'808':['Hawaii','HI','Honolulu'],'907':['Alaska','AK','Anchorage'],
  '212':['New York City','NY','New York City'],'646':['New York City','NY','New York City'],'917':['New York City','NY','New York City'],'332':['New York City','NY','New York City'],
  '718':['New York City','NY','New York City'],'347':['New York City','NY','New York City'],'929':['New York City','NY','New York City'],
  '312':['Chicago','IL','Chicago'],'773':['Chicago','IL','Chicago'],'872':['Chicago','IL','Chicago'],
  '214':['Dallas','TX','Dallas'],'469':['Dallas','TX','Dallas'],'972':['Dallas','TX','Dallas'],'945':['Dallas','TX','Dallas'],
  '713':['Houston','TX','Houston'],'281':['Houston','TX','Houston'],'832':['Houston','TX','Houston'],'346':['Houston','TX','Houston'],
  '512':['Austin','TX','Austin'],'737':['Austin','TX','Austin'],'202':['Washington DC','DC','Washington'],'771':['Washington DC','DC','Washington'],
  '617':['Boston','MA','Boston'],'857':['Boston','MA','Boston'],'305':['Miami','FL','Miami'],'786':['Miami','FL','Miami'],'645':['Miami','FL','Miami'],
  '404':['Atlanta','GA','Atlanta'],'678':['Atlanta','GA','Atlanta'],'470':['Atlanta','GA','Atlanta'],'943':['Atlanta','GA','Atlanta'],
  '215':['Philadelphia','PA','Philadelphia'],'267':['Philadelphia','PA','Philadelphia'],'445':['Philadelphia','PA','Philadelphia'],'612':['Minneapolis','MN','Minneapolis']
};
Object.entries(HAND).forEach(([code,[label,st,anchor]])=>{
  const ll=cities[st]&&cities[st][norm(anchor)];
  if(!ll)throw new Error('hand-set area code '+code+': no GeoNames coordinates for '+anchor+', '+st);
  areaCodes[code]=[label,st,ll[0],ll[1]];
});
let added=0;Object.entries(OVERLAYS).forEach(([n,o])=>{if(!areaCodes[n]&&areaCodes[o]){areaCodes[n]=areaCodes[o];added++;}});
fs.writeFileSync(path.join(outDir,'area-codes.json'),JSON.stringify({source:'Principal city per area code from public NANPA/CNA assignments; coordinates from GeoNames, CC BY 4.0',codes:areaCodes}));

console.log('cities:',nCities,'| area codes:',Object.keys(areaCodes).length,'(',added,'overlays added )');
['530','707','510','415','916','279','341','541','503','775','206'].forEach(c=>console.log(' ',c,JSON.stringify(areaCodes[c])));
console.log('sizes:',fs.statSync(path.join(outDir,'us-cities.json')).size,'bytes cities,',fs.statSync(path.join(outDir,'area-codes.json')).size,'bytes area codes');
