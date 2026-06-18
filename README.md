# Img Review for Codex

Img Review is a local Codex plugin and skill for turning screenshots, generated images, UI captures, and design exports into structured visual feedback that Codex can apply.

It gives you a browser canvas for marking regions, selecting elements, demonstrating target transforms, and exporting an executable AI task.

## What It Does

- Opens a local annotation canvas in the Codex in-app Browser.
- Supports box, arrow, point, and freehand annotations.
- Supports Magic selection with brush-style region selection, add/subtract modes, tolerance, sampling, and edge smoothing.
- Lets you move, scale, and rotate selected image elements to show the desired target state.
- Shows clear Before/After indicators for transformed selections.
- Imports images by upload, paste, drag-and-drop, or CLI arguments.
- Exports `annotations.json`, `review.md`, `ai-task.json`, and `ai-task.md`.
- Includes a Codex skill that tells Codex how to consume the exported feedback and revise images or UI code.

## Repository Layout

```text
.codex-plugin/plugin.json      Codex plugin manifest
skills/img-review/SKILL.md     Codex skill workflow
scripts/open_img_review.py     Launcher that starts or reuses a local server
scripts/img_review_server.py   Dependency-free local HTTP server
assets/                        Browser UI
examples/sample-ui.svg         Public sample image for a quick test
tests/                         Python unit tests
```

## Install For Local Codex Development

Codex installs plugins from configured marketplaces. For local development, use a personal marketplace entry that points at this checkout.

One convenient layout is:

```bash
mkdir -p ~/plugins
git clone https://github.com/<owner>/img-review.git ~/plugins/img-review
```

Then ensure your personal marketplace at `~/.agents/plugins/marketplace.json` includes:

```json
{
  "name": "personal",
  "interface": {
    "displayName": "Personal"
  },
  "plugins": [
    {
      "name": "img-review",
      "source": {
        "source": "local",
        "path": "./plugins/img-review"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

Install it with:

```bash
codex plugin add img-review@personal
```

During local iteration, bump the plugin cachebuster or reinstall through your normal Codex plugin development flow.

## Run Without Installing

You can run the annotation server directly:

```bash
python3 scripts/open_img_review.py \
  --session-dir /absolute/path/to/.img-review/session \
  --image /absolute/path/to/screenshot.png \
  --json
```

Or start the server directly:

```bash
python3 scripts/img_review_server.py \
  --session-dir /absolute/path/to/.img-review/session \
  --image /absolute/path/to/screenshot.png
```

Open the printed URL in the Codex in-app Browser or a local browser for manual testing.

To try the included public sample:

```bash
python3 scripts/open_img_review.py \
  --session-dir /tmp/img-review-sample \
  --image examples/sample-ui.svg
```

## Codex Workflow

After installing the plugin, ask Codex:

```text
Use $img-review to annotate this screenshot, apply the saved feedback to the UI,
verify the updated page, and prepare a commit.
```

You can also use natural prompts such as:

```text
Open Img Review for this screenshot.
标一下这张图，然后按我的修改意见改 UI。
Compare these two generated images and send the review to Codex.
```

Codex plugins cannot replace the native image attachment viewer or trigger merely because a user clicks an image. Send the image with review intent to start the workflow.

## Output Files

Each session writes:

```text
assets/           Copied source images
annotations.json  Structured normalized annotations
review.md         Human-readable review notes
ai-task.json      Executable handoff for Codex
ai-task.md        Human-readable handoff
```

Review sessions are local work artifacts. Do not commit `.img-review/` unless your team explicitly wants to keep review records.

## Development

Run checks:

```bash
python3 -m unittest discover -s tests -v
node --check assets/app.js
```

If you have the Codex plugin validator available:

```bash
PYTHONPATH=/path/to/validator-deps \
python3 /path/to/validate_plugin.py .
```

## License

MIT
