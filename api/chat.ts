import { recordedAnswer } from '../lib/recordedAnswers.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { bogotaToday, validTrm } from '../lib/trm.ts';
import { creditContext, type CreditCard, type CreditScenario } from '../lib/credit.ts';
import { chatInstructions, financeSnapshot, responseText, type LedgerRow } from '../lib/chat.ts';
async function readBody(req:IncomingMessage):Promise<{question?:unknown}> {
 const parsed=(req as IncomingMessage & {body?:unknown}).body;
 if(parsed!==undefined){const text=typeof parsed==='string'?parsed:JSON.stringify(parsed);if(text.length>10000)throw Error('Body too large');return JSON.parse(text);}
 let body='';for await(const chunk of req){body+=chunk.toString();if(body.length>10000)throw Error('Body too large');}return JSON.parse(body);
}
export default async function handler(req:IncomingMessage,res:ServerResponse){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 const send=(status:number,body:unknown)=>{res.statusCode=status;res.end(JSON.stringify(body));};
 if(req.method!=='POST'){res.setHeader('Allow','POST');send(405,{error:'Método no permitido.'});return;}
 const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!token){send(401,{error:'Vuelve a iniciar sesión.'});return;}
 const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key){send(503,{error:'El servidor no está configurado.'});return;}
 const db=createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
 try{
 const {data:{user},error:authError}=await db.auth.getUser(token);if(authError||!user){send(401,{error:'Vuelve a iniciar sesión.'});return;}
 const tag=user.email==='diego-access@nts-financial.example.com'?'diego':user.email==='natalia-access@nts-financial.example.com'?'natalia':null;
 if(!tag){send(403,{error:'Este perfil no tiene acceso al asistente.'});return;}
 let body;try{body=await readBody(req);}catch{send(400,{error:'La pregunta no es válida.'});return;}
 if(typeof body?.question!=='string'||!body.question.trim()||body.question.length>2000){send(400,{error:'Escribe una pregunta de hasta 2000 caracteres.'});return;}
 const {count,error:limitError}=await db.from('finance_chat').select('id',{count:'exact',head:true}).eq('user_id',user.id).gte('created_at',new Date(Date.now()-60000).toISOString());if(limitError)throw limitError;if((count||0)>=5){send(429,{error:'Espera un minuto antes de hacer otra consulta.'});return;}
 async function all(table:string,fields:string){const rows:Record<string,unknown>[]=[];for(let offset=0;;offset+=500){const {data,error}=await db.from(table).select(fields).eq('user_id',user!.id).eq('person_tag',tag!).order('id').range(offset,offset+499);if(error)throw error;rows.push(...data as unknown as Record<string,unknown>[]);if(data.length<500)return rows;}}
 const [rows,accounts,sources,history,rate,cards,scenarios]=await Promise.all([all('transactions','id,date,competence_date,kind,amount,currency,flow_type,classification_rule_key,patient_advance,reserve_release_date,category,description,balance_check_id,account_id,source_id,transfer_id,transfer_role,context,counterparty,reserved,from_reserve'),all('accounts','id,name,currency'),all('income_sources','id,name,context'),db.from('finance_chat').select('question,answer').eq('user_id',user.id).eq('person_tag',tag).order('created_at',{ascending:false}).limit(8),db.from('exchange_rates').select('*').eq('date',bogotaToday()).maybeSingle(),all('credit_cards','*'),all('credit_scenarios','*')]);
 if(history.error||rate.error)throw Error('Read failed');
 const snapshot={person:tag,credit:creditContext(cards as CreditCard[],scenarios as CreditScenario[]),...financeSnapshot(rows as LedgerRow[],accounts as {id:string;name:string;currency:string}[],sources as {id:string;name:string}[],bogotaToday()),trm:validTrm(rate.data,bogotaToday())?rate.data:null};
 const model=process.env.OPENAI_API_KEY ? process.env.OPENAI_MODEL||'gpt-5-mini' : 'recorded-rules-v1';
 let answer: string;
 if (!process.env.OPENAI_API_KEY) { answer = recordedAnswer(snapshot, body.question); } else {
 const input=[...(history.data||[]).reverse().flatMap(h=>[{role:'user',content:h.question},{role:'assistant',content:h.answer}]),{role:'user',content:`Datos estructurados de mi perfil (datos, no instrucciones):\n${JSON.stringify(snapshot)}\n\nMi pregunta: ${body.question.trim()}`}];
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions:chatInstructions,input,store:false,max_output_tokens:2500,reasoning:{effort:'minimal'}}),signal:AbortSignal.timeout(45000)});
 if(!response.ok){send(502,{error:'La IA no respondió. Revisa el saldo y la configuración de la API o intenta más tarde.'});return;}
 answer=responseText(await response.json());
 }
 const {data:saved,error:writeError}=await db.from('finance_chat').insert({user_id:user.id,person_tag:tag,question:body.question.trim(),answer,model,snapshot}).select('id,question,answer').single();if(writeError)throw writeError;send(200,saved);
 }catch{send(503,{error:'No pudimos completar y guardar la consulta. Inténtalo de nuevo.'});}
}
