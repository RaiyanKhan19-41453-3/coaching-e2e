import crypto from 'node:crypto';
const KEY='dev-only-signing-key-change-this-in-production-1234';
const MAIN='http://localhost:18081', EXAM='http://localhost:18090';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function tok(sub,role,tenant,secret=KEY,extra={}){const h=b64({alg:'HS256',typ:'JWT'});const p=b64({sub,tenant_id:tenant,email:sub+'@attack.local',role:[role],exp:Math.floor(Date.now()/1000)+3600,iss:'coaching-platform',aud:'coaching-web',...extra});return `${h}.${p}.${crypto.createHmac('sha256',secret).update(h+'.'+p).digest('base64url')}`;}
const A_TENANT='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B_TENANT='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const admin=tok('11111111-1111-1111-1111-111111111111','Admin',A_TENANT);
const student=tok('22222222-2222-2222-2222-222222222222','Student',A_TENANT);
const adminB=tok('33333333-3333-3333-3333-333333333333','Admin',B_TENANT);
const wrongKey=tok('11111111-1111-1111-1111-111111111111','Admin',A_TENANT,'wrong-key');
const noneJwt=`${b64({alg:'none',typ:'JWT'})}.${b64({sub:'x',role:['Admin'],tenant_id:A_TENANT,exp:9999999999})}.`;
const findings=[];
const req=async(base,path,t,body,method,headers={})=>{const r=await fetch(base+path,{method:method??(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{}),...headers},body:body?JSON.stringify(body):undefined});const text=await r.text();return {status:r.status,text};};
const check=(name,ok,detail='')=>{console.log(`${ok?'PASS':'VULN'} ${name} ${detail}`);if(!ok)findings.push(name);};
const expectDenied=(name,r)=>check(name,r.status===401||r.status===403||r.status===404,`status=${r.status} ${r.text.slice(0,120)}`);
const expectOk=(name,r)=>check(name,r.status>=200&&r.status<300,`status=${r.status} ${r.text.slice(0,120)}`);

