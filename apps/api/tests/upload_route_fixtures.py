"""Finite upload resolution for existing route doubles, never production authority."""
def upload_resolution(context, processing_class):
    return {'context': context, 'processing_class': processing_class,
            'input_limit': 2 * 1024 * 1024 if processing_class == 'sanitized_svg' else 10 * 1024 * 1024,
            'stored_limit': 10 * 1024 * 1024, 'pixel_limit': 40_000_000,
            'coordinates': None, 'active_tags': [], 'context_stamp': 'synthetic-route-stamp'}

SVG_CONTEXT_HEADER = '{"v":1,"kind":"brand","ref":"synthetic-brand","purpose":"logo_primary"}'
INTAKE_CONTEXT_HEADER = '{"v":1,"kind":"intake"}'