"""Regression checks for coastal marine selection on historical-event generation."""
import contextlib
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from event_library import marine_for_event


class EventMarineSelectionTests(unittest.TestCase):
    def test_inland_pearl_river_skips_inapplicable_marine_request(self):
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            self.assertFalse(marine_for_event("28109", True))
        self.assertIn("inland county", output.getvalue())
        self.assertIn("neighboring counties", output.getvalue())

    def test_coastal_or_unknown_county_remains_strict(self):
        self.assertTrue(marine_for_event("22071", True))
        self.assertTrue(marine_for_event("28045", True))

    def test_unchecked_marine_remains_disabled(self):
        self.assertFalse(marine_for_event("28109", False))
        self.assertFalse(marine_for_event("22071", False))


if __name__ == "__main__":
    unittest.main()
