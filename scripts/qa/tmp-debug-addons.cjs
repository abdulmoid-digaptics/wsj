require('reflect-metadata');
const {plainToInstance} = require('class-transformer');
const {validateSync} = require('class-validator');
const {BookingDto} = require('../../backend/src/dto.ts');
function normal(){return {customerName:'QA Customer',customerEmail:'qa-booking@example.com',serviceType:'meeting-rooms',serviceName:'Meeting Room',bookingDate:'2026-11-04',bookingTime:'09:00',duration:60,guests:2,addOns:['Projector','Coffee'],subtotalPrice:50,totalPrice:50};}
for (const value of [{label:'Projector'}, null, 7, 'Projector', [{label:'Projector'}], [null], [7], ['Coffee',7], ['Coffee',null]]) {
  const dto = plainToInstance(BookingDto, {...normal(), addOns: value}, {enableImplicitConversion:true});
  console.log('value=', JSON.stringify(value), 'dto.addOns=', JSON.stringify(dto.addOns), 'isArray=', Array.isArray(dto.addOns));
  const errs = validateSync(dto, {whitelist:true, forbidNonWhitelisted:true});
  console.log('  errors:', errs.filter(e=>e.property==='addOns').map(e=>({constraints:e.constraints})));
}
