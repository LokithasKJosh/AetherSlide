from chromadb.telemetry.product import ProductTelemetryClient, ProductTelemetryEvent
from overrides import override


class NoopTelemetry(ProductTelemetryClient):
    @override
    def capture(self, event: ProductTelemetryEvent) -> None:  # noqa: ARG002
        return
