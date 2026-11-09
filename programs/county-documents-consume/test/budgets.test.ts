import {expect,test} from 'bun:test';
import {OperationBudget,reservationReceipt,positiveBudget} from '../src/budgets';

test('operation reservations charge full unknown bytes, credit actual wire only on completion, and use exact remaining PDF bytes',()=>{
 const budget=new OperationBudget({maxRequests:4,maxBytes:10,maxPdfBytes:6});
 expect(budget.reserve('pdf')).toBe(6);
 budget.complete(6,2);
 expect(budget.reserve('pdf')).toBe(6);
 expect(budget.reserve('pdf')).toBe(2);
 expect(()=>budget.reserve('pdf')).toThrow('operation');
 const unknown=new OperationBudget({maxRequests:4,maxBytes:10,maxPdfBytes:6});
 expect(unknown.reserve('pdf')).toBe(6);expect(unknown.reserve('pdf')).toBe(4);
 expect(()=>unknown.reserve('pdf')).toThrow('operation');
 const single=new OperationBudget({maxRequests:1,maxBytes:100,maxPdfBytes:6});
 expect(single.reserve('pdf')).toBe(6);expect(()=>single.reserve('pdf')).toThrow('operation');
 const metadata=new OperationBudget({maxRequests:10,maxBytes:1});
 expect(()=>metadata.reserve('page')).toThrow('operation');
 expect(positiveBudget(1,'test')).toBe(1);
});
test('versioned reservation evidence preserves exact legacy PDF caps and explicit new equal-budget boundaries',()=>{
 expect(reservationReceipt('pdf','pdf',5*1024*1024)).toBeNull();
 expect(()=>reservationReceipt('pdf','pdf',1)).toThrow('legacy');
 const budget=new OperationBudget({maxRequests:1,maxBytes:6,maxPdfBytes:6});
 const cap=budget.reserve('pdf'),receipt=budget.receipt('pdf',cap);
 expect(reservationReceipt(receipt,'pdf',cap)?.cap).toBe(6);
 expect(()=>reservationReceipt(receipt,'pdf',5)).toThrow('reservation');
});
test('budget boundaries reject zero, malformed limits, arbitrary legacy kind and later metadata overspend',()=>{
 for(const value of [0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null]) expect(()=>positiveBudget(value as any,'test')).toThrow();
 const one=new OperationBudget({maxRequests:1,maxBytes:1,maxPdfBytes:1});expect(one.reserve('pdf')).toBe(1);
 expect(reservationReceipt('page','page',3145728)).toBeNull();
 expect(reservationReceipt('robots','robots',3145728)).toBeNull();
 expect(()=>reservationReceipt('unknown-legacy','page',3145728)).toThrow('identity');
 const metadata=new OperationBudget({maxRequests:2,maxBytes:4194304});expect(metadata.reserve('page')).toBe(3145728);
 expect(()=>metadata.reserve('page')).toThrow('budget');
 const malformed='transport-work-v1:'+JSON.stringify({operation:crypto.randomUUID(),kind:'pdf',cap:1,limits:{}});
 expect(()=>reservationReceipt(malformed,'pdf',1)).toThrow('limits');
});
