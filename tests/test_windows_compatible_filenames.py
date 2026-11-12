import subprocess
import unittest


class WindowsCompatibleFilenameTests(unittest.TestCase):
    def test_tracked_paths_do_not_contain_windows_forbidden_characters(self):
        result = subprocess.run(
            ["git", "ls-files", "-z"], check=True, capture_output=True
        )
        paths = result.stdout.decode("utf-8", errors="surrogateescape").split("\0")
        forbidden = set('<>:"\\|?*')
        invalid = [
            path
            for path in paths
            if path and any(character in forbidden for character in path.rsplit("/", 1)[-1])
        ]

        self.assertEqual(invalid, [], f"Percorsi non estraibili su Windows: {invalid}")


if __name__ == "__main__":
    unittest.main()
