// ANNIHILATION SUITE — fuzzing, payload bombs, header abuse and concurrency storms.
import crypto from 'node:crypto';
const KEY='dev-only-signing-key-change-this-in-production-1234';
const MAIN='http://localhost:18081', EXAM='http://localhost:18090';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function tok(sub,role,tenant,extra={}){const h=b64({alg:'HS256',typ:'JWT'});const p=b64({sub,tenant_id:tenant,email:sub+'@chaos.local',role:[role],exp:Math.floor(Date.now()/1000)+3600,iss:'coaching-platform',aud:'coaching-web',...extra});return `${h}.${p}.${crypto.createHmac('sha256',KEY).update(h+'.'+p).digest('base64url')}`;}
const tenant=crypto.randomUUID();
const admin=tok('a'.repeat(36),'Admin',tenant), teacher=tok('b'.repeat(36),'Teacher',tenant), student=tok('c'.repeat(36),'Student',tenant);
const findings=[]; let requests=0, serverErrors=[];
const req=async(base,path,t,body,method,headers={},raw)=>{
  requests++;
  try {
    const r=await fetch(base+path,{method:method??(body!==undefined?'POST':'GET'),headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{}),...headers},body:raw??(body!==undefined?(typeof body==='string'?body:JSON.stringify(body)):undefined)});
    const text=await r.text();
    if(r.status>=500) serverErrors.push(`${r.status} ${path} ${text.slice(0,80)}`);
    return {status:r.status,text};
  } catch(e) { return {status:0,text:String(e)}; }
};
const no500=(label)=>{ if(serverErrors.length){ console.log('VULN',label,'server errors:',serverErrors.slice(0,5)); findings.push(label+' 5xx'); serverErrors=[]; } else console.log('PASS',label,'no 5xx'); };
const expect=(label,r,codes)=>{ const ok=codes.includes(r.status); if(!ok)findings.push(label); console.log(`${ok?'PASS':'VULN'} ${label} status=${r.status} ${r.text.slice(0,80)}`); };

// ---- 1. JWT claim abuse ----
expect('wrong audience rejected', await req(MAIN,'/api/auth/me',tok('a'.repeat(36),'Admin',tenant,{aud:'evil'}),undefined,'GET'),[401]);
expect('wrong issuer rejected', await req(MAIN,'/api/auth/me',tok('a'.repeat(36),'Admin',tenant,{iss:'evil'}),undefined,'GET'),[401]);
expect('tenant_id as object rejected', await req(MAIN,'/api/auth/me',tok('a'.repeat(36),'Admin',{id:tenant}),undefined,'GET'),[401,403]);
expect('role as string rejected', await req(MAIN,'/api/auth/me',tok('a'.repeat(36),'Admin',tenant,{role:'Admin'}),undefined,'GET'),[401,403]);
expect('duplicate sub rejected or scoped', await req(MAIN,'/api/auth/me',tok('a'.repeat(36),'Admin',tenant,{sub:'x'}),undefined,'GET'),[401,403,404]);
expect('exam wrong audience rejected', await req(EXAM,'/api/exams',tok('a'.repeat(36),'Admin',tenant,{aud:'evil'}),{title:'X',durationMinutes:1,totalMarks:1}),[401]);
expect('exam tenant object rejected', await req(EXAM,'/api/exams',tok('a'.repeat(36),'Admin',{id:tenant}),{title:'X',durationMinutes:1,totalMarks:1}),[401,403]);

// ---- 2. Fuzz bodies across endpoints ----
const garbage=['', 'null','[]','123','true','{}','{"a":','{'.repeat(200)+'['.repeat(50), '"'+'\\u0000'.repeat(20)+'"', '{"x":"'+'A'.repeat(1000000)+'"}'];
const mainPaths=[['/api/courses',admin],['/api/batches',admin],['/api/fee-structures',teacher],['/api/crm/leads',teacher],['/api/communication/announcements',teacher],['/api/assets/upload-url',teacher]];
for(const [path,t] of mainPaths) for(const g of garbage) await req(MAIN,path,t,g,'POST');
const examPaths=[['/api/exams',admin],['/api/candidates/assign',admin],['/api/attempts',student]];
for(const [path,t] of examPaths) for(const g of garbage) await req(EXAM,path,t,g,'POST');
no500('fuzzed JSON bodies');

