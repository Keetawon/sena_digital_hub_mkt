"""Operator error metadata only: never exception messages, SQL, headers or values."""
import re


def diagnostic(error=None, *, step, http_status=None, api_error_code=None, missing_response_keys=()):
    if http_status is None:
        http_status = getattr(error, 'status_code', None)
    if api_error_code is None and isinstance(getattr(error, 'detail', None), dict):
        api_error_code = error.detail.get('code')
    sqlstate = None
    current = error
    for _ in range(8):
        code = getattr(current, 'sqlstate', None)
        if isinstance(code, str) and re.fullmatch(r'[A-Z0-9]{5}', code):
            sqlstate = code
            break
        current = getattr(current, '__cause__', None) or getattr(current, '__context__', None)
        if current is None:
            break
    return {
        'step': step if re.fullmatch(r'[a-z][a-z0-9_./-]{0,95}', step) else 'operation',
        'exception_class': type(error).__name__ if error is not None else None,
        'sqlstate': sqlstate,
        'http_status': http_status if type(http_status) is int and 100 <= http_status <= 599 else None,
        'api_error_code': api_error_code if isinstance(api_error_code, str) and re.fullmatch(r'[a-z][a-z0-9_]{0,63}', api_error_code) else None,
        'missing_response_keys': [name for name in missing_response_keys
                                  if isinstance(name, str) and re.fullmatch(r'[a-z][a-z0-9_.]{0,63}', name)],
    }


def forwarded_diagnostic(report, *, step):
    """Carry child-process metadata through another wrapper without its text."""
    result = diagnostic(step=report.get('step', step), http_status=report.get('http_status'),
                        api_error_code=report.get('api_error_code'),
                        missing_response_keys=report.get('missing_response_keys', ()))
    for name, pattern in [('exception_class', r'[A-Za-z_][A-Za-z_0-9]{0,79}'), ('sqlstate', r'[A-Z0-9]{5}')]:
        value = report.get(name)
        result[name] = value if isinstance(value, str) and re.fullmatch(pattern, value) else None
    return result
