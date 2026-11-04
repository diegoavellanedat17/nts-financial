import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch();
try {
 for(const person of ['diego','natalia']) {
  const page=await browser.newPage({viewport:{width:375,height:812},timezoneId:'America/Bogota'});
  await page.clock.install({time:new Date('2026-11-03T18:00:00-05:00')});
  await page.addInitScript(person=>{
   const base={kind:'expense',currency:'COP',context:'Personal',category:'Compras',description:'Compra',reserved:0,from_reserve:false,flow_type:'operating'};
   const items=[{...base,id:'oct',date:'2026-10-10',amount:500000},{...base,id:'nov',date:'2026-11-01',amount:250000.90,reference:'gmail:budget-test'},{...base,id:'office',date:'2026-11-01',amount:500000,context:'Consultorio',category:'Laboratorio'}];
   localStorage.setItem('natalia-access-v1',person);
   localStorage.setItem(`${person}-finances-v1`,JSON.stringify({items:person==='diego'?items.slice(0,2):items,budgets:{},sources:[{id:'source',name:'Personal',context:'Personal'}]}));
  },person);
  await page.goto(process.env.APP_URL||'http://127.0.0.1:4173');
  await expect(page.getByRole('region',{name:'Presupuesto personal por categoría',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Presupuesto',exact:true}).click();
  const area=page.getByRole('region',{name:'Presupuesto personal por categoría',exact:true});
  await area.getByRole('button',{name:'Crear presupuesto',exact:true}).click();
  await expect(area.getByRole('spinbutton',{name:'Tope de Hogar',exact:true})).toHaveValue(person==='diego'?'10.500.000':'4.300.000');
  await expect(area.getByText('Hogar · pagos fijos',{exact:true})).toHaveCount(0);
  const hogar=area.getByRole('spinbutton',{name:'Tope de Hogar',exact:true});
  await hogar.fill('6500000');
  await expect(hogar).toHaveValue('6.500.000');
  await hogar.fill('');
  await expect(hogar).toHaveAttribute('placeholder',person==='diego'?'10.500.000':'4.300.000');
  await hogar.fill(person==='diego'?'10500000':'4300000');
  await expect(hogar.locator('..').locator('[data-symbol]')).toHaveAttribute('data-symbol','$');
  await expect(area.getByRole('textbox',{name:'Detalle del presupuesto de Hogar'})).toHaveCount(0);
  const transactions=await page.evaluate(person=>localStorage.getItem(`${person}-finances-v1`),person);
  await area.getByRole('button',{name:'Guardar presupuesto',exact:true}).click();
  await expect(area.getByRole('status')).toHaveText('Presupuesto guardado.');
  const compras=area.getByRole('article').filter({has:page.getByRole('heading',{name:'Compras',exact:true})});
  await expect(compras).toContainText('$250.000,90 COP');
  if(person==='diego')await expect(compras).toContainText('Cerca del tope');
  await area.getByRole('button',{name:'Editar presupuesto',exact:true}).click();
  await area.getByRole('spinbutton',{name:'Tope de Compras',exact:true}).fill('200000');
  await area.getByRole('button',{name:'Guardar presupuesto',exact:true}).click();
  await expect(compras).toContainText('Te pasaste $50.000,90 COP');
  await expect(compras.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
  assert.equal(await page.evaluate(person=>localStorage.getItem(`${person}-finances-v1`),person),transactions,'Guardar presupuesto no toca movimientos');
  await page.reload();
  await page.getByRole('button',{name:'Presupuesto',exact:true}).click();
  await expect(compras).toContainText('Te pasaste $50.000,90 COP');
  await page.getByLabel('¿Qué mes quieres ver?').selectOption('2026-10');
  await expect(area.getByRole('button',{name:'Crear presupuesto',exact:true})).toBeVisible();
  await page.getByLabel('¿Qué mes quieres ver?').selectOption('2026-11');
  await expect(compras).toContainText('Te pasaste $50.000,90 COP');
  await area.getByRole('button',{name:'Editar presupuesto',exact:true}).click();
  await area.getByRole('spinbutton',{name:'Tope de Compras',exact:true}).fill('0');
  // Simulate a failed save; persisted values and the existing bars must stay unchanged.
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreStorage=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(k,v){if(k.includes('category-budget'))throw Error('No se pudo guardar.');return original.call(this,k,v);};});
  await area.getByRole('button',{name:'Guardar presupuesto',exact:true}).click();
  await expect(area.getByRole('alert')).toContainText('No se pudo guardar.');
  await page.evaluate(()=>window.restoreStorage());
  await area.getByRole('button',{name:'Guardar presupuesto',exact:true}).click();
  await expect(compras).toContainText('Te pasaste $250.000,90 COP');
  for(const width of [375,320]){await page.setViewportSize({width,height:812});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await area.screenshot({path:`artifacts/budgets-${person}.png`});
  await page.close();
 }
 console.log('Presupuestos: topes, exceso, tope cero, mes, persistencia, fallos de guardado y móvil verificados.');
}finally{await browser.close();}
