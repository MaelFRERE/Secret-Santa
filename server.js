import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const PORT=process.env.PORT||3000;
const ADMIN_CODE=process.env.ADMIN_CODE;
if(!ADMIN_CODE){console.error('Configurez ADMIN_CODE avant de demarrer.');process.exit(1)}
const file=path.resolve('data.json');
let db={participants:[],drawn:false};
try{db=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
const save=()=>{const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db));fs.renameSync(tmp,file)};
const send=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))};
const body=async req=>{let s='';for await(const chunk of req){s+=chunk;if(s.length>10000)throw Error('Requete trop longue')}return JSON.parse(s||'{}')};
const admin=(req)=>{const a=Buffer.from(String(req.headers['x-admin-code']||''));const b=Buffer.from(ADMIN_CODE);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const token=()=>crypto.randomBytes(24).toString('hex');
const shuffle=a=>{for(let i=a.length-1;i>0;i--){let j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const server=http.createServer(async(req,res)=>{try{
const url=new URL(req.url,'http://localhost');
if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{participants:db.participants.map(p=>p.name),drawn:db.drawn});
if(req.method==='POST'&&url.pathname==='/api/join'){
if(db.drawn)return send(res,409,{error:'Les inscriptions sont fermees.'});
const {name}=await body(req);const clean=String(name||'').trim().replace(/\s+/g,' ');
if(clean.length<2||clean.length>40)return send(res,400,{error:'Prenom entre 2 et 40 caracteres.'});
if(db.participants.some(p=>p.name.toLocaleLowerCase('fr')===clean.toLocaleLowerCase('fr')))return send(res,409,{error:'Ce prenom est deja inscrit. Ajoutez une initiale.'});
const p={name:clean,token:token(),recipient:null};db.participants.push(p);save();return send(res,200,{name:p.name,token:p.token});}
if(req.method==='POST'&&url.pathname==='/api/draw'){
if(!admin(req))return send(res,403,{error:'Code organisateur incorrect.'});
if(db.drawn)return send(res,409,{error:'Tirage deja effectue.'});
if(db.participants.length<2)return send(res,400,{error:'Il faut au moins deux participants.'});
const n=db.participants.length;const order=shuffle([...Array(n).keys()]);for(let i=0;i<n;i++)db.participants[order[i]].recipient=db.participants[order[(i+1)%n]].name;
db.drawn=true;save();return send(res,200,{ok:true});}
if(req.method==='POST'&&url.pathname==='/api/result'){
const {token:provided}=await body(req);const p=db.participants.find(p=>p.token===provided);
if(!p)return send(res,403,{error:'Lien personnel invalide.'});return send(res,200,{name:p.name,drawn:db.drawn,recipient:db.drawn?p.recipient:null});}
if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return fs.createReadStream(path.resolve('index.html')).pipe(res)}
return send(res,404,{error:'Page introuvable'});
}catch(e){return send(res,400,{error:'Requete invalide.'})}});
server.listen(PORT,()=>console.log(`Secret Santa sur http://localhost:${PORT}`));
