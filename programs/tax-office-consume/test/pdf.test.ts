import {test,expect} from 'bun:test';import {validatePdf} from '../src/source';
test('signature-only counterfeit PDF is rejected',()=>{expect(()=>validatePdf(Buffer.from('%PDF-1.7\ntrailer\n<<>>\n%%EOF\n'))).toThrow('PDF');});
