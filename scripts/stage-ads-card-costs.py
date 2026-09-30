"""Read-only P2 Media card-sheet import. Does not process PDFs or identify LINE OAs."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/api"))
from sena_hub_api.finance_imports import main

if __name__ == "__main__":
    raise SystemExit(main("card"))
