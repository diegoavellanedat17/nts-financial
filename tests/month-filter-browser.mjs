import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch();
try {
  for (const person of ['natalia', 'diego']) {
    const page = await browser.newPage({ timezoneId: 'America/Bogota', viewport: { width: 375, height: 812 } });
    await page.clock.install({ time: new Date('2026-11-03T18:00:00-05:00') });
    await page.addInitScript(person => {
      const row = (id, date, amount, kind, category, description, context = 'Personal') => ({ id, date, amount, kind, category, description, context, currency: 'COP', reserved: 0, from_reserve: false, flow_type: 'operating' });
      const items = [row('old','2026-09-01',100000,'income','Otros','Ingreso septiembre'), row('oct-in','2026-10-01',200000,'income','Otros','Ingreso octubre'), row('oct-out','2026-10-29',40000,'expense','Compras','Compra octubre'), row('nov-out','2026-11-01',10000,'expense','Alimentación','Compra noviembre')];
      if (person === 'natalia') items.push(row('office','2026-10-15',20000,'expense','Laboratorio','Laboratorio octubre','Consultorio'));
      localStorage.setItem('natalia-access-v1', person);
      localStorage.setItem(`${person}-finances-v1`, JSON.stringify({ items, budgets: {}, sources: [{ id:'source',name:'Personal',context:'Personal' }] }));
    }, person);
    await page.goto(process.env.APP_URL || 'http://127.0.0.1:4173');
    await page.getByRole('heading', { name: 'Movimientos', exact: true }).waitFor();
    await page.getByRole('group', { name: 'Moneda del saldo', exact: true }).getByRole('button', { name:'COP', exact:true }).click();
    const cash = await page.locator('.daily-balance h1').textContent();
    await expect(page.locator('.recent-list')).toContainText('Compra noviembre');
    await expect(page.locator('.recent-list')).not.toContainText('Compra octubre');
    await page.getByRole('button', {name:'Mes anterior',exact:true}).click();
    await expect(page.getByLabel('¿Qué mes quieres ver?')).toHaveValue('2026-10');
    await expect(page.locator('.income-total').first()).toContainText('200.000');
    await expect(page.locator('.expense-total').first()).toContainText(person==='natalia'?'60.000':'40.000');
    assert.equal(await page.locator('.daily-balance h1').textContent(), cash, 'El saldo de hoy no cambia al elegir octubre.');
    await expect(page.locator('.recent-list')).toContainText('Compra octubre');
    await expect(page.locator('.recent-list')).not.toContainText('Compra noviembre');
    const chart=page.getByRole('region',{name:'Gastos por categoría',exact:true});
    await chart.getByRole('button',{name:'Ver gastos de Compras',exact:true}).click();
    await expect(chart.locator('.category-detail')).toContainText('Compra octubre');
    await expect(chart.locator('.category-detail')).not.toContainText('Compra noviembre');
    if(person==='natalia') {
      await expect(page.locator('.office-totals')).toContainText('20.000');
      await chart.getByRole('button',{name:'Ver gastos del consultorio',exact:true}).click();
      await expect(chart.getByRole('img')).toHaveAttribute('aria-label',/Laboratorio.*20\.000/);
    }
    await page.getByRole('button',{name:'Tabla',exact:true}).click();
    await expect(page.locator('.movements-table')).toContainText('Compra octubre');
    await expect(page.locator('.movements-table')).not.toContainText('Compra noviembre');
    await page.getByRole('navigation',{name:'Espacio de finanzas'}).getByRole('button',{name:'General',exact:true}).click();
    await expect(page.getByLabel('¿Qué mes quieres ver?')).toHaveValue('2026-10');
    await page.getByRole('navigation',{name:'Espacio de finanzas'}).getByRole('button',{name:'Mi dinero',exact:true}).click();
    for(const width of [375,320]) {
      await page.setViewportSize({width,height:812});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Selector legible sin desbordamiento');
    }
    await page.screenshot({path:`artifacts/month-filter-${person}.png`,fullPage:true});
    await page.getByLabel('¿Qué mes quieres ver?').selectOption('2026-08');
    await expect(page.locator('.recent-section')).toContainText('No hay movimientos registrados en agosto de 2026');
    await page.getByRole('button',{name:'Volver al mes actual',exact:true}).click();
    await expect(page.getByLabel('¿Qué mes quieres ver?')).toHaveValue('2026-11');
    await expect(page.getByRole('button',{name:'Mes siguiente',exact:true})).toBeDisabled();
    await expect(chart.locator('.category-detail')).toHaveCount(0);
    await page.close();
  }
  console.log('Filtro mensual: octubre/noviembre, ambos perfiles, gráficos, tabla, General y móvil verificados.');
} finally { await browser.close(); }
