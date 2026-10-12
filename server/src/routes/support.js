import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { digest } from '../lib/publicDtos.js';
import { parse,notFound } from '../lib/errors.js';
import { linkGuard } from '../lib/rateLimit.js';
const topics=['booking','checkin','transfer','other'];
const messageSchema=z.object({text:z.string().trim().min(1).max(2000),key:z.string().uuid()});
const include={messages:{orderBy:[{createdAt:'asc'},{id:'asc'}]}};
const guestOut=t=>({topic:t.topic,messages:t.messages.map(m=>({sender:m.sender==='guest'?'guest':'support',text:m.text,createdAt:m.createdAt}))});
async function addMessage(thread,sender,authorId,data){
 await prisma.$transaction(async tx=>{await tx.supportMessage.upsert({where:{threadId_operationKey:{threadId:thread.id,operationKey:data.key}},create:{threadId:thread.id,sender,authorId,text:data.text,operationKey:data.key},update:{}});await tx.supportThread.update({where:{id:thread.id},data:{updatedAt:new Date()}});});
 return prisma.supportThread.findUnique({where:{id:thread.id},include});
}
export function guestSupportRouter({config}){
 const r=Router();r.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();});
 const writes=linkGuard({max:30,badMax:10,windowMin:5});
 const own=async req=>{const token=req.get('X-Support-Token')||'';if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw notFound('Обращение не найдено');const t=await prisma.supportThread.findFirst({where:{accountId:req.accountId,accessHash:digest(token)},include});if(!t)throw notFound('Обращение не найдено');return t;};
 r.post('/',writes,async(req,res)=>{
  const d=parse(messageSchema.extend({topic:z.enum(topics)}),req.body);
  const token=crypto.createHmac('sha256',config.publicAccessSecret||config.jwtSecret).update(JSON.stringify(['support-access-v1',req.accountId,d.key])).digest('base64url');
  const t=await prisma.supportThread.upsert({where:{accessHash:digest(token)},create:{accountId:req.accountId,accessHash:digest(token),topic:d.topic,messages:{create:{sender:'guest',text:d.text,operationKey:d.key}}},update:{},include});
  res.status(201).json({...guestOut(t),token});
 });
 r.get('/',async(req,res)=>res.json(guestOut(await own(req))));
 r.post('/messages',writes,async(req,res)=>{const t=await own(req),d=parse(messageSchema,req.body);res.status(201).json(guestOut(await addMessage(t,'guest',null,d)));});
 return r;
}
export function adminSupportRouter(){
 const r=Router();
 r.get('/support',async(req,res)=>{const list=await prisma.supportThread.findMany({where:{accountId:req.accountId},orderBy:{updatedAt:'desc'},take:100,include:{messages:{orderBy:{createdAt:'desc'},take:1}}});res.json(list.map(t=>({id:t.id,topic:t.topic,updatedAt:t.updatedAt,lastMessage:t.messages[0]?.text||'',lastSender:t.messages[0]?.sender||'guest'})));});
 const own=async req=>{const t=await prisma.supportThread.findFirst({where:{id:req.params.id,accountId:req.accountId},include});if(!t)throw notFound('Обращение не найдено');return t;};
 r.get('/support/:id',async(req,res)=>{const t=await own(req);res.json({id:t.id,...guestOut(t)});});
 r.post('/support/:id/messages',async(req,res)=>{const t=await own(req),d=parse(messageSchema,req.body);res.status(201).json(guestOut(await addMessage(t,req.role,req.user.id,d)));});
 return r;
}
