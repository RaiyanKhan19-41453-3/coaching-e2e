import crypto from 'node:crypto';
import { chromium } from '@playwright/test';

const KEY='dev-only-signing-key-change-this-in-production-1234';
const MAIN='http://localhost:18081', EXAM='http://localhost:18090';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function tok(sub,role,tenant){const h=b64({alg:'HS256',typ:'JWT'});const p=b64({sub,tenant_id:tenant,email:sub+'@demo.local',role:[role],exp:Math.floor(Date.now()/1000)+7200,iss:'coaching-platform',aud:'coaching-web'});return `${h}.${p}.${crypto.createHmac('sha256',KEY).update(h+'.'+p).digest('base64url')}`;}
const api=async(base,path,t,body,method)=>{const r=await fetch(base+path,{method:method??(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:body?JSON.stringify(body):undefined});const x=await r.text();if(!r.ok)throw new Error(`${path} ${r.status} ${x.slice(0,150)}`);return x?JSON.parse(x):null;};
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:820},deviceScaleFactor:1});
const shot=(path)=>page.screenshot({path,fullPage:false});
const OUT=process.env.SHOT_DIR ?? '/shots';

// 1. Main login page
await page.goto('http://localhost:13000/');
await shot(`${OUT}/main-login.png`);

// 2. Main authenticated dashboard (login via UI)
await page.getByLabel('Email').fill('admin@star.local');
await page.getByLabel('Password').fill('Password123!');
await page.getByLabel('Tenant slug').fill('star-coaching');
await page.getByRole('button',{name:'Sign in'}).click();
await page.getByRole('heading',{name:'Live notifications'}).waitFor();
const admin=(await (await fetch(MAIN+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@star.local',password:'Password123!',tenantSlug:'star-coaching'})})).json()).accessToken;
await api(MAIN,'/api/communication/announcements',admin,{title:'Welcome to Coaching Platform',body:'Your dashboard is live.',targetAudienceJson:'{"roles":["Admin"]}',priority:1,isPinned:true});
await page.getByText('Welcome to Coaching Platform').waitFor({timeout:30000});
await shot(`${OUT}/main-dashboard.png`);

// 3. Main API docs
await page.goto(`${MAIN}/scalar/v1`);
await page.waitForTimeout(2500);
await shot(`${OUT}/main-api-docs.png`);

// 4. Exam entry
const tenant=(await (await fetch(MAIN+'/api/auth/me',{headers:{Authorization:'Bearer '+admin}})).json()).tenantId;
await page.goto('http://localhost:13010/');
await shot(`${OUT}/exam-entry.png`);

// 5. Exam candidate view (token inputs cleared before screenshot)
const exam=await api(EXAM,'/api/exams',admin,{title:'Mathematics Final',durationMinutes:60,totalMarks:10,requireCamera:false,requireMicrophone:false,lockTab:false,disableCopyPaste:false,aiEvaluationEnabled:true,requireIdentityVerification:false});
await api(EXAM,`/api/exams/${exam.id}/questions`,admin,{type:0,text:'What is 2 + 2?',optionsJson:'[{"id":"a","text":"3"},{"id":"b","text":"4"},{"id":"c","text":"5"}]',correctAnswerJson:'{"value":"b"}',marks:5,order:1});
await api(EXAM,`/api/exams/${exam.id}/questions`,admin,{type:4,text:'Explain the Pythagorean theorem in your own words.',marks:5,order:2});
await api(EXAM,`/api/exams/${exam.id}/publish`,admin,null,'POST');
const cid=crypto.randomUUID(), cand=tok(cid,'Student',tenant);
const asg=await api(EXAM,'/api/candidates/assign',admin,{examId:exam.id,candidateId:cid,candidateName:'Demo Candidate',candidateEmail:`${cid}@demo.local`});
await api(EXAM,`/api/candidate/consent?assignmentId=${asg.assignmentId}&accepted=true`,cand,null,'POST');
await page.locator('input[placeholder="eyJhbGci..."]').fill(cand);
await page.getByRole('button',{name:'Continue'}).click();
await page.locator('input[placeholder="Exam ID"]').fill(exam.id);
await page.locator('input[placeholder="Attempt token (from examiner)"]').fill(asg.attemptToken);
await page.locator('input[placeholder="Assignment ID"]').fill(asg.assignmentId);
await page.getByRole('button',{name:'Load'}).click();
await page.getByRole('button',{name:'Start exam'}).click();
await page.getByText('What is 2 + 2?').waitFor({timeout:20000});
// Clear tokens from visible inputs for a clean screenshot
await page.evaluate(()=>document.querySelectorAll('input').forEach(i=>{if(i.value.length>40)i.value='';}));
await shot(`${OUT}/exam-taking.png`);

// 6. Exam proctor live dashboard
const proctor=await browser.newPage({viewport:{width:1280,height:820}});
await proctor.goto('http://localhost:13010/');
await proctor.locator('input[placeholder="eyJhbGci..."]').fill(admin);
await proctor.getByRole('button',{name:'Continue'}).click();
await proctor.locator('input[placeholder="Exam ID"]').fill(exam.id);
await proctor.getByRole('button',{name:/live proctor/i}).click();
await proctor.waitForTimeout(2500);
await proctor.evaluate(()=>document.querySelectorAll('input').forEach(i=>{if(i.value.length>40)i.value='';}));
await proctor.screenshot({path:`${OUT}/exam-proctor.png`});
await proctor.close();

// 7. Exam API docs
await page.goto(`${EXAM}/scalar/v1`);
await page.waitForTimeout(2500);
await shot(`${OUT}/exam-api-docs.png`);

await browser.close();
console.log('screenshots captured');
