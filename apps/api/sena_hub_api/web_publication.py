"""Private website review and authenticated, filtered publication projections."""
from __future__ import annotations

from hashlib import sha256
from html import escape
import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from .articles import render_blocks, reference_key
from .auth import Actor
from .content_permissions import require_content
from .content_workflow import publication_targets

PageKey = Annotated[str, StringConstraints(pattern=r'^(project|brand|business|programme|corporate|article|location):[A-Za-z0-9][A-Za-z0-9_-]{0,127}$')]
Digest = Annotated[str, StringConstraints(pattern=r'^[a-f0-9]{64}$')]
Locale = Literal['th', 'en']


class PageConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')
    url: Annotated[str, StringConstraints(pattern=r'^/[A-Za-z0-9_/%.-]+$', max_length=500)]
    locales: list[Locale] = Field(default_factory=lambda: ['th', 'en'], min_length=1, max_length=2)
    ai_policy: Literal['open', 'search_only', 'no_ai'] = 'no_ai'
    max_faq_items: int = Field(default=20, ge=0, le=100, strict=True)
    project_ids: list[Annotated[str, StringConstraints(pattern=r'^[A-Za-z0-9_-]{1,128}$')]] = Field(default_factory=list, max_length=30)


class PageSave(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(ge=0, strict=True)
    config: PageConfig


class Prepare(BaseModel):
    model_config = ConfigDict(extra='forbid')
    reason: str = Field(min_length=1, max_length=2000)


class Publish(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_digest: Digest


class Pointer(Prepare):
    expected_version_id: UUID | None
    target_version_id: UUID | None


def render_article(document: dict, locale: str, assets: dict) -> str:
    """Reuse the article grammar; public references contain no source UUIDs."""
    references = {}
    count = 0

    def convert(node):
        nonlocal count
        if node.get('type') == 'reference':
            count += 1
            kind = node['kind']
            key = str(count)
            attrs = ({'asset_id': key} if kind == 'libraryImage' else {'media_link_id': key} if kind == 'mediaVideo'
                     else {'project_id': key, **({'question_key': key} if kind == 'faqEmbed' else {})})
            value = node.get('value')
            if value and (kind != 'libraryImage' or value.get('public_asset_id') in assets):
                references[reference_key(kind, attrs)] = {**value, 'asset_id': assets.get(value.get('public_asset_id')), 'alt': value.get('alt_text', ''), 'name': value.get('name', '')}
            return {'type': kind, 'attrs': attrs}
        return {**node, **({'content': [convert(child) for child in node['content']]} if 'content' in node else {})}

    return render_blocks(convert(document), references, locale)


def preview_html(page: dict, assets: dict | None = None) -> str:
    """Plain escaped HTML; no source scripts, CSS or external embeds."""
    locale = page['locale']
    assets = assets or {}
    content = page['content'] or {}
    parts = [f'<article lang="{locale}"><h1>{escape(page["page_key"])}</h1>']

    def text(value):
        return escape(str(value if value is not None else ''))

    def figure(asset):
        if not asset or asset.get('public_asset_id') not in assets:
            return ''
        return f'<figure><img loading="lazy" src="/api/hub/v1/admin/assets/{UUID(assets[asset["public_asset_id"]])}/file" alt="{text(asset.get("alt_text"))}"><figcaption>{text(asset.get("caption"))}</figcaption></figure>'

    article = content.get('article')
    if article:
        parts += [f'<h2>{escape(article["title"])}</h2><p>{escape(article["excerpt"])}</p>', figure(article.get('cover')), render_article(article['blocks'], locale, assets)]
    for phase in content.get('phases', []):
        parts.append(f'<section><h2>{text(phase.get("fields", {}).get("public_name") or phase["public_project_id"])}</h2>')
        for section in phase.get('sections', []):
            parts.append(f'<h3>{text(section.get("title"))}</h3><p>{text(section.get("body"))}</p>')
        for fact in phase.get('facts', []):
            parts.append(f'<p>{text(fact["field_key"])}: {text(fact["text"])}</p>')
        for asset in phase.get('media', []):
            parts.append(figure(asset))
        parts.append('</section>')
    for section in content.get('sections', []):
        parts.append(f'<h2>{text(section.get("title"))}</h2><p>{text(section.get("body"))}</p>')
    for asset in content.get('media', []):
        parts.append(figure(asset))
    labels = {'fields': 'ข้อมูลหน้าเว็บ', 'address': 'ที่อยู่', 'ad_disclaimer': 'ข้อความกำกับโฆษณา', 'meta_title': 'ชื่อเรื่องสำหรับค้นหา', 'meta_description': 'คำอธิบายสำหรับค้นหา',
              'selling_points': 'จุดขาย', 'unit_types': 'แบบห้องและบ้าน', 'facilities': 'สิ่งอำนวยความสะดวก', 'features': 'คุณสมบัติ',
              'places': 'สถานที่ใกล้เคียง', 'contacts': 'ติดต่อ', 'prices': 'ราคา', 'disclosures': 'ข้อมูลตามกฎหมาย',
              'sales_terms': 'เงื่อนไขการขาย', 'programmes': 'โครงการบริการ', 'construction': 'ความคืบหน้า', 'solar_estimates': 'ประมาณการโซลาร์', 'videos': 'วิดีโอ',
              'name': 'ชื่อ', 'title': 'หัวข้อ', 'description': 'รายละเอียด', 'detail': 'รายละเอียด', 'status': 'สถานะ', 'value': 'ข้อมูล',
              'amount': 'จำนวนเงิน', 'basis': 'หลักคำนวณ', 'valid_from': 'เริ่มใช้', 'valid_to': 'สิ้นสุด', 'as_of': 'ข้อมูล ณ',
              'distance_m': 'ระยะทาง (เมตร)', 'distance_method': 'วิธีวัดระยะ', 'travel_minutes': 'เวลาเดินทาง (นาที)', 'travel_mode': 'วิธีเดินทาง',
              'opening_hours': 'เวลาเปิด', 'location_label': 'ตำแหน่ง', 'size_sqm': 'ขนาด (ตร.ม.)', 'expected_open': 'คาดว่าจะเปิด',
              'unknown': 'ยังไม่ทราบ', 'present': 'มี', 'absent': 'ไม่มี', 'planned': 'อยู่ในแผน', 'operating': 'เปิดใช้งาน',
              'source_note': 'ที่มาของข้อมูล', 'condition_text': 'เงื่อนไข', 'display_text': 'ข้อความราคา', 'public_name': 'ชื่อที่เผยแพร่'}

    def details(value):
        if isinstance(value, dict):
            if 'public_asset_id' in value:
                return figure(value)
            return '<dl>' + ''.join(f'<dt>{text(labels.get(k, k))}</dt><dd>{details(v)}</dd>' for k, v in value.items()
                                   if v is not None and k not in ('ai_exposure', 'public_asset_id', 'public_content_id', 'public_price_id', 'public_commercial_type_id')) + '</dl>'
        if isinstance(value, list):
            return '<ul>' + ''.join('<li>' + details(v) + '</li>' for v in value) + '</ul>'
        if isinstance(value, bool):
            return 'ใช่' if value else 'ไม่ใช่'
        return text(labels.get(str(value), value))

    for source in [content, *content.get('phases', [])]:
        for field in ('fields', 'selling_points', 'unit_types', 'facilities', 'features', 'places', 'contacts', 'prices', 'disclosures', 'sales_terms', 'programmes', 'construction', 'solar_estimates', 'videos'):
            if source.get(field):
                parts.append(f'<section><h2>{labels[field]}</h2>{details(source[field])}</section>')
    for faq in page['faq']:
        parts.append(f'<section><h3>{text(faq["question"])}</h3><p>{text(faq["short_answer"])}</p><p>{text(faq["detail"])}</p><small>{text(faq.get("as_of_label"))}</small></section>')
    parts.append('</article>')
    return ''.join(parts)


def reviewed_preview(data: dict) -> dict:
    for page in data['pages']:
        if page.get('system') == 'release':
            label = page.get('label') or {}
            title = label.get('th') or label.get('en') or page['member']['entity_type']
            page['html'] = '<article><h1>' + escape(title) + '</h1><pre>' + escape(json.dumps(page['preview'], ensure_ascii=False, indent=2)) + '</pre></article>'
        else:
            page['html'] = preview_html(page['preview'], page.pop('preview_assets', {}))
            if page.get('previous'):
                page['previous_html'] = preview_html(page['previous'], page.pop('previous_assets', {}))
    return publication_targets(data)


def cached(request: Request, data, *, text: bool = False):
    encoded = data if text else json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    digest = data.get('content_sha256') if isinstance(data, dict) else None
    tag = '"' + (digest or sha256(encoded.encode()).hexdigest()) + '"'
    headers = {'ETag': tag, 'Cache-Control': 'private, max-age=0, must-revalidate', 'Vary': 'Authorization', 'X-Content-Type-Options': 'nosniff'}
    if any(value.strip().removeprefix('W/') in (tag, '*') for value in request.headers.get('if-none-match', '').split(',')):
        return Response(status_code=304, headers=headers)
    return PlainTextResponse(data, headers=headers) if text else JSONResponse({'data': data}, headers=headers)


def register_web_routes(app, authentication, database, consumer):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        require_content(request)
        return actor

    async def call(request, actor, sql, *args):
        async with database(request, actor) as connection:
            return await connection.fetchval(sql, *args)

    @app.get('/v1/admin/web')
    async def workspace(request: Request, actor: Actor = Depends(staff)):
        return {'data': await call(request, actor, 'select hub.web_workspace()')}

    @app.put('/v1/admin/web/pages/{page_key}')
    async def save(page_key: PageKey, body: PageSave, request: Request, actor: Actor = Depends(staff)):
        return {'data': await call(request, actor, 'select hub.web_page_save($1,$2,$3)', page_key, body.expected_revision, body.config.model_dump())}

    @app.get('/v1/admin/web/pages/{page_key}/history')
    async def history(page_key: PageKey, request: Request, actor: Actor = Depends(staff)):
        return {'data': await call(request, actor, 'select hub.web_history($1)', page_key)}

    @app.get('/v1/admin/web/pages/{page_key}/versions/{version_id}')
    async def version(page_key: PageKey, version_id: UUID, request: Request, locale: Locale = 'th', actor: Actor = Depends(staff)):
        data = await call(request, actor, 'select hub.web_version_preview($1,$2,$3)', page_key, version_id, locale)
        return {'data': {'preview': data['preview'], 'html': preview_html(data['preview'], data['preview_assets'])}}

    @app.post('/v1/admin/web/pages/{page_key}/pointer')
    async def pointer(page_key: PageKey, body: Pointer, request: Request, actor: Actor = Depends(staff)):
        return {'data': await call(request, actor, 'select hub.web_pointer($1,$2,$3,$4)', page_key, body.expected_version_id, body.target_version_id, body.reason)}

    @app.post('/v1/admin/web/publications')
    async def prepare(body: Prepare, request: Request, actor: Actor = Depends(staff)):
        return {'data': await call(request, actor, 'select hub.web_prepare($1)', body.reason)}

    @app.get('/v1/admin/web/publications/{publication_id}')
    async def publication(publication_id: UUID, request: Request, locale: Locale = 'th', actor: Actor = Depends(staff)):
        return {'data': reviewed_preview(await call(request, actor, 'select hub.web_publication_read($1,$2)', publication_id, locale))}

    @app.get('/v1/admin/web/publications/{publication_id}/preview')
    async def html_preview(publication_id: UUID, request: Request, locale: Locale = 'th', actor: Actor = Depends(staff)):
        data = reviewed_preview(await call(request, actor, 'select hub.web_publication_read($1,$2)', publication_id, locale))
        return HTMLResponse('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Website review</title>' + ''.join(page['html'] for page in data['pages']),
                            headers={'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox; frame-ancestors 'self'", 'X-Content-Type-Options': 'nosniff'})

    @app.post('/v1/admin/web/publications/{publication_id}/publish')
    async def publish(publication_id: UUID, body: Publish, request: Request, actor: Actor = Depends(staff)):
        return {'data': publication_targets(await call(request, actor, 'select hub.web_publish($1,$2)', publication_id, body.expected_digest))}

    @app.get('/v1/web/pages/{page_key}')
    async def page(page_key: PageKey, request: Request, locale: Locale = 'th', actor: Actor = Depends(consumer)):
        return cached(request, await call(request, actor, 'select hub.web_public_page($1,$2)', page_key, locale))

    @app.get('/v1/web/pages/{page_key}/faq')
    async def faq(page_key: PageKey, request: Request, locale: Locale = 'th', actor: Actor = Depends(consumer)):
        data = await call(request, actor, 'select hub.web_public_page($1,$2)', page_key, locale)
        return cached(request, {key: data[key] for key in ('page_key', 'locale', 'is_fallback_locale', 'faq', 'hidden', 'content_sha256')})

    @app.get('/v1/web/changes')
    async def changes(request: Request, since: int = Query(default=0, ge=0, le=9223372036854775807), actor: Actor = Depends(consumer)):
        return cached(request, await call(request, actor, 'select hub.web_public_changes($1)', since))

    @app.get('/v1/web/llms.txt')
    async def llms(request: Request, actor: Actor = Depends(consumer)):
        pages = await call(request, actor, "select hub.web_public_ai('llms')")
        lines = ['# SENA published website content']
        for page in pages:
            lines += ['', '## ' + page['page_key'], page['url'], json.dumps(page['content'], ensure_ascii=False)]
        return cached(request, '\n'.join(lines) + '\n', text=True)

    @app.get('/v1/web/robots-ai')
    async def robots(request: Request, actor: Actor = Depends(consumer)):
        pages = await call(request, actor, "select hub.web_public_ai('robots')")
        lines = ['User-agent: *'] + ['Disallow: ' + p['url'] for p in pages if p['ai_policy'] == 'no_ai']
        for agent in ('GPTBot', 'CCBot', 'Google-Extended'):
            lines += ['', 'User-agent: ' + agent] + [('Allow: ' if p['ai_policy'] == 'open' else 'Disallow: ') + p['url'] for p in pages]
        return cached(request, '\n'.join(lines) + '\n', text=True)
