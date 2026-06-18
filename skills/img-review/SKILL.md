---
name: img-review
description: Automatically use when a user attaches or references an image, screenshot, design, generated image, or Appshot and asks to annotate, review, compare, comment on, revise, or modify it. Opens a local visual annotation canvas, then applies structured feedback to image assets or UI code and verifies the revision.
---

# Img Review

Use this workflow when visual feedback needs precise locations rather than prose alone.

## Automatic activation

Invoke this skill implicitly; the user does not need to type `$img-review`.

Activate when all of the following are true:

- The current message or thread contains an image, screenshot, design export, generated image, Appshot, or an explicit local image path.
- The user expresses image-review intent such as annotate, mark, circle, comment, review, compare, revise, edit, modify, fix the UI, or asks what should change.

Do not activate merely because an unrelated image is present. Do not intercept ordinary image explanation, OCR, classification, or factual questions unless the user also wants spatial feedback or revision.

Codex plugins cannot replace the native image viewer or react to a user merely clicking an attachment. Start this workflow after the user sends the image with review intent.

## Start a review

1. Resolve this skill directory and the plugin root containing it.
2. Choose a session directory inside the current repository, normally `.img-review/<short-task-name>`.
   For projectless chats, use a writable working directory managed by the thread.
3. Resolve an accessible local image path. If the attachment has no exposed filesystem path, preserve the attachment as the visual source and ask Codex to materialize a local copy using an available image, screenshot, or attachment-export capability. Do not invent a path.
4. Prefer the launcher script. It starts or reuses an Img Review server, copies or uploads images, and prints the exact URL to open:

```bash
python3 <plugin-root>/scripts/open_img_review.py \
  --session-dir <absolute-session-directory> \
  --image <absolute-image-path> \
  --json
```

Repeat `--image` for before/after versions or multiple screens. If no image path is available, omit `--image` and use the upload button.

5. If the launcher is unavailable, start the server in a long-running terminal session:

```bash
python3 <plugin-root>/scripts/img_review_server.py \
  --session-dir <absolute-session-directory> \
  --image <absolute-image-path>
```

Repeat `--image` for before/after versions or multiple screens. Images are copied into the session so the review remains reproducible. If no image path is available, start without `--image` and use the upload button.

6. Keep the server terminal session running for the entire review. Confirm the printed URL returns HTTP 200 before opening it.
7. Open the exact printed URL with the Codex **in-app Browser** plugin. This is mandatory user-facing behavior:
   - Do not use macOS `open`, Chrome, Safari, or an external browser.
   - Do not merely print the URL or ask the user to copy it.
   - Set the in-app browser visibility capability to `true` immediately after navigation.
   - Prefer a healthy existing Img Review tab when it is already connected to the same live URL.
   - If the selected tab is a browser connection-error or `data:` error page, do not reload or operate that blocked page. Create a new in-app Browser tab and navigate it to the live URL.
   - Use the exact host printed by the server; do not rewrite `127.0.0.1` to `localhost` or the reverse.
8. Verify the loaded page title is `Img Review` and that the review image or upload state is visible.
9. Ask the user to press **Send to Codex** when the visual intent is complete. Written instructions are optional: transforms communicate placement, scale, and rotation directly, while comments disambiguate changes that cannot be expressed spatially.

## Fast entrypoints

- "Open Img Review", "start img review", "打开视觉标注", "打开图片 review", or "标一下这张图" should launch the canvas through `scripts/open_img_review.py` without asking the user to repeat the setup steps.
- When an image path is provided, pass it to `--image`.
- When there is already a healthy Img Review server at the preferred port, reuse it and open that existing URL in the in-app Browser.
- Codex still cannot add a native right-click or click-on-attachment Review button; this launcher is the supported one-step plugin entry.

## Browser launch contract

The annotation canvas is an interactive Codex surface, so launching it is part of completing the skill, not an optional follow-up. A successful server start without a visible in-app Browser tab is incomplete. If Browser cannot attach, keep the server alive, report the Browser attachment problem, and retry through the Browser plugin when permitted. Never substitute an external browser.

## Consume feedback

Read both files from the session directory:

- `annotations.json`: structured normalized geometry and comments.
- `review.md`: concise human-readable checklist.
- `ai-task.json`: executable handoff containing absolute source paths, exact selections, comments, and target transforms. Prefer this file after **Send to Codex**.
- `ai-task.md`: human-readable rendering of the same executable task.

Treat `assetId`, geometry, optional comment, `inferredIntent`, and transform together. Normalized coordinates are relative to the displayed source image, with the origin at its top-left. When no comment exists, follow the demonstrated transform; for an untransformed mark, use it as spatial context and avoid inventing a specific cosmetic change without other evidence in the conversation.

Smart selections use annotation type `magic`. Their geometry contains one or more normalized closed `paths`, the clicked `seed`, color `tolerance`, and sampled `pixelCount`. Use the paths as the precise affected region; do not replace them with a coarse bounding box when applying feedback.
Magic selection add/subtract operations are already resolved into the final `paths`; consume the final geometry rather than replaying the edit history.

An annotation may contain a `transform` describing the requested target state: normalized `translateX`/`translateY`, uniform `scale`, rotation in degrees, and the normalized transform origin. Apply this transformation to the underlying visual element or UI component, not merely to the review overlay.
The review canvas previews Magic-selected source pixels as a floating element while transforming. Treat that preview as the intended target appearance and placement; the original pixels remain visible only as positional reference.

For image revisions:

1. Use the original asset plus the comments as the source of truth.
2. Invoke image editing with a precise prompt that names each marked region.
3. Preserve unmarked content unless a comment requires a global change.
4. Save the revision as a new file; never overwrite the original review input.

For UI revisions:

1. Map each marked region to the relevant rendered component.
2. Make the smallest code change that addresses the comments.
3. Reuse the repository's components and design tokens.
4. Run the relevant checks and visually verify the same state.

## Close the loop

1. Add the revised image or fresh screenshot to the same review session.
2. Use Compare mode to inspect before and after.
3. If feedback remains, repeat the review cycle.
4. Summarize changed files and verification.
5. Commit only when the user requested a commit or clearly approved the revision.

Do not commit `.img-review/` sessions by default. Commit them only when the team wants review records under version control.
