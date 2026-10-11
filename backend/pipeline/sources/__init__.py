from ..types import Source


def all_sources() -> list[Source]:
    """Every adapter, in dedupe priority order (richest sources first)."""
    from .devpost import DevpostSource

    return [DevpostSource()]
