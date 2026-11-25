import crypto from 'node:crypto';
const KEY='dev-only-signing-key-change-this-in-production-1234';
const MAIN='http://localhost:18081', EXAM='http://localhost:18090';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function tok(sub,role,tenant){const h=b64({alg:'HS256',typ:'JWT'});const p=b64({sub,tenant_id:tenant,email:sub+'@attack.local',role:[role],exp:Math.floor(Date.now()/1000)+3600,iss:'coaching-platform',aud:'coaching-web'});return `${h}.${p}.${crypto.createHmac('sha256',KEY).update(h+'.'+p).digest('base64url')}`;}
const req=async(base,path,t,body,method)=>{const r=await fetch(base+path,{method:method??(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:body?JSON.stringify(body):undefined});const text=await r.text();return {status:r.status,text};};
const findings=[];
const denied=(n,r)=>{const ok=[401,403,404].includes(r.status);console.log(`${ok?'PASS':'VULN'} ${n} status=${r.status} ${r.text.slice(0,90)}`);if(!ok)findings.push(n);};
const ok=(n,r)=>{const good=r.status>=200&&r.status<300;console.log(`${good?'PASS':'VULN'} ${n} status=${r.status} ${r.text.slice(0,90)}`);if(!good)findings.push(n);};

const tenantA=crypto.randomUUID(), tenantB=crypto.randomUUID();
const adminA=tok('11111111-1111-1111-1111-111111111111','Admin',tenantA);
const adminB=tok('33333333-3333-3333-3333-333333333333','Admin',tenantB);
console.log('tenants',tenantA,tenantB);

// Cross-tenant finance/CRM/scheduling IDOR using real IDs from A.
const fee=await req(MAIN,'/api/fee-structures',adminA,{name:'A fee',amount:100,currency:'BDT',frequency:1,taxPercent:0,effectiveFrom:'2026-01-01'});
const feeId=JSON.parse(fee.text).id;
denied('main: cross-tenant fee installments', await req(MAIN,`/api/fee-structures/${feeId}/installments`,adminB,{studentId:crypto.randomUUID(),count:1,firstDueDate:'2026-02-01'}));
const lead=await req(MAIN,'/api/crm/leads',adminA,{firstName:'A',lastName:'Lead'});
const leadId=JSON.parse(lead.text).id;
denied('main: cross-tenant lead status', await req(MAIN,`/api/crm/leads/${leadId}/status`,adminB,{status:1}));
const room=await req(MAIN,'/api/rooms',adminA,{name:'A room',type:1,capacity:10});
const roomId=JSON.parse(room.text).id;
denied('main: cross-tenant room availability', await req(MAIN,`/api/rooms/${roomId}/availability`,adminB,{startUtc:'2026-01-01T00:00:00Z',endUtc:'2026-01-01T01:00:00Z'}));
const invoice=await req(MAIN,'/api/invoices',adminA,{studentId:crypto.randomUUID(),lines:[{description:'x',quantity:1,unitPrice:100,currency:'BDT'}],discount:0,taxPercent:0});
const invId=JSON.parse(invoice.text).id;
denied('main: cross-tenant payment', await req(MAIN,`/api/invoices/${invId}/payments`,adminB,{amount:1,currency:'BDT',method:1}));

// Exam: create exam in A, probe with B admin and with cross-tenant candidate.
const exam=await req(EXAM,'/api/exams',adminA,{title:'A exam',durationMinutes:30,totalMarks:1,requireCamera:false,requireMicrophone:false,lockTab:false,disableCopyPaste:false,aiEvaluationEnabled:false,requireIdentityVerification:false});
const examId=JSON.parse(exam.text).id;
await req(EXAM,`/api/exams/${examId}/questions`,adminA,{type:0,text:'Q',optionsJson:'[]',correctAnswerJson:'{"value":"a"}',marks:1,order:1});
await req(EXAM,`/api/exams/${examId}/publish`,adminA,null,'POST');
denied('exam: cross-tenant exam metadata', await req(EXAM,`/api/exams/${examId}/public`,adminB));
const cA=crypto.randomUUID(), cB=crypto.randomUUID();
const candidateA=tok(cA,'Student',tenantA), candidateB=tok(cB,'Student',tenantB);
const asgA=await req(EXAM,'/api/candidates/assign',adminA,{examId,candidateId:cA,candidateName:'A cand'});
const asg=JSON.parse(asgA.text);
await req(EXAM,`/api/candidate/consent?assignmentId=${asg.assignmentId}&accepted=true`,candidateA,null,'POST');
denied('exam: cross-tenant attempt token', await req(EXAM,`/api/attempts?examId=${examId}`,candidateB,{token:asg.attemptToken}));
const start=await req(EXAM,`/api/attempts?examId=${examId}`,candidateA,{token:asg.attemptToken});
ok('exam: own attempt start',start);
const attemptId=JSON.parse(start.text).attemptId;
const q=await req(EXAM,`/api/attempts/${attemptId}/questions`,candidateA);
const questionId=JSON.parse(q.text)[0].questionId;
// Cross-candidate: B (authenticated, different user) tries A's attempt.
denied('exam: cross-user answer write', await req(EXAM,`/api/attempts/${attemptId}/answers`,candidateB,{questionId,responseJson:'{"value":"a"}'}));
denied('exam: cross-user evidence read', await req(EXAM,`/api/evidence/attempts/${attemptId}`,candidateB));
denied('exam: cross-user proctor event', await req(EXAM,`/api/attempts/${attemptId}/events`,candidateB,{type:6,severity:5}));
denied('exam: cross-user report generate', await req(EXAM,`/api/attempts/${attemptId}/report`,candidateB,null,'POST'));
denied('exam: cross-user result', await req(EXAM,`/api/attempts/${attemptId}/result`,candidateB));
// Question from another exam must be rejected.
const other=await req(EXAM,'/api/exams',adminA,{title:'Other',durationMinutes:10,totalMarks:1,requireCamera:false,requireMicrophone:false,lockTab:false,disableCopyPaste:false,aiEvaluationEnabled:false,requireIdentityVerification:false});
const otherId=JSON.parse(other.text).id;
await req(EXAM,`/api/exams/${otherId}/questions`,adminA,{type:0,text:'Other Q',correctAnswerJson:'{}',marks:1,order:1});
const oq=await req(EXAM,`/api/exams/${otherId}/public`,adminA); // no questions exposed
// answer with random question id
denied('exam: foreign question answer', await req(EXAM,`/api/attempts/${attemptId}/answers`,candidateA,{questionId:crypto.randomUUID(),responseJson:'{}'}));
// reused token
await req(EXAM,`/api/attempts/${attemptId}/submit`,candidateA,null,'POST');
denied('exam: reused attempt token', await req(EXAM,`/api/attempts?examId=${examId}`,candidateA,{token:asg.attemptToken}));
// oversized evidence
const huge='A'.repeat(2*1024*1024+100);
const big=await req(EXAM,`/api/evidence/attempts/${attemptId}`,candidateA,{kind:0,contentType:'text/plain',sizeBytes:huge.length,checksum:null,detailJson:null,dataBase64:Buffer.from(huge).toString('base64')});
console.log('oversized evidence status',big.status,big.text.slice(0,100));
console.log('\nFINDINGS:',findings.length,findings.join(' | '));
process.exit(findings.length?1:0);
