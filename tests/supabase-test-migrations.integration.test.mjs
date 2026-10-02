import {test} from 'node:test';
import {simulateHostedTest} from '../scripts/simulate-hosted-test.mjs';

test('disposable managed-permission profile: denied GUC, complete migration, replay, rollback and role isolation',async()=>{
 await simulateHostedTest({seed:false});
});
