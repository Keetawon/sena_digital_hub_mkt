import random

import pytest

from sena_hub_api.naming import SENA_H, check, explain, generate, launch_pack, parse, sn_code, validate


VECTORS = [(26, 101, "SN2600101Y"), (26, 102, "SN2600102F"), (26, 103, "SN2600103W"),
           (26, 104, "SN2600104D"), (26, 105, "SN2600105U"), (26, 106, "SN2600106B"),
           (26, 123, "SN2600123Q"), (26, 1, "SN2600001M")]


@pytest.mark.parametrize("year,seq,expected", VECTORS)
def test_code_vectors_and_every_digit_mutation_and_unequal_adjacent_swap(year, seq, expected):
    assert sn_code(year, seq) == expected
    assert check(expected)
    for index in range(2, 9):
        for digit in "0123456789":
            if digit != expected[index]:
                changed = expected[:index] + digit + expected[index + 1:]
                assert not check(changed), changed
    for index in range(2, 8):
        if expected[index] != expected[index + 1]:
            swapped = expected[:index] + expected[index + 1] + expected[index] + expected[index + 2:]
            assert not check(swapped), swapped


@pytest.mark.parametrize("year,seq", [(-1, 1), (100, 1), (26, 0), (26, 100000), (True, 1), (26, 1.0)])
def test_code_inputs_have_bounded_numeric_domain(year, seq):
    with pytest.raises(ValueError):
        sn_code(year, seq)


@pytest.mark.parametrize("name", [
    "KITH SAMRONG__LEADS__C-SKTH-SMRIN__MEDIAOPTION__SN2600101Y",
    "FLEXI SATHON__LEADS__C-FLEX-STCRN-HY2DE__BRANDSTROM__SN2600102F",
    "FLEXI SATHON__LEADS__C-FLEX-STCRN__BRANDSTROM__SN2600103W",
    "POOL ZONE RAMINDRA__LEADS__ZONE-RMINDRA-POOL__7DAYSSUCCESS__SN2600104D",
    "TEST DRIVE__ENGAGEMENT__CORP-LIVNEX__INHOUSE__SN2600105U",
    "SEM KITH POOL__LEADS__BRAND-KITH__MEDIAOPTION__SN2600106B__KW-BRAND",
    "SENA SOLAR__TRAFFIC__BU-SOLAR__KIN__SN2600123Q__CAPI-TEST",
])
def test_document_names_accept_and_round_trip(name):
    assert SENA_H.fullmatch(name)
    assert validate(name)
    assert generate(**parse(name)) == name


@pytest.mark.parametrize("name", [
    "ชื่อไทย__LEADS__C-SKTH-SMRIN__KIN__SN2600123Q",
    "KITH+SENA__LEADS__C-SKTH-SMRIN__KIN__SN2600123Q",
    "KITH__SEM__C-SKTH-SMRIN__KIN__SN2600123Q",
    "KITH__LEADS__C-SKTH-SMRIN__MediaOption__SN2600123Q",
    "KITH__LEADS__C-SKTH-SMRIN__KIN__SN2600123K",
    "KITH__LEADS__C-SKTH-SMRIN__KIN__SN2600123O",
    "KITH__LEADS__C-SKTH-SMRIN__KIN__SN2600123Q__",
    "KITH__LEADS__C-FLEX-STCRN-HYABC.HY2DE__KIN__SN2600123Q",
    "KITH__LEADS__C-SKTH-SMRIN__KIN__SN2600123Q\n",
    " KITH__LEADS__C-SKTH-SMRIN__KIN__SN2600123Q",
    "KITH__LEADS__C-SKTH-SMRIN__KIN__SN2600123Q__KW-BRAND__EXTRA",
    "KITH__LEADS__C-SKTH-SMRIN__KIN__SN2600123Q__" + "A" * 25,
])
def test_regex_and_checksum_reject_invalid_examples(name):
    assert not validate(name)
    with pytest.raises(ValueError):
        parse(name)


def test_names_over_150_characters_are_not_issued_even_if_lexically_valid():
    name = "A" * 40 + "__LEADS__ZONE-" + "B" * 90 + "__KIN__SN2600123Q"
    assert SENA_H.fullmatch(name)
    assert not validate(name)


def test_random_valid_registration_round_trips():
    randomizer = random.Random(20260929)
    for _ in range(1000):
        fields = {
            "label": randomizer.choice(["FLEXI SATHON", "TEST DRIVE", "SENA 1.2", "COZI-BTS"]),
            "objective": randomizer.choice(["LEADS", "TRAFFIC", "AWARENESS", "ENGAGEMENT", "SALES", "VIDEOVIEWS", "CONVERSION"]),
            "scope": randomizer.choice(["C-FLEX-STCRN", "C-FLEX-STCRN-HY2DE", "ZONE-A123BC456DEF", "BRAND-COZI", "CORP-LIVNEX", "BU-SOLAR"]),
            "agency": randomizer.choice(["KIN", "COMBAY", "MEDIAOPTION", "INHOUSE"]),
            "code": sn_code(randomizer.randrange(100), randomizer.randint(1, 99999)),
            "variant": randomizer.choice([None, "KW-BRAND", "KW-COMPETITOR", "KW-GENERIC", "CAPI-TEST"]),
        }
        assert parse(generate(**fields)) == fields


def test_legacy_explanation_never_downgrades_a_malformed_sena_h():
    legacy = "TEST DRIVE__ENGAGEMENT__CORP-LIVNEX__SID__M.COM033_69__INHOUSE__PO-NA__JULALWAYSON"
    result = explain(legacy)
    assert result["template"] == "SENA-7"
    assert result["fields"]["memo"] == "M.COM033_69"
    assert not result["valid"]
    assert explain("A__LEADS__CORP-LIVNEX__KIN__SN2600123K__KW-BRAND__EXTRA")["template"] == "SENA-H"
    assert explain("a__b__c__d__e__f__g__h__i")["template"] == "V1/UNKNOWN"


def test_google_launch_pack_encodes_campaign_once_and_keeps_macro_literal():
    name = generate("TEST DRIVE", "ENGAGEMENT", "CORP-LIVNEX", "INHOUSE", sn_code(26, 1))
    pack = launch_pack(name)
    assert "TEST%20DRIVE" in pack["utm_google"]
    assert "%2520" not in pack["utm_google"]
    assert pack["utm_google"].endswith("&utm_id={campaignid}")
    assert name in pack["launch_pack"]
