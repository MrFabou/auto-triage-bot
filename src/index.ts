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
    core.info("No custom label-rules provided \u2013 using built-in defaults.");
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
    core.debug(`Rule "${rule.label}": checking keywords [${rule.keywords.join(", ")}]`);
    let ruleMatched = false;
    for (const keyword of rule.keywords) {
      if (lower.includes(keyword)) {
        core.debug(`Rule "${rule.label}": matched keyword "${keyword}"`);
        matched.add(rule.label);
        ruleMatched = true;
        break;
      }
    }
    if (!ruleMatched) {
      core.debug(`Rule "${rule.label}": no match`);
    }
  }

  return [...matched];
}

/**
 * Build the triage comment.
 *
 * - template === ""      -> use the built-in default
 * - template === "none"  -> return null (skip commenting)
 * - otherwise            -> use the template with {labels} and {entity} placeholders
 */
function buildComment(
  labels: string[],
  isPR: boolean,
  template: string,
): string | null {
  const entity = isPR ? "pull request" : "issue";
  const labelText = labels.length > 0 ? labels.join(", ") : "uncategorized";

  // Commenting disabled
  if (template.toLowerCase() === "none") {
    return null;
  }

  // Custom template
  if (template.length > 0) {
    return template
      .replace(/\{labels\}/g, labelText)
      .replace(/\{entity\}/g, entity);
  }

  // Built-in default
  if (labels.length === 0) {
    return (
      `\ud83d\udc4b Thanks for opening this ${entity}! ` +
      `I couldn't automatically determine a category, but a maintainer will review it shortly.`
    );
  }

  return (
    `\ud83d\udc4b Thanks for opening this ${entity}! ` +
    `I've automatically categorized it as **${labels.join("**, **")}**. ` +
    `A maintainer will review it shortly.`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  try {
    // 1. Get inputs & context ------------------------------------------------
    const token = core.getInput("github-token", { required: true });
    const rawRules = core.getInput("label-rules");
    const commentTemplate = core.getInput("comment-template").trim();
    const octokit = github.getOctokit(token);
    const { context } = github;
    const rules = parseLabelRules(rawRules);

    const isPR = context.eventName === "pull_request";
    const isIssue = context.eventName === "issues";

    core.debug(`Event: ${context.eventName}, Action: ${context.payload.action ?? "n/a"}`);
    core.debug(`Repository: ${context.repo.owner}/${context.repo.repo}`);
    core.debug(`Custom label-rules provided: ${rawRules.trim().length > 0 ? "yes" : "no"}`);
    core.debug(`Comment template: ${commentTemplate.length > 0 ? `"${commentTemplate}"` : "(default)"}`);

    if (!isPR && !isIssue) {
      core.info(`Event "${context.eventName}" is not supported \u2013 skipping.`);
      return;
    }

    // 2. Extract title & body ------------------------------------------------
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
    core.debug(`Title: "${title}"`);
    core.debug(`Body: "${body.substring(0, 200)}${body.length > 200 ? "..." : ""}"`);

    if (title.length === 0 && body.length === 0) {
      core.info("Title and body are both empty \u2013 skipping label detection.");
    }

    // 3. Detect labels -------------------------------------------------------
    const combinedText = `${title} ${body}`;
    const labels = detectLabels(combinedText, rules);

    core.info(`Detected labels: ${labels.length > 0 ? labels.join(", ") : "(none)"}`);

    // 4. Add labels via GitHub API -------------------------------------------
    if (labels.length > 0) {
      core.debug(`Calling issues.addLabels with: [${labels.join(", ")}]`);
      await octokit.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        labels,
      });
      core.info(`Labels added to #${issueNumber}.`);
    }

    // 5. Post a friendly comment ---------------------------------------------
    const comment = buildComment(labels, isPR, commentTemplate);

    if (comment !== null) {
      core.debug(`Posting comment (${comment.length} chars) to #${issueNumber}`);
      await octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        body: comment,
      });
      core.info("Comment posted.");
    } else {
      core.info("Commenting is disabled via comment-template=none \u2013 skipped.");
    }

    // 6. Set outputs ---------------------------------------------------------
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
