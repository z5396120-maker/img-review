import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "img_review_server.py"
SPEC = importlib.util.spec_from_file_location("img_review_server", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class ImgReviewServerTests(unittest.TestCase):
    def test_safe_name_removes_paths_and_punctuation(self):
        self.assertEqual(MODULE.safe_name("../../My screen (1).png"), "My-screen-1.png")

    def test_unique_path_adds_suffix(self):
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            (directory / "screen.png").write_bytes(b"x")
            self.assertEqual(MODULE.unique_path(directory, "screen.png").name, "screen-2.png")

    def test_markdown_contains_structured_feedback(self):
        payload = {
            "title": "Checkout",
            "savedAt": "2026-06-11T00:00:00Z",
            "assets": [{"id": "screen.png", "name": "screen.png"}],
            "annotations": [{
                "assetId": "screen.png",
                "type": "rect",
                "comment": "Increase contrast",
                "geometry": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
            }],
        }
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "review.md"
            MODULE.write_review_markdown(payload, output)
            text = output.read_text(encoding="utf-8")
            self.assertIn("# Checkout", text)
            self.assertIn("Increase contrast", text)
            self.assertIn('"x":0.1', text)

    def test_ai_task_contains_absolute_assets_and_transform(self):
        payload = {
            "title": "Move logo",
            "savedAt": "2026-06-11T00:00:00Z",
            "assets": [{"id": "screen.png", "name": "screen.png"}],
            "annotations": [{
                "assetId": "screen.png",
                "type": "magic",
                "comment": "Move this to the right",
                "geometry": {"paths": [[[0.1, 0.2], [0.3, 0.4]]]},
                "transform": {"translateX": 0.2, "translateY": 0, "scale": 1, "rotation": 0},
            }],
        }
        with tempfile.TemporaryDirectory() as raw:
            task = MODULE.build_ai_task(payload, Path(raw))
            self.assertTrue(Path(task["assets"][0]["path"]).is_absolute())
            self.assertEqual(task["annotations"][0]["transform"]["translateX"], 0.2)
            output = Path(raw) / "ai-task.md"
            MODULE.write_ai_task_markdown(task, output)
            self.assertIn("Move this to the right", output.read_text(encoding="utf-8"))

    def test_ai_task_allows_missing_comment_and_infers_transform_intent(self):
        payload = {
            "assets": [{"id": "screen.png", "name": "screen.png"}],
            "annotations": [{
                "assetId": "screen.png",
                "type": "magic",
                "comment": "",
                "geometry": {"paths": []},
                "transform": {"translateX": 0.1, "translateY": 0, "scale": 1.2, "rotation": 5},
            }],
        }
        with tempfile.TemporaryDirectory() as raw:
            task = MODULE.build_ai_task(payload, Path(raw))
            self.assertIn("demonstrated move", task["annotations"][0]["inferredIntent"])

    def test_remove_asset_from_payload_removes_its_annotations(self):
        payload = {
            "assets": [{"id": "a.png"}, {"id": "b.png"}],
            "annotations": [{"assetId": "a.png"}, {"assetId": "b.png"}],
        }
        updated = MODULE.remove_asset_from_payload(payload, "a.png")
        self.assertEqual(updated["assets"], [{"id": "b.png"}])
        self.assertEqual(updated["annotations"], [{"assetId": "b.png"}])


if __name__ == "__main__":
    unittest.main()
