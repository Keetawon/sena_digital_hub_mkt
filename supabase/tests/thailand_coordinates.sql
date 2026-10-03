begin;
do $$
declare coordinates jsonb; result jsonb; baseline jsonb; outside_count integer;
  payload jsonb := '{"id":"00000000-0000-0000-0000-000000000000","models":[],"assets":[]}';
begin
  baseline := hub.snapshot_readiness(payload || '{"latitude":13.7563,"longitude":100.5018}');
  for coordinates in select value from jsonb_array_elements('[
    {"latitude":5,"longitude":97,"missing":0},
    {"latitude":21,"longitude":106,"missing":0},
    {"latitude":13.7563,"longitude":100.5018,"missing":0},
    {"latitude":0,"longitude":0,"missing":2},
    {"latitude":4.9999,"longitude":100,"missing":1},
    {"latitude":21.0001,"longitude":100,"missing":1},
    {"latitude":13,"longitude":96.9999,"missing":1},
    {"latitude":13,"longitude":106.0001,"missing":1},
    {"latitude":"bad","longitude":100,"missing":1},
    {"latitude":null,"longitude":null,"missing":2}
  ]'::jsonb) loop
    result := hub.snapshot_readiness(payload || coordinates);
    select count(*) into outside_count from jsonb_array_elements(result->'missing') item
      where item->>'field' in ('latitude','longitude');
    assert outside_count=(coordinates->>'missing')::integer, coordinates::text;
    assert (select jsonb_agg(item) from jsonb_array_elements(result->'missing') item
      where item->>'field' not in ('latitude','longitude'))=baseline->'missing', 'Unrelated gate changed';
    if outside_count>0 and coordinates->>'latitude' is not null then
      assert exists(select 1 from jsonb_array_elements(result->'missing') item
        where item->>'message'='พิกัดอยู่นอกประเทศไทย ตรวจละติจูดและลองจิจูด'), 'Missing Thai explanation';
    end if;
  end loop;
end $$;
rollback;
