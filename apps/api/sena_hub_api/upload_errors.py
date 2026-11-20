"""Shared upload error identity, independent of decoder module reloads."""


class UploadProcessingError(ValueError):
    """Only fixed error codes leave processing; never decoder/metadata text."""
