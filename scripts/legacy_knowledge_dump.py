"""Read an allowlist of MariaDB dump tables as data; never execute SQL."""
import collections
import gzip
import json
import re
from pathlib import Path

SOURCE = Path(r"D:\tmp\sena-production-2026-10-05.sql.gz")
ALLOWED = {
    "campaign_projects", "campaign_project_links", "project_knowledge_items",
    "project_content_snapshots", "project_media_assets", "solution_content_snapshots",
    "ai_language_terms", "ai_language_aliases",
}


def tuples(text):
    escapes = {"0": "\0", "b": "\b", "n": "\n", "r": "\r", "t": "\t", "Z": "\x1a"}
    pos = 0
    while pos < len(text):
        if text[pos] in " ,;\r\n":
            pos += 1
            continue
        assert text[pos] == "(", (pos, "expected tuple")
        pos += 1
        row = []
        while True:
            while text[pos].isspace():
                pos += 1
            if text[pos] == "'":
                pos += 1
                value = []
                while True:
                    ch = text[pos]
                    pos += 1
                    if ch == "\\":
                        ch = text[pos]
                        value.append(escapes.get(ch, ch))
                        pos += 1
                    elif ch == "'":
                        if pos < len(text) and text[pos] == "'":
                            value.append("'")
                            pos += 1
                        else:
                            break
                    else:
                        value.append(ch)
                value = "".join(value)
            else:
                start = pos
                while text[pos] not in ",)":
                    pos += 1
                token = text[start:pos].strip()
                assert token == "NULL" or re.fullmatch(r"-?\d+(?:\.\d+)?", token), "unsupported token"
                value = None if token == "NULL" else token
            row.append(value)
            while text[pos].isspace():
                pos += 1
            separator = text[pos]
            pos += 1
            if separator == ")":
                yield row
                break
            assert separator == ",", "expected separator"


def load(source=SOURCE):
    tables = {key: [] for key in ALLOWED}
    columns = {}
    current = None
    pending = None
    statement = []
    with gzip.open(source, "rt", encoding="utf-8") as stream:
        for line in stream:
            create = re.match(r"CREATE TABLE `([^`]+)`", line)
            if create:
                current = create.group(1)
                columns[current] = []
            elif current and line.startswith(")"):
                current = None
            elif current:
                col = re.match(r"  `([^`]+)`", line)
                if col:
                    columns[current].append(col.group(1))
            insert = re.match(r"INSERT INTO `([^`]+)` VALUES\s*", line)
            if insert and insert.group(1) in ALLOWED:
                pending = insert.group(1)
                statement = [line[insert.end():]]
            elif pending:
                statement.append(line)
            if not pending or not line.rstrip().endswith(";"):
                continue
            table = pending
            pending = None
            for values in tuples("".join(statement)):
                assert len(values) == len(columns[table]), (table, "column count mismatch")
                row = dict(zip(columns[table], values))
                for key, value in row.items():
                    if key.endswith("_json") or key in {"promotion_categories", "ai_secondary_tags", "approved_secondary_tags"}:
                        row[key] = json.loads(value) if value is not None else None
                tables[table].append(row)
    return tables, columns
