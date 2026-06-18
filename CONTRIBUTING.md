# Contributing

Thanks for helping improve Img Review.

## Development

Run the local checks before opening a pull request:

```bash
python3 -m unittest discover -s tests -v
node --check assets/app.js
```

If you have Codex's plugin validation helper available, also run:

```bash
PYTHONPATH=/path/to/validator-deps \
python3 /path/to/validate_plugin.py .
```

## Guidelines

- Keep the plugin dependency-free where practical.
- Keep review session output under `.img-review/` out of commits unless a test fixture explicitly needs it.
- Prefer small, user-visible improvements over broad rewrites.
- Update `README.md` and `CHANGELOG.md` when changing install, launch, or export behavior.

