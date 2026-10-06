"""Synthetic promotion/manifest/label regressions; never read real source packages."""
import hashlib
import importlib.util
import json
from datetime import date
from pathlib import Path
from PIL import Image, ImageDraw
import pytest

ROOT=Path(__file__).resolve().parents[3]
def script(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def test_manifest_checks_size_hash_and_path_before_database(tmp_path):
    helper=script('prepare-knowledge-followup')
    (tmp_path/'questions.json').write_bytes(b'[]')
    manifest={'files':{'questions.json':{'sha256':hashlib.sha256(b'[]').hexdigest(),'bytes':2}}}
    raw=json.dumps(manifest).encode();(tmp_path/'manifest.json').write_bytes(raw)
    helper.verify(tmp_path,hashlib.sha256(raw).hexdigest())
    (tmp_path/'questions.json').write_bytes(b'[1]')
    with pytest.raises(ValueError,match='payload_hash_or_size_mismatch'):helper.verify(tmp_path,hashlib.sha256(raw).hexdigest())
    with pytest.raises(ValueError,match='manifest_hash_mismatch'):helper.verify(tmp_path,'0'*64)
    manifest['files']={'../outside':{}};raw=json.dumps(manifest).encode();(tmp_path/'manifest.json').write_bytes(raw)
    with pytest.raises(ValueError,match='unsafe_manifest_path'):helper.verify(tmp_path,hashlib.sha256(raw).hexdigest())

def test_promotion_clusters_require_image_text_scope_and_date(tmp_path,monkeypatch):
    helper=script('prepare-knowledge-followup');monkeypatch.setattr(helper,'ROOT',tmp_path)
    directory=tmp_path/'.local/knowledge-assets';directory.mkdir(parents=True)
    image=Image.new('RGB',(128,128),'white');ImageDraw.Draw(image).rectangle((20,30,90,100),fill='blue')
    temporary=tmp_path/'sample.png';image.save(temporary);data=temporary.read_bytes();sha=hashlib.sha256(data).hexdigest();(directory/sha).write_bytes(data)
    def candidate(key,**changes):
        return {'id':key,'kind':'promotion','project_ids':['BNA7'],'evidence':{'image_sha256':sha,'title':'โปรโมชั่น ส่วนลด','benefit':'ฟรี','valid_to':'2026-01-01',**changes}}
    rows=[candidate('a'),candidate('b'),candidate('c',valid_to='2027-01-01'),candidate('d',title='สวนพักผ่อน',benefit='',valid_to=None)]
    rows.append({**candidate('e'),'project_ids':['SK2TR']})
    result=helper.promotion_annotations(rows,date(2026,10,7))
    assert result[0]['cluster_id']==result[1]['cluster_id'] and result[0]['cluster_size']==2
    assert len({r['cluster_id'] for r in result})==4
    assert result[0]['likely_expired'] and not result[2]['likely_expired']
    assert result[3]['category']=='text_not_promotion' and result[3]['date_unknown'] and not result[3]['likely_expired']

def test_human_refusal_labels_override_model_only_for_reviewed_routes():
    helper=script('evaluate-knowledge')
    overrides=json.loads((ROOT/'tests/fixtures/knowledge/human-judge-overrides.json').read_text())
    judge={'expected_behavior_satisfied':False,'reason':'incorrect model judgment'}
    corrected=helper.apply_human_override('audit-evaluation-17',{'route':'unsafe_instruction'},judge,overrides)
    assert corrected['expected_behavior_satisfied'] and corrected['label_source']=='human_review'
    assert not judge['expected_behavior_satisfied']
    assert helper.apply_human_override('legacy-heldout-517',{'route':'no_answer'},judge,overrides)['label_source']=='human_review'
    assert helper.apply_human_override('audit-evaluation-17',{'route':'faq'},judge,overrides)['label_source']=='model'


def test_answerable_handoff_cannot_be_inflated_and_typed_status_is_supported():
    helper=script('evaluate-knowledge');overrides={'cases':{},'source':'test'}
    judge={'expected_behavior_satisfied':True,'unsupported_numeric':True}
    score=helper.apply_evaluation_policy({'id':'legacy-heldout-481','suite':'legacy_heldout','held_claim':False},{'route':'no_answer'},judge,overrides)
    assert not score['expected_behavior_satisfied'] and score['label_source']=='answerable_gate'
    score=helper.apply_evaluation_policy({'id':'closed','suite':'audit'},{'route':'closed','fact_card':{'status':{'raw':3,'source_ref':'dw:synthetic'}},'citations':[{'source_ref':'dw:synthetic'}]},judge,overrides)
    assert not score['unsupported_numeric'] and score['citation_supported']