// ---- 3. Path/query chaos ----
const weirdIds=['null','undefined','0','-1','not-a-guid','%00','..','..%2f..%2fetc%2fpasswd','🔥','a'.repeat(3000)];
for(const id of weirdIds){
  await req(MAIN,`/api/assets/${id}/url`,admin,undefined,'GET');
  await req(MAIN,`/api/reports/audit?entityName=${encodeURIComponent(id)}`,admin,undefined,'GET');
  await req(MAIN,`/api/reports/search?term=${encodeURIComponent(id)}`,admin,undefined,'GET');
  await req(EXAM,`/api/exams/${id}/public`,admin,undefined,'GET');
  await req(EXAM,`/api/attempts/${id}/questions`,student,undefined,'GET');
  await req(EXAM,`/api/reports/${id}`,admin,undefined,'GET');
}
no500('fuzzed path and query values');

// ---- 4. Header / CORS abuse ----
const origin='https://evil.example';
const cors=await req(MAIN,'/api/auth/me',admin,undefined,'GET',{Origin:origin});
const allow=cors.text && (await (await fetch(MAIN+'/api/auth/me',{headers:{Authorization:'Bearer '+admin,Origin:origin}})).headers.get('access-control-allow-origin'));
expect('CORS does not reflect arbitrary origin', allow===null||allow!==origin?{status:200,text:'no-reflect'}:{status:403,text:allow||''},[200]);
const smug=await req(MAIN,'/api/courses',student,{code:'S'+Date.now().toString().slice(-6),name:'smuggled',level:1,durationMonths:1},'POST',{'X-Forwarded-For':'1.2.3.4','X-Original-URL':'/api/users/invite','X-Rewrite-URL':'/api/users/invite'});
expect('header smuggling cannot escalate', smug,[403]);
no500('header and CORS abuse');

// ---- 5. Content-type confusion ----
for(const ct of ['text/plain','application/x-www-form-urlencoded','multipart/form-data; boundary=x','application/xml']){
  await req(MAIN,'/api/courses',admin,'{"code":"X","name":"X"}','POST',{'Content-Type':ct});
  await req(EXAM,'/api/exams',admin,'{"title":"X"}','POST',{'Content-Type':ct});
}
no500('content-type confusion');

// ---- 6. Concurrency storms ----
const code='STORM'+Date.now().toString().slice(-6);
const creates=await Promise.all(Array.from({length:30},()=>req(MAIN,'/api/courses',admin,{code,name:'Storm',level:1,durationMonths:1})));
const okCreates=creates.filter(r=>r.status===200).length, conflicts=creates.filter(r=>r.status===409).length;
console.log('course storm: ok',okCreates,'conflicts',conflicts,'statuses',creates.map(r=>r.status).join(','),'sample',creates[0].text.slice(0,200));
if(okCreates!==1||conflicts!==29) findings.push('course uniqueness race');
const examE=await req(EXAM,'/api/exams',admin,{title:'Storm exam',durationMinutes:30,totalMarks:1,requireCamera:false,requireMicrophone:false,lockTab:false,disableCopyPaste:false,aiEvaluationEnabled:false,requireIdentityVerification:false});
const examId=JSON.parse(examE.text).id;
await req(EXAM,`/api/exams/${examId}/questions`,admin,{type:0,text:'Q',correctAnswerJson:'{"value":"a"}',marks:1,order:1});
await req(EXAM,`/api/exams/${examId}/publish`,admin,null,'POST');
const cid=crypto.randomUUID(), cand=tok(cid,'Student',tenant);
const asg=JSON.parse((await req(EXAM,'/api/candidates/assign',admin,{examId,candidateId:cid,candidateName:'Storm'})).text);
await req(EXAM,`/api/candidate/consent?assignmentId=${asg.assignmentId}&accepted=true`,cand,null,'POST');
const starts=await Promise.all(Array.from({length:25},()=>req(EXAM,`/api/attempts?examId=${examId}`,cand,{token:asg.attemptToken})));
const okStarts=starts.filter(r=>r.status===200).length;
console.log('attempt-token storm: ok',okStarts,'others',starts.filter(r=>r.status!==200).map(r=>r.status).join(','));
if(okStarts!==1) findings.push('attempt token race');
no500('concurrency storms');

// ---- 7. Replay floods ----
const replays=await Promise.all(Array.from({length:25},()=>req(MAIN,'/api/integrations/exam-results',null,{tenantId:tenant,examId:crypto.randomUUID(),candidateIds:[],publishedCount:0},'POST',{'X-Integration-Key':'dev-integration-key'})));
if(replays.some(r=>r.status>=500)) findings.push('webhook replay 5xx');
console.log('webhook replay statuses', [...new Set(replays.map(r=>r.status))].join(','));
no500('replay flood');

console.log('\nTOTAL REQUESTS:',requests);
console.log('FINDINGS:',findings.length,findings.join(' | '));
process.exit(findings.length?1:0);
