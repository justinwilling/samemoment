import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localDay,cameraDate} from '../day.js';
test('day selection follows local calendar across UTC midnight',()=>{
 const previous=process.env.TZ;process.env.TZ='Europe/Berlin';
 try {assert.equal(localDay('2026-07-08T22:30:00Z'),'2026-07-09');assert.equal(localDay('2026-01-08T23:30:00Z'),'2026-01-09');}
 finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('manual photo dates remain the chosen calendar day',()=>{
 for(const zone of ['Europe/Berlin','America/Los_Angeles','Pacific/Auckland']){
 const previous=process.env.TZ;process.env.TZ=zone;
 try{assert.equal(localDay(new Date(cameraDate('2026-03-29')).toISOString()),'2026-03-29');assert.equal(cameraDate(''),'');}
 finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
 }
});
