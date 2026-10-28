"""Classify bounded provider errors without exposing their message or payload."""

SPEND_CODES = frozenset({'project_spend_limit_exceeded', 'organization_spend_limit_exceeded', 'insufficient_quota'})


def spend_limit_code(error: Exception) -> str | None:
    if getattr(error, 'status_code', None) != 429:
        return None
    code = getattr(error, 'code', None)
    body = getattr(error, 'body', None)
    if code not in SPEND_CODES and isinstance(body, dict):
        nested = body.get('error', body)
        code = nested.get('code') if isinstance(nested, dict) else None
    return code if isinstance(code, str) and code in SPEND_CODES else None


class ProviderBudgetExceeded(Exception):
    def __init__(self, code: str):
        if code not in SPEND_CODES:
            raise ValueError('Invalid provider budget code')
        self.code = code
        super().__init__('budget_exhausted')
