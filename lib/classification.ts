export const nataliaRules = [
 {rule_key:'personal_transport_v1',name:'Transporte personal',keywords:['didi','parqueadero','parqueo'],context:'Personal',category:'Transporte',priority:10},
 {rule_key:'gladys_home_v1',name:'Gladys, empleada de casa',keywords:['gladys'],context:'Personal',category:'Hogar',priority:20},
 {rule_key:'fan_home_v1',name:'Ventilador para casa',keywords:['ventilador'],context:'Personal',category:'Compras',priority:30},
] as const;
export function suggestedClassification(description:string,personTag:string){if(personTag!=='natalia')return null;const words=description.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9]+/);return nataliaRules.find(r=>r.keywords.some(k=>words.includes(k)))||null;}
