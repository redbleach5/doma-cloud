import fs from 'fs';
const p='c:/Users/User/Desktop/doma-cloud-main/src/components/cloud/file-preview-body.tsx';
const a=fs.readFileSync(p,'utf8').split('\n');
for(let i=70;i<92;i++)console.log(i,JSON.stringify(a[i]));