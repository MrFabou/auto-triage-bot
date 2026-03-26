# Auto-Triage-Bot 🤖

A GitHub Action that **automatically labels and comments** on newly opened Issues and Pull Requests based on keyword analysis.

## How it works

| Keywords detected | Label applied |
|---|---|
| `crash`, `error`, `bug`, `fail`, `broken`, `exception` | `bug` |
| `feature`, `add`, `idea`, `improve`, `request`, `enhance` | `enhancement` |
| `typo`, `docs`, `documentation`, `readme`, `spelling` | `documentation` |

After labelling, the bot posts a short friendly comment so the author knows the issue has been triaged.

## Usage

Create a workflow file at **`.github/workflows/auto-triage.yml`** in your repository:

```yaml
name: Auto-Triage Bot

on:
  issues:
    types: [opened]
  pull_request:
    types: [opened]

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write

    steps:
      - name: Auto-Triage
        uses: your-org/auto-triage-bot@v1   # replace with your action reference
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `github-token` | yes | `${{ github.token }}` | Token used to interact with the GitHub API |

### Outputs

| Name | Description |
|---|---|
| `labels` | Comma-separated list of labels that were applied (may be empty) |

## Development

```bash
# Install dependencies
npm install

# Type-check
npm run typecheck

# Build the single-file bundle for the action
npm run build
```

The build step uses **@vercel/ncc** to compile everything into `dist/index.js`, which is what the action runner executes.

## License

MIT
