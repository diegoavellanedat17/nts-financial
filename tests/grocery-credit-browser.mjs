import { chromium,expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch();
try {
 for(const person of ['diego','natalia']) {
  const page=await browser.newPage({viewport:{width:375,height:812},timezoneId:'America/Bogota'});
  await page.clock.install({time:new Date('2026-11-03T18:00:00-05:00')});
  await page.addInitScript(person=>{localStorage.setItem('natalia-access-v1',person);if(!localStorage.getItem(`${person}-finances-v1`))localStorage.setItem(`${person}-finances-v1`,JSON.stringify({items:[],budgets:{},sources:[{id:'source',name:'Personal',context:'Personal'}]}));},person);
  await page.goto(process.env.APP_URL||'http://127.0.0.1:4173');
  for(const category of ['Mercado','Tarjeta de crédito']){
   await page.getByRole('button',{name:person==='diego'?'Salida':'Pagué algo',exact:true}).click();
   const modal=page.getByRole('dialog');await modal.getByRole('spinbutton',{name:'Monto en pesos',exact:true}).fill('123000');
   await modal.getByRole('textbox',{name:'Concepto',exact:true}).fill(category==='Mercado'?'Mercado semanal':'Pago al banco');
   await modal.locator('select[name=category]').selectOption(category);
   if(category==='Tarjeta de crédito')await expect(modal).toContainText('no una compra hecha con tarjeta');
   await modal.getByRole('button',{name:'Guardar gasto',exact:true}).click();
   await expect(modal).toHaveCount(0);
  }
  const chart=page.getByRole('region',{name:'Gastos por categoría',exact:true});
  for(const category of ['Mercado','Tarjeta de crédito'])await expect(chart.getByRole('button',{name:`Ver gastos de ${category}`,exact:true})).toBeVisible();
  const budgets=page.getByRole('region',{name:'Presupuesto personal por categoría',exact:true});
  await budgets.getByRole('button',{name:'Crear presupuesto',exact:true}).click();
  await budgets.getByRole('spinbutton',{name:'Tope de Mercado',exact:true}).fill('200000');
  await budgets.getByRole('spinbutton',{name:'Tope de Tarjeta de crédito',exact:true}).fill('150000');
  await budgets.getByRole('button',{name:'Guardar presupuesto',exact:true}).click();
  await expect(budgets.getByRole('progressbar',{name:'Presupuesto de Mercado',exact:true})).toHaveAttribute('aria-valuetext',/123.000.*200.000/);
  await expect(budgets.getByRole('progressbar',{name:'Presupuesto de Tarjeta de crédito',exact:true})).toHaveAttribute('aria-valuetext',/123.000.*150.000/);
  await page.reload();await expect(chart.getByRole('button',{name:'Ver gastos de Mercado',exact:true})).toBeVisible();
  await page.setViewportSize({width:320,height:812});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.close();
 }
 console.log('Mercado y Tarjeta de crédito: registro, gráficos, topes, recarga y móvil verificados en ambos perfiles.');
}finally{await browser.close();}