// --- AUTH ---
expectDenied('main: forged JWT (wrong key)', await req(MAIN,'/api/auth/me',wrongKey));
expectDenied('main: alg=none JWT', await req(MAIN,'/api/auth/me',noneJwt));
expectDenied('main: no token', await req(MAIN,'/api/auth/me'));
expectDenied('exam: forged JWT', await req(EXAM,'/api/exams',wrongKey,{title:'X',durationMinutes:1,totalMarks:1}));
expectDenied('exam: alg=none JWT', await req(EXAM,'/api/exams',noneJwt,{title:'X',durationMinutes:1,totalMarks:1}));
expectDenied('exam: no token', await req(EXAM,'/api/exams',null,{title:'X',durationMinutes:1,totalMarks:1}));
// X-Tenant-Id spoof must not override JWT claim
const lr=await fetch(MAIN+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@star.local',password:'Password123!',tenantSlug:'star-coaching'})});const realToken=(await lr.json()).accessToken;
const spoof=await req(MAIN,'/api/auth/me',realToken,null,'GET',{'X-Tenant-Id':B_TENANT});
check('main: header tenant spoof ignored', spoof.status===200 && !spoof.text.includes(B_TENANT), spoof.text.slice(0,120));

// --- RBAC ---
expectDenied('main: student creates course', await req(MAIN,'/api/courses',student,{code:'X',name:'X',level:1,durationMonths:1}));
expectDenied('main: student invites user', await req(MAIN,'/api/users/invite',student,{email:'x@x.local',firstName:'X',lastName:'X',roles:['Admin']}));
expectDenied('main: student assigns role', await req(MAIN,'/api/users/'+crypto.randomUUID()+'/roles',student,{role:'Admin'}));
expectDenied('main: student reads audit', await req(MAIN,'/api/reports/audit',student));
expectDenied('main: student lists users', await req(MAIN,'/api/users',student));
expectDenied('main: student creates lead', await req(MAIN,'/api/crm/leads',student,{firstName:'X',lastName:'Y'}));
expectDenied('main: wrong integration key', await req(MAIN,'/api/integrations/exam-results',null,{tenantId:A_TENANT,examId:crypto.randomUUID(),candidateIds:[],publishedCount:0},'POST',{'X-Integration-Key':'wrong'}));
expectDenied('exam: student creates exam', await req(EXAM,'/api/exams',student,{title:'X',durationMinutes:1,totalMarks:1}));
expectDenied('exam: student assigns candidate', await req(EXAM,'/api/candidates/assign',student,{examId:crypto.randomUUID(),candidateId:crypto.randomUUID(),candidateName:'X'}));
expectDenied('exam: student lists flags', await req(EXAM,'/api/proctor/exams/'+crypto.randomUUID()+'/flags',student));

// --- validation / injection ---
const inj="' OR 1=1 --";
const srch=await req(MAIN,'/api/reports/search?term='+encodeURIComponent(inj),admin);
check('main: injection in search handled', srch.status===200, srch.text.slice(0,120));
const badFee=await req(MAIN,'/api/fee-structures',admin,{name:'X',amount:-100,currency:'BDT',frequency:1,taxPercent:200,effectiveFrom:'2026-01-01'});
check('main: invalid fee rejected', badFee.status===400||badFee.status===409, badFee.text.slice(0,120));
const traversal=await req(MAIN,'/api/assets/upload-url',admin,{fileName:'../../etc/passwd',contentType:'text/plain',sizeBytes:10});
check('main: path traversal filename sanitized', traversal.status===200 && !traversal.text.includes('../'), traversal.text.slice(0,180));

// --- tenant isolation (create in A, read with B) ---
const course=await req(MAIN,'/api/courses',admin,{code:'T'+Date.now(),name:'Tenant A course',level:1,durationMonths:2});
const courseId=course.text.replace(/"/g,'');
const crossCourse=await req(MAIN,'/api/batches?search='+encodeURIComponent('Tenant A course'),adminB);
check('main: cross-tenant course hidden', crossCourse.status===200 && !crossCourse.text.includes('Tenant A course'), crossCourse.text.slice(0,120));
const assetA=await req(MAIN,'/api/assets/upload-url',admin,{fileName:'tenantA.txt',contentType:'text/plain',sizeBytes:5});
const assetId=JSON.parse(assetA.text).id;
expectDenied('main: cross-tenant asset URL', await req(MAIN,`/api/assets/${assetId}/url`,adminB));

// --- exam isolation / IDOR ---
const badToken=await req(EXAM,'/api/attempts?examId='+crypto.randomUUID(),student,{token:'deadbeef'});
expectDenied('exam: forged attempt token', badToken);
const crossAttempt=await req(EXAM,'/api/attempts/'+crypto.randomUUID()+'/answers',student,{questionId:crypto.randomUUID(),responseJson:'{}'});
expectDenied('exam: unknown attempt answer', crossAttempt);
const crossEvidence=await req(EXAM,'/api/evidence/attempts/'+crypto.randomUUID(),student);
expectDenied('exam: unknown attempt evidence', crossEvidence);
const crossReport=await req(EXAM,'/api/reports/'+crypto.randomUUID(),student);
expectDenied('exam: unknown report', crossReport);
const publishStudent=await req(EXAM,'/api/reports/exams/'+crypto.randomUUID()+'/publish',student,null,'POST');
expectDenied('exam: student publishes results', publishStudent);

// --- rate limit auth ---
let codes=[];
for(let i=0;i<110;i++) codes.push((await req(MAIN,'/api/auth/login',null,{email:'none@none.local',password:'x'})).status);
check('main: brute force rate limited', codes.includes(429), codes.join(','));

console.log('\nFINDINGS:', findings.length, findings.join(' | '));
process.exit(findings.length?1:0);
