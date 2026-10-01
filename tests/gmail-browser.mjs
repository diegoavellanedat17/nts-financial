import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
const origin='http://127.0.0.1:4174';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4174','--strictPort'],{stdio:'ignore',env:{...process.env,VITE_SUPABASE_URL:'https://gmail-test.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'test-publishable-key',VITE_GOOGLE_GMAIL_CLIENT_ID:'test.apps.googleusercontent.com',VITE_GOOGLE_GMAIL_ACCOUNT:'personal@example.com'}});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}await setTimeout(200);if(i===99)throw new Error('Vite Gmail no respondió.');}
 browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:375,height:812}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const uid='11111111-1111-4111-8111-111111111111';
 const source={id:'33333333-3333-4333-8333-333333333333',name:'Otro ingreso',context:'Personal'};
 const user={id:uid,email:'diego-access@nts-financial.example.com',aud:'authenticated',role:'authenticated',created_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{}};
 const jwt=`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:uid,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),aud:'authenticated',role:'authenticated'})).toString('base64url')}.test`;
 const movements=[];const receipts=[];let rpcCalls=0;
 await page.route('https://gmail-test.supabase.co/**',async route=>{
  const url=new URL(route.request().url());
  let data=[];
  if(url.pathname==='/auth/v1/token')data={access_token:jwt,refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user};
  else if(url.pathname==='/auth/v1/user')data=user;
  else if(url.pathname==='/rest/v1/income_sources')data=[source];
  else if(url.pathname==='/rest/v1/transactions')data=movements;
  else if(url.pathname==='/rest/v1/gmail_imports')data=receipts;
  else if(url.pathname==='/rest/v1/rpc/import_gmail_movement'){
   rpcCalls++;
   const payload=route.request().postDataJSON();
   if(receipts.some(r=>r.message_id===payload.p_email.messageId))data={duplicate:true};
   else{const transaction={...payload.p_movement,user_id:uid,id:`44444444-4444-4444-8444-${String(rpcCalls).padStart(12,'0')}`};movements.push(transaction);receipts.push({message_id:payload.p_email.messageId});data={duplicate:false,transaction};}
  }
  await route.fulfill({json:data});
 });
 await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'text/javascript',body:`window.google={accounts:{oauth2:{initTokenClient(config){return {requestAccessToken(){config.callback({access_token:'test-gmail-token',expires_in:3600,scope:config.scope});}}},hasGrantedAllScopes(){return true},revoke(token,callback){callback({successful:true})}}}};`}));
 let wrongAccount=true;let mailRequests=0;
 const day=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
 const received=String(Date.parse(`${day}T10:00:00-05:00`));
 await page.route('https://gmail.googleapis.com/**',async route=>{
  assert.equal(route.request().headers().authorization,'Bearer test-gmail-token');
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/profile'))return route.fulfill({json:{emailAddress:wrongAccount?'wrong@example.com':'personal@example.com'}});
  mailRequests++;
  if(url.pathname.endsWith('/messages'))return route.fulfill({json:{messages:[{id:'a1'},{id:'b2'}]}});
  const incoming=url.pathname.endsWith('/b2');
  await route.fulfill({json:{id:incoming?'b2':'a1',internalDate:received,payload:{mimeType:'text/plain',headers:[{name:'Subject',value:incoming?'Pago recibido':'Compra realizada'},{name:'From',value:'Banco <avisos@example.com>'}],body:{data:Buffer.from(incoming?'Payment received USD 150.25':'Compraste COP 50.000 en Mercado').toString('base64url')}}}});
 });
 await page.goto(origin);
 await page.getByLabel('Clave de acceso').fill('123456');await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await page.getByRole('button',{name:'Revisar Gmail',exact:true}).click();
 await page.getByRole('button',{name:'Conectar Gmail y revisar'}).click();
 await page.getByRole('alert').filter({hasText:'Conectaste otra cuenta'}).waitFor();assert.equal(mailRequests,0);
 wrongAccount=false;
 await page.getByRole('button',{name:'Conectar Gmail y revisar'}).click();
 await page.getByText('2 avisos encontrados.',{exact:false}).waitFor();
 assert.equal(rpcCalls,0,'Buscar no guarda movimientos');
 const cards=page.locator('.gmail-candidate');assert.equal(await cards.count(),2);
 assert.equal(await cards.first().getByLabel('Monto',{exact:true}).inputValue(),'50000');
 await cards.first().getByLabel('Concepto',{exact:true}).fill('Mercado desde Gmail');
 await cards.first().getByRole('button',{name:'Confirmar y guardar'}).click();
 await page.getByText('Ya importado: Compra realizada',{exact:true}).waitFor();
 await page.locator('.gmail-candidate').getByRole('button',{name:'Confirmar y guardar'}).click();
 await page.getByText('Ya importado: Pago recibido',{exact:true}).waitFor();assert.equal(rpcCalls,2);
 await page.getByRole('button',{name:'Revisar movimientos',exact:true}).click();
 await page.getByText('2 avisos encontrados.',{exact:false}).waitFor();assert.equal(await page.locator('.gmail-candidate').count(),0);assert.equal(rpcCalls,2);
 await page.getByRole('button',{name:'Cerrar',exact:true}).click();
 assert.match(await page.locator('.expense-total').textContent(),/50\.000/);
 await page.getByRole('button',{name:'USD',exact:true}).click();assert.match(await page.locator('.income-total').textContent(),/150,25/);
 await page.getByRole('button',{name:'Revisar Gmail',exact:true}).click();
 await page.getByRole('button',{name:'Conectar Gmail y revisar'}).click();await page.getByText('2 avisos encontrados.',{exact:false}).waitFor();
 for(const width of [375,320]){await page.setViewportSize({width,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.screenshot({path:'artifacts/gmail-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Desconectar Gmail'}).click();await page.getByText('Gmail desconectado.',{exact:false}).waitFor();assert.equal(movements.length,2);
 assert.deepEqual(errors,[]);
 console.log('OK Gmail: cuenta correcta, revisión antes de guardar, COP/USD, referencias, reintento sin duplicados, desconexión y móvil 320/375. APIs simuladas; no se leyeron correos reales.');
}finally{await browser?.close();server.kill('SIGTERM');}
