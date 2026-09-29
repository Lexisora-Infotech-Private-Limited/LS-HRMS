const fs=require('fs'),zlib=require('zlib'),path=require('path');
const [,,src,out]=process.argv;
const html=fs.readFileSync(src,'utf8');
const grab=t=>{const o="<script type=\"__bundler/"+t+"\">";const i=html.indexOf(o);if(i<0)return null;const j=html.indexOf("</script>",i+o.length);return JSON.parse(html.slice(i+o.length,j).trim())};
const manifest=grab('manifest'),template=grab('template'),ext=grab('ext_resources')||[];
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'template.html'),template);
const extMap=Object.fromEntries(ext.map(e=>[e.uuid,e.id]));
for(const [u,e] of Object.entries(manifest)){
  let b=Buffer.from(e.data,'base64'); if(e.compressed) b=zlib.gunzipSync(b);
  const ext2=(e.mime.split('/')[1]||'bin').replace(/[^a-z0-9]/gi,'_');
  const name=u+'.'+ext2;
  if(extMap[u]){console.log('EXT',extMap[u],e.mime,b.length);continue;}
  fs.writeFileSync(path.join(out,name),b);
  console.log(name,e.mime,b.length, template.includes(u)?'(in template)':'');
}
