"""DimOS navigation state string normalization for AR bridge nav handling."""


def normalize_nav_state(raw: str) -> str:
    """Normalise a raw DimOS navigation state string to one of idle/navigating/recovery."""
    state = raw.strip().lower()
    if state in {"idle", "navigating", "recovery"}:
        return state
    if "recover" in state:
        return "recovery"
    if any(token in state for token in ("follow", "path", "navig")):
        return "navigating"
    if state in {"arrived", "stopped"}:
        return "idle"
    if any(token in state for token in ("rotat", "initial", "final", "align", "execut", "move")):
        return "navigating"
    return "idle"
