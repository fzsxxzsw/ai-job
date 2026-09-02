"""Job Helper Agent service.

Strict checkpoint decoding must be selected before any LangGraph serde module
is imported. The saver also receives an explicit strict serializer in main.
"""

import os

os.environ["LANGGRAPH_STRICT_MSGPACK"] = "true"

__all__ = ["__version__"]
__version__ = "0.1.0"
