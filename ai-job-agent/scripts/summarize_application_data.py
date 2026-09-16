#!/usr/bin/env python3
"""Compatibility entry point for the reusable application-data cleaner."""

from __future__ import annotations

import sys
from pathlib import Path


try:
    from job_helper_agent.application_data_cleaning import (
        main,
        summarize_application_data,
    )
except ModuleNotFoundError as error:
    if error.name != "job_helper_agent":
        raise
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    from job_helper_agent.application_data_cleaning import (  # noqa: E402
        main,
        summarize_application_data,
    )


__all__ = ["main", "summarize_application_data"]


if __name__ == "__main__":
    raise SystemExit(main())
