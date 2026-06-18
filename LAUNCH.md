# Launch Copy

Use these posts to introduce Img Review.

## Short Post

I built Img Review, a Codex plugin for visual feedback during vibe coding.

It runs inside the Codex in-app Browser. Drop in a screenshot, generated image, or UI capture, quickly select an element with Magic selection, then move, scale, or rotate it to show Codex the target design.

The goal is simple: make AI understand visual change requests that are hard to describe in text.

GitHub: https://github.com/z5396120-maker/img-review

## X / Twitter

I built Img Review for Codex.

It lets you annotate screenshots and generated images directly inside the Codex in-app Browser.

You can:
- select elements quickly
- mark regions
- move / scale / rotate selected elements
- show before vs after
- send structured visual feedback back to Codex

The problem: in vibe coding, design feedback is often visual, and text prompts are too vague.

Img Review gives Codex a way to understand "change this part" with coordinates, selections, comments, and target transforms.

GitHub: https://github.com/z5396120-maker/img-review

## Hacker News

Title:

```text
Show HN: Img Review – visual annotations for Codex image and UI feedback
```

Post:

```text
I built Img Review, a local Codex plugin and skill for visual feedback during vibe coding.

The motivation: once you are iterating on UI or generated images with an AI coding agent, text feedback gets fuzzy quickly. "Move this element over there", "make this section cleaner", or "use this shape but smaller" often leaves too much room for interpretation.

Img Review opens a local annotation canvas inside the Codex in-app Browser. You can drop in a screenshot or generated image, mark regions, use Magic selection to select an element, move/scale/rotate it into a target state, and send structured annotations back to Codex.

It exports normalized geometry, comments, and target transforms as JSON/Markdown so Codex can apply the requested changes to image assets or UI code.

Repo: https://github.com/z5396120-maker/img-review
```

## Reddit / Community Post

```text
I made Img Review, a Codex plugin for giving AI coding agents visual feedback.

It is aimed at vibe coding workflows where you are iterating on UI or generated images and plain text feedback becomes too ambiguous.

Instead of writing a long prompt like "move this card slightly left and make it smaller", you can open the image in Img Review, select the element, move/scale/rotate it into the target position, optionally add a comment, and send the structured review to Codex.

It runs locally and opens in the Codex in-app Browser. The output includes normalized annotations, comments, and transform data that Codex can use to make image or UI changes.

GitHub: https://github.com/z5396120-maker/img-review
```

## Product Hunt Tagline

```text
Visual feedback for Codex-powered vibe coding
```

## Product Hunt Description

```text
Img Review is a local Codex plugin for annotating screenshots, generated images, and UI captures. Select elements quickly, move/scale/rotate them to show your target design, and send structured visual feedback back to Codex so AI can understand changes that are hard to describe in text.
```

## Demo Script

1. Open Img Review in the Codex in-app Browser.
2. Drop in `examples/sample-ui.svg` or a real UI screenshot.
3. Use Magic selection to brush over an element.
4. Move, scale, or rotate the selected element.
5. Show the Before/After indicators.
6. Press **Send to Codex**.
7. Show the generated `ai-task.json` or Codex applying the requested UI/image change.
