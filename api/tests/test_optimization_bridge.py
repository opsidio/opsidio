"""Optimization contract tests; all service responses are explicit local fixtures."""
import copy
import json
import unittest
import urllib.request
from api.simulation import BridgeConfig, BridgeError, SimulationBridge
from api.simulation.__main__ import handler_for
from test_des_bridge import StubClient, PLAN_RESPONSE, REQUEST, VALIDATION, local_server

OPT='opt_01JC9Y5N2B7C4D6F8G0H2J4K6M'
CANDIDATE='pln_01JC9Z1P3Q5R7S9T1V3W5X7Y9Z'
R1='run_01JC9Y9Z1A3B5C7D9E1F3G5H7J'
R2='run_01JC9ZB3C5D7E9F1G3H5J7K9M1'
JOB={'id':OPT,'plan_id':PLAN_RESPONSE['id'],'status':'queued','candidates':[],'starting_plan':None}
FINAL={**JOB,'status':'succeeded','starting_plan':{'des_run_id':R1},'candidates':[{'plan_id':CANDIDATE,'des_run_id':R2}]}
class OptimizationTests(unittest.TestCase):
    def bridge(self,responses):
        client=StubClient(responses)
        return SimulationBridge(BridgeConfig('https://engine.example.test','test-key'),client),client
    def test_create_validate_optimize_uses_contract_and_stable_idempotency(self):
        bridge,client=self.bridge([PLAN_RESPONSE,VALIDATION,JOB]*2)
        first=bridge.optimize(REQUEST);bridge.optimize(REQUEST)
        self.assertEqual(first['optimization'],JOB)
        self.assertEqual(client.calls[2][1],f"/v1/plans/{PLAN_RESPONSE['id']}/optimize")
        self.assertEqual(client.calls[2][2],{'optimization_method':'greedy','time_limit_seconds':180,'verify':{'replications':20,'base_seed':20261127}})
        self.assertEqual(client.calls[2][3],client.calls[5][3])
        self.assertNotIn('test-key',json.dumps(first))
    def test_invalid_plan_stops_before_optimize(self):
        bridge,client=self.bridge([PLAN_RESPONSE,{'valid':False,'issues':[{'severity':'error','message':'Missing staff'}]}])
        with self.assertRaises(BridgeError) as e:bridge.optimize(REQUEST)
        self.assertEqual(e.exception.http_status,422)
        self.assertEqual(len(client.calls),2)
    def test_unconfigured_does_not_call_service(self):
        client=StubClient([])
        with self.assertRaises(BridgeError) as e:SimulationBridge(BridgeConfig(),client).optimize(REQUEST)
        self.assertEqual(e.exception.http_status,503)
        self.assertEqual(client.calls,[])
    def test_rejects_job_for_another_plan(self):
        bridge,_=self.bridge([PLAN_RESPONSE,VALIDATION,{**JOB,'plan_id':CANDIDATE}])
        with self.assertRaises(BridgeError) as e:bridge.optimize(REQUEST)
        self.assertEqual(e.exception.http_status,502)
    def test_poll_and_cancel_use_returned_identity(self):
        bridge,client=self.bridge([JOB,JOB,{**JOB,'status':'running'}])
        self.assertEqual(bridge.optimization(OPT),JOB)
        self.assertEqual(bridge.cancel_optimization(OPT)['status'],'running')
        self.assertEqual(client.calls[-1][:2],('POST',f'/v1/optimizations/{OPT}/cancel'))
        with self.assertRaises(BridgeError):bridge.optimization('../../secret')
    def test_comparison_fetches_real_candidate_and_both_matching_des_runs(self):
        candidate={**PLAN_RESPONSE,'id':CANDIDATE}
        runs=[{'id':R1,'plan_id':PLAN_RESPONSE['id'],'simulation_method':'des','output':{'sentinel':'baseline'}},{'id':R2,'plan_id':CANDIDATE,'simulation_method':'des','output':{'sentinel':'candidate'}}]
        bridge,_=self.bridge([FINAL,candidate,*runs])
        result=bridge.comparison(OPT,CANDIDATE)
        self.assertEqual(result['plan'],candidate)
        self.assertEqual(result['runs'],dict(zip(['baseline','candidate'],runs)))
    def test_no_verified_runs_are_not_fabricated(self):
        job=copy.deepcopy(FINAL);job['starting_plan']['des_run_id']=None;job['candidates'][0]['des_run_id']=None
        bridge,_=self.bridge([job,{**PLAN_RESPONSE,'id':CANDIDATE}])
        self.assertEqual(bridge.comparison(OPT,CANDIDATE)['runs'],{})
    def test_foreign_candidate_or_mismatched_run_is_rejected(self):
        bridge,client=self.bridge([JOB])
        with self.assertRaises(BridgeError) as e:bridge.comparison(OPT,CANDIDATE)
        self.assertEqual(e.exception.http_status,409);self.assertEqual(len(client.calls),1)
        bridge,_=self.bridge([FINAL,{**PLAN_RESPONSE,'id':CANDIDATE},{'id':R1,'plan_id':CANDIDATE,'simulation_method':'des'}])
        with self.assertRaises(BridgeError) as e:bridge.comparison(OPT,CANDIDATE)
        self.assertEqual(e.exception.http_status,502)
    def test_http_routes_return_accepted_job_and_poll_result(self):
        bridge,_=self.bridge([PLAN_RESPONSE,VALIDATION,JOB,JOB])
        with local_server(handler_for(bridge)) as base:
            request=urllib.request.Request(base+'/api/simulation/optimize',data=json.dumps(REQUEST).encode(),headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(request) as r:
                self.assertEqual(r.status,202);self.assertEqual(json.load(r)['optimization']['id'],OPT)
            with urllib.request.urlopen(base+'/api/simulation/optimizations/'+OPT) as r:self.assertEqual(json.load(r)['status'],'queued')
if __name__=='__main__':unittest.main()
