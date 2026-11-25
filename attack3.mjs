import crypto from 'node:crypto';
const KEY='dev-only-signing-key-change-this-in-production-1234';
const MAIN='http://localhost:18081', EXAM='http://localhost:18090';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function tok(sub,role,tenant,exp){const h=b64({alg:'HS256',typ:'JWT'});const p=b64({sub,tenant_id:tenant,email:sub+'@attack.local',role:[role],exp,iss:'coaching-platform',aud:'coaching-web'});return `${h}.${p}.${crypto.createHmac('sha256',KEY).update(h+'.'+p).digest('base64url')}`;}
const tenant=crypto.randomUUID();
const admin=tok('a'.repeat(36),'Admin',tenant,Math.floor(Date.now()/1000)+3600);
const student=tok('b'.repeat(36),'Student',tenant,Math.floor(Date.now()/1000)+3600);
const expired=tok('a'.repeat(36),'Admin',tenant,Math.floor(Date.now()/1000)-3600);
const req=async(base,path,t,body,method,raw)=>{const r=await fetch(base+path,{method:method??(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:raw??(body?JSON.stringify(body):undefined)});const text=await r.text();return {status:r.status,text};};
const findings=[];
const denied=(n,r)=>{const ok=[400,401,403,404,409,413,429].includes(r.status);console.log(`${ok?'PASS':'VULN'} ${n} status=${r.status} ${r.text.slice(0,90)}`);if(!ok)findings.push(n);};
const ok=(n,r)=>{const good=r.status>=200&&r.status<300;console.log(`${good?'PASS':'VULN'} ${n} status=${r.status} ${r.text.slice(0,90)}`);if(!good)findings.push(n);};

denied('expired JWT rejected', await req(MAIN,'/api/auth/me',expired));
denied('expired JWT rejected (exam)', await req(EXAM,'/api/exams',expired,{title:'X',durationMinutes:1,totalMarks:1}));
denied('malformed JSON body', await req(MAIN,'/api/courses',admin,undefined,'POST','{"code":'));
denied('malformed JSON body (exam)', await req(EXAM,'/api/exams',admin,undefined,'POST','{"title":'));
denied('invalid enum value', await req(MAIN,'/api/courses',admin,{code:'X',name:'X',level:999,durationMonths:1}));
denied('negative amount exam', await req(EXAM,'/api/exams',admin,{title:'X',durationMinutes:-5,totalMarks:1}));
denied('student cannot create exam question via exam API', await req(EXAM,'/api/exams/'+crypto.randomUUID()+'/questions',student,{type:0,text:'X',marks:1,order:1}));

// Race: many parallel enrolments into a capacity-1 batch (main).
const course=await req(MAIN,'/api/courses',admin,{code:'RACE'+Date.now().toString().slice(-5),name:'Race',level:1,durationMonths:2});
const courseId=JSON.parse(course.text).id;
// need academic year: derive from existing? create via API not available; use known year from previous data via batches list is not possible. Skip if no year.
const years=await req(MAIN,'/api/reports/dashboard',admin);
console.log('race prerequisite note: academic year created via seed only; testing via exam equivalent instead');

// Race: parallel report generation for same attempt (exam).
const exam=await req(EXAM,'/api/exams',admin,{title:'Race exam',durationMinutes:20,totalMarks:1,requireCamera:false,requireMicrophone:false,lockTab:false,disableCopyPaste:false,aiEvaluationEnabled:false,requireIdentityVerification:false});
const examId=JSON.parse(exam.text).id;
await req(EXAM,`/api/exams/${examId}/questions`,admin,{type:0,text:'Q',correctAnswerJson:'{"value":"a"}',marks:1,order:1});
await req(EXAM,`/api/exams/${examId}/publish`,admin,null,'POST');
const cid=crypto.randomUUID(), cand=tok(cid,'Student',tenant,Math.floor(Date.now()/1000)+3600);
const asg=JSON.parse((await req(EXAM,'/api/candidates/assign',admin,{examId,candidateId:cid,candidateName:'Racer'})).text);
await req(EXAM,`/api/candidate/consent?assignmentId=${asg.assignmentId}&accepted=true`,cand,null,'POST');
const attemptId=JSON.parse((await req(EXAM,`/api/attempts?examId=${examId}`,cand,{token:asg.attemptToken})).text).attemptId;
await req(EXAM,`/api/attempts/${attemptId}/submit`,cand,null,'POST');
const results=await Promise.all(Array.from({length:10},()=>req(EXAM,`/api/attempts/${attemptId}/report`,cand,null,'POST')));
const successes=results.filter(r=>r.status===200).length;
console.log('parallel report successes',successes,'statuses',results.map(r=>r.status).join(','));
const reports=await req(EXAM,`/api/reports?examId=${examId}`,admin);
if(successes!==10 || JSON.parse(reports.text).length!==1) findings.push('duplicate reports under race');
else console.log('PASS report race deduped');

// Exam rate limit: flood metadata requests with a valid token.
let codes=[];
for(let i=0;i<660;i++) codes.push((await req(EXAM,'/api/exams/'+crypto.randomUUID()+'/public',admin)).status);
const limited=codes.filter(c=>c===429).length;
console.log('exam rate-limit 429 count',limited);
if(limited===0) findings.push('exam rate limiting');

console.log('\nFINDINGS:',findings.length,findings.join(' | '));
process.exit(findings.length?1:0);
