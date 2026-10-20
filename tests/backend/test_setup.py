import unittest

from scripts.setup_backend import constraint_mismatches

CONSTRAINTS = """# comment
numpy==2.5.4
scipy==1.18.1  # trailing comment

Pygments==2.21.0
"""


class ConstraintCheckTest(unittest.TestCase):
    """The Python 3.13 environment must contain exactly the constrained versions."""

    def test_matching_environment_has_no_mismatch(self):
        versions = {"numpy": "2.5.4", "scipy": "1.18.1", "pygments": "2.21.0"}
        self.assertEqual(constraint_mismatches(CONSTRAINTS, versions.get), [])

    def test_reports_other_and_missing_versions(self):
        versions = {"numpy": "2.6.0", "pygments": "2.21.0"}
        self.assertEqual(
            constraint_mismatches(CONSTRAINTS, versions.get),
            ["numpy: installiert 2.6.0, erwartet 2.5.4", "scipy: nicht installiert, erwartet 1.18.1"],
        )

    def test_package_names_are_normalized(self):
        self.assertEqual(constraint_mismatches("Markdown_It.Py==4.2.0\n", {"markdown-it-py": "4.2.0"}.get), [])

    def test_rejects_unpinned_constraints(self):
        with self.assertRaises(ValueError):
            constraint_mismatches("numpy>=2\n", {}.get)


if __name__ == "__main__":
    unittest.main()
