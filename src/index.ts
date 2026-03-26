import * as core from "@actions/core";
import * as github from "@actions/github";

// ---------------------------------------------------------------------------
// Keyword -> Label mapping
// ---------------------------------------------------------------------------
interface LabelRule {
  label: string;
  keywords: string[];
}

const DEFAULT_LABEL_RULES: LabelRule[] = [
  { label: "bug", keywords: ["crash", "error", "bug", "fail", "broken", "exception"] },
  { label: "enhancement", keywords: ["feature", "add", "idea", "improve", "request", "enhance"] },
  { label: "documentation", keywords: ["typo", "docs", "documentation", "readme", "spelling"] },
];

/**
 * Parse the 'label-rules' input.  Returns the built-in defaults when the
 * input is empty or not provided.
 */
function parseLabelRules(raw: string): LabelRule[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    core.info("No custom label-rules provided - using built-in defaults.");
    return DEFAULT_LABEL_RULES;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      `Invalid JSON in 'label-rules' input: ${trimmed.substring(0, 120)}...`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("'label-rules' must be a JSON array of {label, keywords} objects.");
  }

  for (const entry of parsed) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.label !== "string" ||
      !Array.isArray(entry.keywords) ||
      !entry.keywords.every((k: unknown) => typeof k === "string")
    ) {
      throw new Error(
        `Invalid rule in 'label-rules': ${JSON.stringify(entry)}. ` +
        `Expected {"label": "string", "keywords": ["string"]}.`
      );
    }
  }

  core.info(`Loaded ${parsed.length} custom label rule(s).`);
  return parsed as LabelRule[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely convert an unknown payload value to a trimmed string. */
function sanitizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

/** Return the set of labels whose keywords appear in `text`. */
function detectLabels(text: string, rules: LabelRule[]): string[] {
  const lower = text.toLowerCase();
  const matched = new Set<string>();

  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      if (lower.includes(keyword)) {
        matched.add(rule.label);
        break;
      }
    }
  }

  return [...matched];
}

/** Build a friendly triage comment depending on the context. */
function buildComment(labels: string[], isPR: boolean): string {
  const entity = isPR ? "pull request" : "issue";

  if (labels.length === 0) {
    return (
      `Thanks for opening this ${entity}! ` +
      `I couldn't automatically determine a category, but a maintainer will review it shortly.`
    );
  }

  return (
    `Thanks for opening this ${entity}! ` +
    `I've automatically categorized it as **${labels.join("**, **")}**. ` +
    `A maintainer will review it shortly.`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  try {
    const token = core.getInput("github-token", { required: true });
    const rawRules = core.getInput("label-rules");
    const octokit = github.getOctokit(token);
    const { context } = github;
    const rules = parseLabelRules(rawRules);

    const isPR = context.eventName === "pull_request";
    const isIssue = context.eventName === "issues";

    if (!isPR && !isIssue) {
      core.info(`Event "${context.eventName}" is not supported - skipping.`);
      return;
    }

    let title: string;
    let body: string;
    let issueNumber: number;

    if (isIssue) {
      const issue = context.payload.issue;
      if (!issue) {
        core.setFailed("Could not read issue payload.");
        return;
      }
      title = sanitizeText(issue.title);
      body = sanitizeText(issue.body);
      issueNumber = issue.number;
    } else {
      const pr = context.payload.pull_request;
      if (!pr) {
        core.setFailed("Could not read pull_request payload.");
        return;
      }
      title = sanitizeText(pr.title);
      body = sanitizeText(pr.body);
      issueNumber = pr.number;
    }

    core.info(`Processing #${issueNumber}: "${title}"`);

    if (title.length === 0 && body.length === 0) {
      core.info("Title and body are both empty - skipping label detection.");
    }

    const combinedText = `${title} ${body}`;
    const labels = detectLabels(combinedText, rules);

    core.info(`Detected labels: ${labels.length > 0 ? labels.join(", ") : "(none)"}`);

    if (labels.length > 0) {
      await octokit.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        labels,
      });
      core.info(`Labels added to #${issueNumber}.`);
    }

    const comment = buildComment(labels, isPR);

    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      body: comment,
    });
    core.info("Comment posted.");

    core.setOutput("labels", labels.join(","));
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred.");
    }
  }
}

run();
