"""Private article drafts. Only this escaped, closed renderer produces HTML."""
from __future__ import annotations

import json
from html import escape
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from .auth import Actor
from .commercial_types import LocalizedText
from .content_permissions import require_content

Reference = Annotated[str, StringConstraints(strict=True, pattern=r'^[A-Za-z0-9_-]{1,128}$')]


class ArticleLink(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['project', 'brand', 'programme']
    ref: Reference


class ArticleContent(BaseModel):
    model_config = ConfigDict(extra='forbid')
    slug: Annotated[str, StringConstraints(strict=True, pattern=r'^[a-z0-9][a-z0-9-]{0,119}$')]
    category: Reference
    cover_asset_id: UUID | None = None
    author: LocalizedText = Field(default_factory=dict)
    tags: list[LocalizedText] = Field(default_factory=list, max_length=20)
    ai_exposure: Literal['open', 'web_only', 'internal'] = 'web_only'
    title: LocalizedText
    excerpt: LocalizedText = Field(default_factory=dict)
    seo_title: LocalizedText = Field(default_factory=dict)
    seo_description: LocalizedText = Field(default_factory=dict)
    blocks: dict
    links: list[ArticleLink] = Field(default_factory=list, max_length=100)

    @field_validator('blocks')
    @classmethod
    def bounded_blocks(cls, value):
        # Traverse with a depth/node budget before JSON serialization can recurse.
        render_blocks(value, {})
        if len(json.dumps(value, ensure_ascii=False).encode()) > 200000:
            raise ValueError('Article body is too large')
        # SQL also validates the complete node grammar for direct callers.
        return value


class ArticleRevision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(ge=1, strict=True)


class ArticleSave(ArticleRevision):
    content: ArticleContent


class ArticleReview(ArticleRevision):
    decision: Literal['approve', 'return', 'withdraw']


def reference_key(kind: str, attrs: dict) -> str:
    ref = attrs.get('asset_id') or attrs.get('media_link_id') or attrs.get('project_id', '')
    return f'{kind}:{ref}' + (f':{attrs.get("question_key", "")}' if kind == 'faqEmbed' else '')


def render_blocks(document: dict, references: dict, locale: str = 'th') -> str:
    """No user HTML, styles or URL attributes ever pass through this renderer.

    References are a separate, permission-filtered database projection; block
    attributes contain only IDs. Missing/revoked sources render a neutral notice.
    """
    count = 0
    block_tags = {'doc': 'div', 'paragraph': 'p', 'bulletList': 'ul', 'orderedList': 'ol',
                  'listItem': 'li', 'blockquote': 'blockquote', 'table': 'table',
                  'tableRow': 'tr', 'tableCell': 'td', 'tableHeader': 'th', 'callout': 'aside'}
    atoms = {'libraryImage', 'mediaVideo', 'faqEmbed', 'projectCard'}
    unavailable = 'Referenced content unavailable' if locale == 'en' else 'เนื้อหาที่อ้างอิงไม่พร้อมหรือไม่มีสิทธิ์อ่าน'

    def text(value):
        return escape(str(value or ''), quote=True)

    def render(node, depth=0):
        nonlocal count
        count += 1
        if count > 800 or depth > 10 or not isinstance(node, dict) or set(node) - {'type', 'attrs', 'content', 'text', 'marks'}:
            raise ValueError('Invalid article node')
        kind = node.get('type')
        if not isinstance(kind, str):
            raise ValueError('Invalid article node type')
        attrs = node.get('attrs', {})
        children = node.get('content', [])
        if not isinstance(attrs, dict) or not isinstance(children, list) or len(children) > 200:
            raise ValueError('Invalid article node attributes')
        if kind == 'text':
            if not isinstance(node.get('text'), str) or len(node['text']) > 12000 or attrs or children:
                raise ValueError('Invalid article text')
            result = text(node['text'])
            marks = node.get('marks', [])
            if not isinstance(marks, list) or len(marks) > 2:
                raise ValueError('Invalid article marks')
            for mark in marks:
                if mark not in ({'type': 'bold'}, {'type': 'italic'}):
                    raise ValueError('Unsupported article mark')
                tag = 'strong' if mark['type'] == 'bold' else 'em'
                result = f'<{tag}>{result}</{tag}>'
            return result
        if kind == 'hardBreak':
            if attrs or children:
                raise ValueError('Invalid article break')
            return '<br>'
        if kind in atoms:
            allowed = {'libraryImage': {'asset_id'}, 'mediaVideo': {'media_link_id'},
                       'projectCard': {'project_id'}, 'faqEmbed': {'project_id', 'question_key'}}[kind]
            if set(attrs) != allowed or children or any(not isinstance(v, str) for v in attrs.values()):
                raise ValueError('Invalid article reference')
            ref = references.get(reference_key(kind, attrs))
            if not ref:
                return f'<p class="article-unavailable">{unavailable}</p>'
            if kind == 'libraryImage':
                asset = str(UUID(ref['asset_id']))
                return (f'<figure><img src="/api/hub/v1/admin/assets/{asset}/file" alt="{text(ref.get("alt"))}" loading="lazy">'
                        f'<figcaption>{text(ref.get("caption"))}</figcaption></figure>')
            if kind == 'mediaVideo':
                try:
                    url = urlsplit(ref.get('url', ''))
                    safe = (url.scheme == 'https' and not url.username and not url.password and url.port in (None, 443)
                            and bool(url.hostname) and '.' in url.hostname and not any(ord(c) < 32 for c in ref.get('url', '')))
                except ValueError:
                    safe = False
                if not safe:
                    return f'<p class="article-unavailable">{unavailable}</p>'
                label = ref.get('title') or ('Watch video' if locale == 'en' else 'เปิดวิดีโอ')
                return f'<p><a href="{text(url.geturl())}" target="_blank" rel="noopener noreferrer">{text(label)}</a></p>'
            if kind == 'projectCard':
                return f'<aside class="article-project"><strong>{text(ref.get("name"))}</strong></aside>'
            return (f'<section class="article-faq"><h3>{text(ref.get("question"))}</h3><p>{text(ref.get("short_answer"))}</p>'
                    f'<p>{text(ref.get("detail"))}</p><small>{text(ref.get("as_of_label"))}</small></section>')
        if kind == 'heading':
            if set(attrs) != {'level'} or type(attrs['level']) is not int or attrs['level'] not in (2, 3, 4):
                raise ValueError('Invalid heading level')
            tag = f'h{attrs["level"]}'
        elif kind in block_tags:
            tag = block_tags[kind]
        else:
            raise ValueError('Unsupported article block')
        attributes = ''
        if kind == 'orderedList':
            start = attrs.get('start', 1)
            if set(attrs) - {'start', 'type'} or type(start) is not int or not 1 <= start <= 10000 or attrs.get('type') not in (None, '1', 'a', 'A', 'i', 'I'):
                raise ValueError('Invalid list start')
            attributes = f' start="{start}"'
            if attrs.get('type'):
                attributes += f' type="{attrs["type"]}"'
        elif kind in ('tableCell', 'tableHeader'):
            if set(attrs) - {'colspan', 'rowspan', 'colwidth', 'align'} or attrs.get('align') not in (None, 'left', 'center', 'right'):
                raise ValueError('Invalid table attributes')
            if attrs.get('align'):
                attributes += f' class="article-align-{attrs["align"]}"'
            widths = attrs.get('colwidth')
            if widths is not None and (not isinstance(widths, list) or len(widths) > 10 or any(type(width) is not int or not 1 <= width <= 9999 for width in widths)):
                raise ValueError('Invalid column widths')
            for key in ('colspan', 'rowspan'):
                span = attrs.get(key, 1)
                if type(span) is not int or not 1 <= span <= 10:
                    raise ValueError('Invalid cell span')
                attributes += f' {key}="{span}"'
        elif kind != 'heading' and attrs:
            raise ValueError('Unsupported block attributes')
        rendered = ''.join(render(child, depth + 1) for child in children)
        result = f'<{tag}{attributes}>{rendered}</{tag}>'
        return f'<div class="article-table">{result}</div>' if kind == 'table' else result

    if not isinstance(document, dict) or document.get('type') != 'doc':
        raise ValueError('Article must be a document')
    return render(document)


def render_preview(data: dict) -> dict:
    locale = data['locale']
    content = render_blocks(data.pop('blocks'), data['references'], locale)
    cover = data.pop('cover_asset_id', None)
    if cover:
        content = render_blocks({'type': 'doc', 'content': [{'type': 'libraryImage', 'attrs': {'asset_id': cover}}]}, data['references'], locale) + content
    data.pop('references')
    data['html'] = (f'<article lang="{locale}"><h1>{escape(data["title"])}</h1><p>{escape(data["excerpt"])}</p>'
                    f'<p>{escape(data["author"])}</p>{content}</article>')
    return data


def register_article_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        require_content(request)
        return actor

    async def call(request, actor, sql, *args):
        async with database(request, actor) as connection:
            return {'data': await connection.fetchval(sql, *args)}

    @app.get('/v1/admin/articles')
    async def articles(request: Request, q: str = Query(default='', max_length=120),
                       offset: int = Query(default=0, ge=0, le=100000), limit: int = Query(default=25, ge=1, le=100), actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.article_list($1,$2,$3)', q, offset, limit)

    @app.get('/v1/admin/articles/references')
    async def references(request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.article_references()')

    @app.get('/v1/admin/articles/{article_id}')
    async def article(article_id: UUID, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.article_read($1)', article_id)

    @app.get('/v1/admin/articles/{article_id}/preview')
    async def preview(article_id: UUID, request: Request, locale: Literal['th', 'en'] = 'th', actor: Actor = Depends(staff)):
        result = await call(request, actor, 'select hub.article_preview($1,$2)', article_id, locale)
        return {'data': render_preview(result['data'])}

    @app.post('/v1/admin/articles')
    async def create(body: ArticleContent, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.article_save(null,0,$1)', body.model_dump(mode='json'))

    @app.put('/v1/admin/articles/{article_id}')
    async def save(article_id: UUID, body: ArticleSave, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.article_save($1,$2,$3)', article_id, body.expected_revision, body.content.model_dump(mode='json'))

    @app.post('/v1/admin/articles/{article_id}/submit')
    async def submit(article_id: UUID, body: ArticleRevision, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.article_submit($1,$2)', article_id, body.expected_revision)

    @app.post('/v1/admin/articles/{article_id}/review')
    async def review(article_id: UUID, body: ArticleReview, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.article_review($1,$2,$3)', article_id, body.expected_revision, body.decision)
