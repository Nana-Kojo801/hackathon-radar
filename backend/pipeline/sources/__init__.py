from ..types import Source


def all_sources() -> list[Source]:
    """Every adapter, in dedupe priority order (richest sources first)."""
    from ..discover import WebDiscoverySource
    from .devfolio import DevfolioSource
    from .devpost import DevpostSource
    from .ethglobal import ETHGlobalSource
    from .mlh import MLHSource
    from .taikai import TaikaiSource
    from .unstop import UnstopSource

    return [
        DevpostSource(), DevfolioSource(), TaikaiSource(), ETHGlobalSource(), MLHSource(),
        UnstopSource(), WebDiscoverySource(),
    ]
