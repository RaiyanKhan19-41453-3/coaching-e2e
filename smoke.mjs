import crypto from 'node:crypto';
import { chromium } from '@playwright/test';
const KEY='dev-only-signing-key-change-this-in-production-1234';
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function tok(role){const h=b64({alg:'HS256',typ:'JWT'});const p=b64({sub:'a'.repeat(36),tenant_id:'452a490f-157a-4859-a73f-bd41ffda6e6f',email:'admin@star.local',role:[role],exp:Math.floor(Date.now()/1000)+7200,iss:'coaching-platform',aud:'coaching-web'});return `${h}.${p}.${crypto.createHmac('sha256',KEY).update(h+'.'+p).digest('base64url')}`;}
const admin=tok('Admin');
const MAIN_ROUTES=['/','/academics','/academics/courses','/academics/batches','/academics/enrollments','/scheduling','/scheduling/rules','/scheduling/rooms','/scheduling/leave','/timetable','/assessment','/assessment/assessments','/assessment/questions','/finance','/finance/fees','/finance/invoices','/finance/discounts','/finance/scholarships','/crm','/crm/leads','/crm/applications','/crm/follow-ups','/users','/communication','/communication/announcements','/messages','/reports','/files','/materials','/parent','/search','/notifications','/operations'];
const EXAM_ROUTES=['/','/exams','/assignments','/take','/reports','/proctor','/flags'];
const browser=await chromium.launch();
let failures=0;
for(const [base,tokenKey,routes] of [['http://localhost:13000','coaching-token',MAIN_ROUTES],['http://localhost:13010','exam-token',EXAM_ROUTES]]){
  const page=await browser.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(([k,t])=>localStorage.setItem(k,t),[tokenKey,admin]);
  for(const route of routes){
    await page.goto(base+route);
    await page.waitForTimeout(250);
    const h1=await page.locator('h1,h2').first().innerText().catch(()=>'(none)');
    const redirected=new URL(page.url()).pathname!==route;
    const ok=!redirected && errors.length===0;
    if(!ok)failures++;
    console.log(`${ok?'OK  ':'FAIL'} ${base}${route} -> ${h1}${redirected?' REDIRECTED':''}${errors.length?' ERR:'+errors[0]:''}`);
    errors.length=0;
  }
  await page.close();
}
await browser.close();
console.log(failures===0?'ALL ROUTES OK':`${failures} FAILURES`);
process.exit(failures?1:0);
