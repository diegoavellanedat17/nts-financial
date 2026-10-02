import { expect, it } from 'vitest';
import { transferFromBalance } from '../lib/transfers';
it('calcula salida real y diferencia TRM sin agregar otro débito',()=>{
 const result=transferFromBalance(2997,4.65,9700000,'USD','COP',3307.73);
 expect(result?.sent).toBe(2992.35);expect(result?.difference).toBe(197886);
 expect(result?.effectiveRate).toBeCloseTo(3241.6,1);
 expect(transferFromBalance(2997,4.65,9700000,'USD','COP',null)?.difference).toBeNull();
});
it('separa comisión explícita del diferencial y admite cambio favorable',()=>{
 expect(transferFromBalance(100,0,400000,'USD','COP',4000,2)?.difference).toBe(-8000);
 expect(transferFromBalance(400000,0,100,'COP','USD',4000)?.difference).toBe(0);
 expect(transferFromBalance(100,100,400000,'USD','COP',4000)).toBeNull();
 expect(transferFromBalance(100,-1,400000,'USD','COP',4000)).toBeNull();
 expect(transferFromBalance(100,0.001,400000,'USD','COP',4000)).toBeNull();
});
