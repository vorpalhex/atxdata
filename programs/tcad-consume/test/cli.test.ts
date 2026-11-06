import {test,expect} from 'bun:test';import {run} from '../src/cli';
test('offline CLI has explicit supported selection and no network mode',async()=>{
 expect(await run(['list'])).toMatchObject({selection:'2026-certified-supp0-property-first25',rows:25,network:false});await expect(run(['sync'])).rejects.toThrow();await expect(run(['import','--selection','all'])).rejects.toThrow();await expect(run(['inventory','--archive','missing'])).rejects.toThrow();await expect(run(['list','--unexpected'])).rejects.toThrow();
});
