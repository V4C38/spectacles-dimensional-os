"""Keep launcher configuration collapsible and service actions unified."""

from html.parser import HTMLParser
from pathlib import Path


class LauncherMarkup(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.elements: dict[str, tuple[str, dict[str, str | None]]] = {}
        self.clients: set[str | None] = set()
        self.summaries = 0
        self.in_localization = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if "data-client" in attributes:
            self.clients.add(attributes["data-client"])
        element_id = attributes.get("id")
        if element_id:
            self.elements[element_id] = (tag, attributes)
        if element_id == "locCard":
            self.in_localization = True
        if self.in_localization and tag == "summary":
            self.summaries += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "details":
            self.in_localization = False


def test_localization_is_collapsible_and_client_actions_are_unified() -> None:
    markup = LauncherMarkup()
    markup.feed((Path(__file__).parents[1] / "static" / "index.html").read_text())
    tag, attributes = markup.elements["locCard"]
    assert tag == "details"
    assert "open" not in attributes
    assert markup.summaries == 1
    assert {"startBtn", "stopBtn"} <= markup.elements.keys()
    assert markup.clients == {"webxr", "specs"}
    assert not {"startWebxrBtn", "stopWebxrBtn", "stopBackendBtn"} & markup.elements.keys()
